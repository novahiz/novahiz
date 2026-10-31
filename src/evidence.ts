/**
 * Verification evidence.
 *
 * The system asks the agent for proofs (`proof:` on a todo, "I ran the tests")
 * but never checked that anything ran. This module runs a command and records
 * what actually happened: exit code, output tail, duration, and a hash over the
 * command plus its output.
 *
 * Safety model: the tool never accepts an arbitrary command from the caller.
 * A project declares its verifiable commands once in `.novahiz/verify.json`
 * (`{ "commands": { "tests": "npm test" } }`), and the tool only runs a named
 * entry from that file. The file is project-owned, the same trust level as a
 * `package.json` script. That keeps the gate's guarantee intact: `novahiz_verify`
 * can never become a side door around it.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { DatabaseSync } from "./db.ts";

export const VERIFY_CONFIG_REL = ".novahiz/verify.json";
export const VERIFY_EVIDENCE_DIR = ".novahiz/evidence";
const MAX_OUTPUT_CHARS = 20_000;
const MAX_STORED_OUTPUT = 200_000;
const MAX_COMMAND_CHARS = 1_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export type VerifyConfig = {
  commands: Record<string, string>;
};

export type VerifyOutcome = {
  ok: boolean;
  /**
   * True when the command could not measure at all (exit code 3): a service
   * unreachable, a network path dead. Not a pass, and not a lie either.
   */
  inconclusive: boolean;
  name: string;
  command: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  outputTail: string;
  outputTruncated: boolean;
  hash: string;
  evidenceId: string;
  /** File the full record was written to, relative to the project root. */
  evidenceFile: string | null;
  error?: string;
};

/**
 * Exit code a verification command uses when it cannot measure.
 *
 * Measured need: `verifier-catalogue` answered "Mesure impossible" with exit 2
 * during a transient network failure, and a documentation claim replaying it
 * would have gone red. Red must mean "the claim is false", never "the network
 * blinked". 2 was already taken (usage error), so the convention is 3.
 */
export const UNMEASURABLE_EXIT_CODE = 3;

export type EvidenceRow = {
  id: string;
  session_id: string | null;
  project_root: string | null;
  name: string;
  command: string;
  exit_code: number;
  ok: number;
  output_tail: string;
  hash: string;
  duration_ms: number;
  created_at: string;
};

