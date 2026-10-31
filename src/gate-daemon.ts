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
import { capture, type Captured } from "./gate-capture.ts";
import { expandHome } from "./spec.ts";

function respond(payload: unknown): void {
  // Written through the restored stream, never through a captured one.
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/**
 * A verdict carries reasons; an infrastructure failure is not a verdict.
 * When the gate keeps answering "DB open failed" or "internal error", the
 * process is wedged on a module it loaded at startup (measured 2026-10-29: a
 * schema/allowlist mismatch left every project blocked until OpenCode was
 * restarted by hand). After MAX_INTERNAL_FAILURES such answers the daemon exits,
 * and the client's ensureGateChild respawns a fresh one that reloads the code.
 */
const MAX_INTERNAL_FAILURES = 3;
let internalFailures = 0;

function isInfrastructureFailure(captured: Captured): boolean {
  if (captured.status === 0) return false;
  const text = `${captured.stdout}${captured.stderr}`;
  return (
    text.includes("DB open failed") ||
    text.includes("session DB error") ||
    text.includes("internal error") ||
    text.includes("gate daemon")
  );
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
    if (isInfrastructureFailure(captured)) {
      internalFailures += 1;
      if (internalFailures >= MAX_INTERNAL_FAILURES) {
        process.stderr.write(
          `gate daemon: ${internalFailures} consecutive infrastructure failures — exiting so the next call reloads the code\n`,
        );
        // Let the verdict reach the client before the process disappears.
        setImmediate(() => process.exit(70));
      }
    } else {
      internalFailures = 0;
    }
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
