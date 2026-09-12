import { readFileSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { type Spec } from "../spec.ts";
import * as ui from "../render.ts";

export type Parsed = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

export function parse(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = Object.create(null);
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

export function asString(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

export function splitList(value: string | boolean | undefined): string[] {
  return asString(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function flagOn(parsed: Parsed, name: string): boolean {
  const value = parsed.flags[name];
  if (value === undefined || value === null) return false;
  if (value === true) return true;
  return !["false", "0", "no", "off", ""].includes(String(value).toLowerCase());
}

export function humanMode(parsed: Parsed): boolean {
  if (flagOn(parsed, "json")) return false;
  if (flagOn(parsed, "pretty")) return true;
  return ui.isTty();
}

export function emit(parsed: Parsed, value: unknown, render: () => string): void {
  if (humanMode(parsed)) {
    process.stdout.write(`${render()}\n`);
    return;
  }
  print(value);
}

export function confirm(question: string): boolean {
  process.stdout.write(`${question} [o/N] `);
  const buffer = Buffer.alloc(64);
  try {
    const read = readSync(0, buffer, 0, buffer.length, null);
    const answer = buffer.subarray(0, read).toString("utf8").trim().toLowerCase();
    return ["o", "oui", "y", "yes"].includes(answer);
  } catch {
    return false;
  }
}

export function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function dbPathFor(root: string, spec: Spec): string {
  const configured = spec.config.dbPath;
  if (configured.length === 0) return resolve(root, "novahiz.sqlite");
  return resolve(root, configured);
}

export function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
