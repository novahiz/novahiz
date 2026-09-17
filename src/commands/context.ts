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
  return String(value);
}

export function splitList(value: string | undefined): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export function print(output: Record<string, unknown>): void {
  if (typeof output.name === "string" && Array.isArray(output.commands)) {
    console.log(output.name);
    for (const cmd of output.commands) console.log("  " + cmd);
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
  if (format === "json") {
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

export function safeJsonArray(value: string): unknown[] {
  return JSON.parse(value);
}

export function dbPathFor(root: string, spec: Spec): string {
  return resolvePath(root, spec.config.dbPath);
}

export function readStdin(): string {
  return process.stdin.read()?.toString() ?? "";
}

export function numberFlag(
  parsed: Parsed,
  name: string,
  opts: { min?: number; integer?: boolean } = {},
): number | undefined {
  const raw = parsed.flags[name];
  if (raw === undefined || raw === false) return undefined;
  const num = Number(raw);
  if (Number.isNaN(num)) return undefined;
  if (opts.integer && !Number.isInteger(num)) return undefined;
  if (opts.min !== undefined && num < opts.min) return undefined;
  return num;
}
