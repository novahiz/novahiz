#!/usr/bin/env node

// Captures the JSON output of the skillenforce CLI so a refactor can be proven neutral.
//
//   node scripts/capture-cli.mjs --label before
//   ... run the refactor ...
//   node scripts/capture-cli.mjs --label after
//   node scripts/capture-cli.mjs --compare before after
//
// Every invocation runs with a private database (`skillenforce_DB`) so the output does
// not depend on the state of the real ledger. `--compare` ignores the timestamp
// fields listed in IGNORED, which change on every run for reasons unrelated to
// the code.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Fields that carry the current time. A diff there says nothing about the code.
const IGNORED = ["lastSync", "cutoff", "updated_at", "invoked_at", "at", "installedAt"];

// Each entry is a CLI invocation. Names must be unique: they become file names.
const INVOCATIONS = [
  ["check", ["check"]],
  ["categories", ["categories"]],
  ["rules", ["rules"]],
  ["skills", ["skills"]],
  ["skills-code", ["skills", "--category", "code"]],
  ["roadmap-code", ["roadmap", "--category", "code"]],
  ["roadmap-audit", ["roadmap", "--category", "audit"]],
  ["providers", ["providers"]],
  ["deps", ["deps"]],
  ["catalog", ["catalog", "skillenforce"]],
  ["classify-bug", ["classify", "corrige un bug de login"]],
  ["classify-refactor", ["classify", "decouper src/cli.ts en modules"]],
  ["doctor", ["doctor"]],
  ["clean-plan", ["clean", "--dry-run"]],
  ["task-current", ["task", "current"]],
  ["report", ["report"]],
  ["tokens", ["tokens"]],
  ["sync", ["sync"]],
  ["gate-text", ["gate", "--tool", "edit", "--file", "README.md", "--categories", "docs-writing"]],
  ["gate-style", ["gate", "--tool", "edit", "--file", "src/app.css", "--categories", "code"]],
  ["gate-read", ["gate", "--tool", "read", "--file", "README.md"]],
];

function parse(argv) {
  const flags = { label: "", compare: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--label") flags.label = argv[++index] ?? "";
    else if (token === "--compare") flags.compare.push(argv[++index] ?? "", argv[++index] ?? "");
    else if (token === "--out") flags.out = argv[++index] ?? "";
    else if (token === "--help" || token === "-h") flags.help = true;
  }
  return flags;
}

function outputRoot(flags) {
  return flags.out && flags.out.length > 0 ? flags.out : join(tmpdir(), "skillenforce", "cli-reference");
}

function capture(flags) {
  if (flags.label.length === 0) throw new Error("--label <name> is required to capture");
  const target = join(outputRoot(flags), flags.label);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const dbPath = join(target, "capture.sqlite");
  const cli = join(root, "src", "cli.ts");

  for (const [name, args, input] of INVOCATIONS) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
      input: input ? JSON.stringify(input) : "",
      env: { ...process.env, skillenforce_DB: dbPath }
    });
    writeFileSync(
      join(target, `${name}.json`),
      `${JSON.stringify({ status: result.status, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() }, null, 2)}\n`,
      "utf8"
    );
  }
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  process.stdout.write(`Captured ${INVOCATIONS.length} invocations into ${target}\n`);
}

// Replaces every ignored field's value with a constant so two runs compare equal.
function normalise(text) {
  let out = text;
  for (const field of IGNORED) {
    const pattern = new RegExp(`("${field}"\\s*:\\s*)("[^"]*"|\\d+|null)`, "g");
    out = out.replace(pattern, "$1\"<time>\"");
  }
  return out;
}

function compare(flags) {
  const [left, right] = flags.compare;
  if (!left || !right) throw new Error("--compare <before> <after> is required");
  const dirLeft = join(outputRoot(flags), left);
  const dirRight = join(outputRoot(flags), right);
  for (const dir of [dirLeft, dirRight]) {
    if (!existsSync(dir)) throw new Error(`no capture at ${dir}`);
  }
  const names = readdirSync(dirLeft).filter((name) => name.endsWith(".json")).sort();
  const differences = [];
  for (const name of names) {
    const otherPath = join(dirRight, name);
    if (!existsSync(otherPath)) {
      differences.push(`${name}: missing in ${right}`);
      continue;
    }
    const a = normalise(readFileSync(join(dirLeft, name), "utf8"));
    const b = normalise(readFileSync(otherPath, "utf8"));
    if (a !== b) differences.push(name);
  }
  const extra = readdirSync(dirRight)
    .filter((name) => name.endsWith(".json") && !names.includes(name))
    .sort();
  for (const name of extra) differences.push(`${name}: only in ${right}`);
  if (differences.length === 0) {
    process.stdout.write(`${names.length} invocations identical between ${left} and ${right}\n`);
    return;
  }
  process.stdout.write(`${differences.length} differences:\n`);
  for (const name of differences) process.stdout.write(`  ${name}\n`);
  process.exitCode = 1;
}

function main() {
  const flags = parse(process.argv.slice(2));
  if (flags.help || (flags.label.length === 0 && flags.compare.length === 0)) {
    process.stdout.write(
      "usage: node scripts/capture-cli.mjs --label <name> [--out <dir>]\n" +
        "       node scripts/capture-cli.mjs --compare <before> <after> [--out <dir>]\n"
    );
    return;
  }
  if (flags.compare.length > 0) {
    compare(flags);
    return;
  }
  capture(flags);
}

main();