/** Normalised project identity: the ledger is shared by every project. */
export function projectKey(projectRoot: string): string {
  const absolute = resolve(projectRoot);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function fail(name: string, command: string, error: string): VerifyOutcome {
  return {
    ok: false,
    inconclusive: false,
    name,
    command,
    exitCode: null,
    signal: null,
    durationMs: 0,
    outputTail: "",
    outputTruncated: false,
    hash: "",
    evidenceId: "",
    evidenceFile: null,
    error,
  };
}

/** Read `.novahiz/verify.json`, returning a reason instead of throwing on bad input. */
export function loadVerifyConfig(projectRoot: string): VerifyConfig | { error: string } {
  const file = join(projectRoot, VERIFY_CONFIG_REL);
  if (!existsSync(file)) {
    return {
      error:
        `no verify config at ${VERIFY_CONFIG_REL}. Declare the commands that prove your work, e.g. ` +
        `{ "commands": { "tests": "npm test", "typecheck": "npx tsc --noEmit" } }`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { error: `${VERIFY_CONFIG_REL} is not valid JSON: ${String(error).slice(0, 200)}` };
  }
  const commands = (parsed as { commands?: unknown })?.commands;
  if (!commands || typeof commands !== "object" || Array.isArray(commands)) {
    return { error: `${VERIFY_CONFIG_REL} must contain a "commands" object of name → command` };
  }
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(commands as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
      return { error: `invalid command name "${name}" (letters, digits, dot, dash, underscore)` };
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      return { error: `command "${name}" must be a non-empty string` };
    }
    if (value.length > MAX_COMMAND_CHARS) {
      return { error: `command "${name}" exceeds ${MAX_COMMAND_CHARS} characters` };
    }
    clean[name] = value;
  }
  return { commands: clean };
}

/**
 * Run one declared command from the project root and record the evidence.
 * Never throws: a failed verification is a result, not an exception.
 */
export function runVerification(
  db: DatabaseSync,
  options: {
    projectRoot: string;
    name: string;
    session?: string;
    timeoutMs?: number;
    /** Optional required substring in the combined output. */
    expect?: string;
  },
): VerifyOutcome {
  const projectRoot = resolve(options.projectRoot);
  const name = options.name;
  const config = loadVerifyConfig(projectRoot);
  if ("error" in config) return fail(name, "", config.error);
  const command = config.commands[name];
  if (!command) {
    return fail(
      name,
      "",
      `unknown verification "${name}". Declared: ${Object.keys(config.commands).join(", ") || "(none)"}`,
    );
  }

  const timeout = Math.min(
    Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: projectRoot,
    shell: true,
    timeout,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const durationMs = Date.now() - started;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combined = `${stdout}${stderr}`;
  const exitCode = typeof result.status === "number" ? result.status : null;
  const signal = result.signal ?? null;

  const expectationMet =
    typeof options.expect === "string" && options.expect.length > 0
      ? combined.includes(options.expect)
      : true;
  const ok = exitCode === 0 && !result.error && expectationMet;
  const inconclusive = exitCode === UNMEASURABLE_EXIT_CODE;
  const hash = createHash("sha256")
    .update(command)
    .update("\n")
    .update(String(exitCode))
    .update("\n")
    .update(combined)
    .digest("hex")
    .slice(0, 32);

  const outputTruncated = combined.length > MAX_OUTPUT_CHARS;
  const outputTail = outputTruncated
    ? combined.slice(combined.length - MAX_OUTPUT_CHARS)
    : combined;

  const evidenceId = `ev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO evidence (id, session_id, project_root, name, command, exit_code, ok, output_tail, hash, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    evidenceId,
    options.session ?? null,
    projectKey(projectRoot),
    name,
    command,
    exitCode ?? -1,
    ok ? 1 : 0,
    outputTail,
    hash,
    durationMs,
    createdAt,
  );

  // A file copy makes the evidence survive a DB reset and stays readable by a
  // human without sqlite. Best effort: the DB row is the source of truth.
  let evidenceFile: string | null = null;
  try {
    const dir = join(projectRoot, VERIFY_EVIDENCE_DIR);
    mkdirSync(dir, { recursive: true });
    const stamp = createdAt.replace(/[:.]/g, "-");
    const file = join(dir, `${stamp}-${name}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          id: evidenceId,
          name,
          command,
          exitCode,
          ok,
          inconclusive,
          expectationMet,
          expect: options.expect ?? null,
          signal,
          durationMs,
          hash,
          createdAt,
          output: combined.length > MAX_STORED_OUTPUT ? combined.slice(-MAX_STORED_OUTPUT) : combined,
          outputTruncated,
        },
        null,
        2,
      ),
      "utf8",
    );
    evidenceFile = `.novahiz/evidence/${stamp}-${name}.json`;
  } catch {
    evidenceFile = null;
  }

  const reason = result.error
    ? String(result.error).slice(0, 300)
    : inconclusive
      ? `measurement impossible (exit ${UNMEASURABLE_EXIT_CODE}): the command could not reach what it measures. Not a pass, and not a contradiction.`
      : expectationMet
        ? undefined
        : `expected output to contain ${JSON.stringify(options.expect)}`;

  return {
    ok,
    inconclusive,
    name,
    command,
    exitCode,
    signal,
    durationMs,
    outputTail,
    outputTruncated,
    hash,
    evidenceId,
    evidenceFile,
    ...(reason ? { error: reason } : {}),
  };
}

export function listEvidence(
  db: DatabaseSync,
  options: { limit?: number; session?: string; projectRoot?: string } = {},
): EvidenceRow[] {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 200);
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (options.session) {
    filters.push("session_id = ?");
    params.push(options.session);
  }
  if (options.projectRoot) {
    filters.push("project_root = ?");
    params.push(projectKey(options.projectRoot));
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM evidence ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as unknown as EvidenceRow[];
}

/** True when `candidate` stays inside `root` — used before writing outside the DB. */
export function isInside(root: string, candidate: string): boolean {
  const rel = resolve(candidate).slice(resolve(root).length);
  return resolve(candidate).startsWith(resolve(root) + sep) || rel === "";
}
