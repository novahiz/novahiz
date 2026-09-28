import { existsSync, mkdirSync, readFileSync, readdirSync, chmodSync, readSync } from "node:fs";
import { resolve as resolvePath, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Spec } from "../spec.ts";

export interface Parsed {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parse(argv: string[]): Parsed {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      index += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { positionals, flags };
}

export function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

export function splitList(value: string | boolean | undefined): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export function print(output: unknown): void {
  const record = (typeof output === "object" && output !== null ? output : {}) as Record<string, unknown>;
  if (typeof record.name === "string" && Array.isArray(record.commands)) {
    console.log(record.name);
    for (const cmd of record.commands) console.log("  " + cmd);
  } else {
    process.stdout.write(JSON.stringify(output) + "\n");
  }
}

export function flagOn(parsed: Parsed, name: string): boolean {
  const value = parsed.flags[name];
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string" && value.length > 0) return true;
  return false;
}

export function humanMode(parsed: Parsed): boolean {
  process.stdout.write("Plan mode: read-only. No application files will be written.\n");
  return true;
}

export function emit(parsed: Parsed, value: unknown, textFn: () => string): void {
  const format = String(parsed.flags.format ?? "").toLowerCase();
  const asJson = format === "json" || parsed.flags.json === true;
  if (asJson) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  } else {
    process.stdout.write(textFn() + "\n");
  }
}

// P2-C (LOW): stdin.read() returns null on a TTY (stream not in flowing
// mode), which made every confirmation silently answer "no". Read a line
// from fd 0 directly instead; parse stays pure so tests cover it without a
// terminal.
export function parseAnswer(line: string): boolean {
  const answer = line.trim().toLowerCase();
  return answer === "y" || answer === "yes" || answer === "o" || answer === "oui";
}

const MAX_ANSWER_BYTES = 1024;

function readAnswerLine(): string {
  const buffer = Buffer.alloc(MAX_ANSWER_BYTES);
  let total = 0;
  try {
    while (total < MAX_ANSWER_BYTES) {
      const read = readSync(0, buffer, total, 1, null);
      if (read <= 0) break;
      const byte = buffer[total];
      total += 1;
      if (byte === 0x0a) break; // \n — consume the whole line, stop at newline
    }
  } catch {
    // stdin unavailable (closed pipe, no console): treat as empty answer
  }
  return buffer.toString("utf8", 0, total);
}

export function confirm(question: string): boolean {
  process.stdout.write(question + " [y/N] ");
  return parseAnswer(readAnswerLine());
}

// The name promises safety: malformed input returns [] instead of throwing.
export function safeJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function dbPathFor(root: string, spec: Spec): string {
  return resolvePath(root, spec.config.dbPath);
}

const MAX_STDIN_BYTES = 1024 * 1024; // 1 MiB: JSON payloads never need more

export function readStdin(): string {
  // A single synchronous stdin read races with pipe delivery and can return null even when input was provided.
  if (process.stdin.isTTY) return "";
  try {
    // P2-C (LOW): bounded read — readFileSync(0) had no size limit, so a huge
    // pipe reached JSON.parse in full. Stop at the cap; oversized input gets
    // truncated (and then fails to parse) instead of being loaded whole.
    const buffer = Buffer.alloc(MAX_STDIN_BYTES);
    let total = 0;
    while (total < MAX_STDIN_BYTES) {
      const read = readSync(0, buffer, total, MAX_STDIN_BYTES - total, null);
      if (read <= 0) break;
      total += read;
    }
    return buffer.toString("utf8", 0, total);
  } catch {
    return "";
  }
}

export function numberFlag(
  parsed: Parsed,
  name: string,
  opts: { min?: number; integer?: boolean; label?: string } = {},
): number | undefined {
  const raw = parsed.flags[name];
  if (raw === undefined || raw === false) return undefined;
  const label = opts.label ?? name;
  const num = Number(raw);
  if (Number.isNaN(num)) {
    process.stderr.write(`Invalid value for --${label}: "${raw}" is not a number.\n`);
    process.exitCode = 1;
    return undefined;
  }
  if (opts.integer && !Number.isInteger(num)) {
    process.stderr.write(`Invalid value for --${label}: an integer is required, not "${raw}".\n`);
    process.exitCode = 1;
    return undefined;
  }
  if (opts.min !== undefined && num < opts.min) {
    process.stderr.write(`Invalid value for --${label}: ${num} is below the minimum limit of ${opts.min}.\n`);
    process.exitCode = 1;
    return undefined;
  }
  return num;
}
