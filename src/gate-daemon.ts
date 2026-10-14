/**
 * GATE-DAEMON — one warm process serving the plugin's per-tool-call gate checks.
 *
 * Why this exists (measured 2026-10-14, Windows, Node v24.21.0):
 *   The plugin ran `node --experimental-strip-types cli.ts gate ...` on every
 *   edit/write/patch/bash/shell call. A full invocation took 299.1 ms, while the
 *   actual gate computation (loadSpec + evaluateGate) is 0.74 ms. Of the rest:
 *   ~61-66 ms bare Node startup, ~24 ms type stripping, ~60 ms importing all 16
 *   command modules from cli.ts, ~77 ms loading the gate core. Roughly 99.6% of
 *   the latency was process startup, paid once per gated tool call.
 *
 * What this is NOT: a cache. Every request re-runs commandGate, which re-reads
 * catalog/rules.json, categories.json, the gate config and the skill index from
 * disk. No verdict is ever memoised, so there is nothing to invalidate and no
 * stale-verdict fail-open is possible by construction. The daemon only keeps the
 * process warm; it never decides anything on its own.
 *
 * Protocol — newline-delimited JSON over stdio:
 *   request : {"id":N,"argv":["gate","--tool","edit",...],"input":"<payload JSON>"}
 *   response: {"id":N,"status":0,"stdout":"<verdict>","stderr":"<diagnostics>"}
 *
 * `status`/`stdout` reproduce the exit code and stdout of a one-shot CLI run, so
 * the plugin's existing handling (spawnError/status 2/status != 0 => deny) is
 * reused unchanged. A protocol violation answers status 1, which the client
 * treats as unavailable: fail-closed, never fail-open.
 */

import { resolve } from "node:path";
import { parse, setStdinProvider } from "./commands/context.ts";
import { commandGate } from "./commands/gate.ts";
import { expandHome } from "./spec.ts";

type WriteLike = (chunk: unknown, ...rest: unknown[]) => boolean;

type Captured = { stdout: string; stderr: string; status: number };

/**
 * Run one gate evaluation with stdout/stderr/exitCode intercepted.
 *
 * commandGate reports its verdict through print() and process.stdout.write and
 * signals denial through process.exitCode (it never calls process.exit), which
 * makes it safe to run repeatedly inside one process — see commands/gate.ts:26,
 * :131, :152, :194, :258.
 */
function capture(fn: () => void): Captured {
  const out: string[] = [];
  const err: string[] = [];
  // Restored verbatim: `process.stdout.write` is an overloaded method, so it
  // gets its own type instead of WriteLike (whose `unknown` chunk would be
  // contravariance-incompatible with the real `string | Uint8Array` parameter).
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const previousExit = process.exitCode;
  process.exitCode = 0;

  const captureWrite =
    (sink: string[]): WriteLike =>
    (chunk: unknown): boolean => {
      sink.push(String(chunk));
      return true;
    };

  const stdoutStream = process.stdout as unknown as { write: typeof process.stdout.write };
  const stderrStream = process.stderr as unknown as { write: typeof process.stderr.write };
  stdoutStream.write = captureWrite(out) as unknown as typeof process.stdout.write;
  stderrStream.write = captureWrite(err) as unknown as typeof process.stderr.write;
  try {
    fn();
  } finally {
    stdoutStream.write = realOut;
    stderrStream.write = realErr;
  }

  const status = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = previousExit;
  return { stdout: out.join(""), stderr: err.join(""), status };
}

function respond(payload: unknown): void {
  // Written through the restored stream, never through a captured one.
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function handle(line: string): void {
  let id: unknown = null;
  try {
    const request = JSON.parse(line) as { id?: unknown; argv?: unknown; input?: unknown };
    id = request.id ?? null;
    if (!Array.isArray(request.argv)) throw new Error("argv must be an array");
    const argv = request.argv.map(String);
    const parsed = parse(argv);

    // Mirror cli.ts:125-127 so a --home override behaves identically.
    if (typeof parsed.flags.home === "string" && parsed.flags.home.length > 0) {
      process.env.NOVAHIZ_HOME = resolve(expandHome(parsed.flags.home));
    }

    const command = parsed.positionals[0];
    if (command !== "gate") {
      throw new Error(`the daemon serves the gate command only, got "${command}"`);
    }
    // gate on|off mutates persistence; the plugin never sends it, and a daemon
    // must not change enforcement state on behalf of a tool call.
    const sub = (parsed.positionals[1] ?? "").toLowerCase();
    if (sub === "on" || sub === "off") {
      throw new Error("gate on|off is not served over the daemon channel");
    }

    const input = typeof request.input === "string" ? request.input : "";
    let captured: Captured;
    setStdinProvider(() => input);
    try {
      captured = capture(() => commandGate(parsed));
    } finally {
      setStdinProvider(null);
    }
    respond({ id, ...captured });
  } catch (error) {
    setStdinProvider(null);
    respond({ id, status: 1, stdout: "", stderr: `gate daemon: ${String(error).slice(0, 300)}` });
  }
}

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim().length > 0) handle(line);
    newline = buffer.indexOf("\n");
  }
});

// The client closing the pipe ends the session; the next gated call respawns.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(1));
