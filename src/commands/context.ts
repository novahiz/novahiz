import { existsSync, mkdirSync, readFileSync, readdirSync, chmodSync } from "node:fs";
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

export function confirm(question: string): boolean {
  process.stdout.write(question + " [y/N] ");
  const answer = process.stdin.read()?.toString().trim().toLowerCase();
  return answer === "y" || answer === "yes" || answer === "oui";
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

export function readStdin(): string {
  // A single synchronous stdin read races with pipe delivery and can return null even when input was provided.
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, 'utf8');
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
    process.stderr.write(`Valeur invalide pour --${label}: "${raw}" n'est pas un nombre.\n`);
    process.exitCode = 1;
    return undefined;
  }
  if (opts.integer && !Number.isInteger(num)) {
    process.stderr.write(`Valeur invalide pour --${label}: un nombre entier est requis, pas "${raw}".\n`);
    process.exitCode = 1;
    return undefined;
  }
  if (opts.min !== undefined && num < opts.min) {
    process.stderr.write(`Valeur invalide pour --${label}: ${num} est inferieur a la limite minimale de ${opts.min}.\n`);
    process.exitCode = 1;
    return undefined;
  }
  return num;
}
