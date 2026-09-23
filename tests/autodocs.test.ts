import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "src", "cli.ts");

function run(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: "",
    cwd,
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_GATE: "off", NOVAHIZ_AUTODOCS: "" }
  });
  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? ""
  };
}

function tempProject(withDocs = true): string {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-autodocs-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "demo-app", version: "1.0.0" }, null, 2)}\n`);
  if (withDocs) {
    mkdirSync(join(dir, "novahiz-docs"), { recursive: true });
    writeFileSync(join(dir, "novahiz-docs", "ARCHITECTURE.md"), "# Architecture\n\nOverview.\n");
  }
  return dir;
}

function writeConfig(dir: string, autoDocs: boolean): void {
  mkdirSync(join(dir, ".novahiz"), { recursive: true });
  writeFileSync(join(dir, ".novahiz", "config.json"), `${JSON.stringify({ autoDocs }, null, 2)}\n`);
}

test("autodocs status reports default state", () => {
  const dir = tempProject();
  writeConfig(dir, true);
  const result = run(["autodocs", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.action, "status");
  assert.equal(parsed.dirty, false);
  assert.deepEqual(parsed.pending, []);
  assert.equal(parsed.enabled, true);
});

test("autodocs --mark records a major path", () => {
  const dir = tempProject();
  writeConfig(dir, true);
  const result = run(["autodocs", "--mark", "src/app.ts", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.action, "mark");
  assert.equal(parsed.status, "marked");
  assert.ok(parsed.paths.includes("src/app.ts"));
  const state = JSON.parse(readFileSync(join(dir, ".novahiz", "state.json"), "utf8"));
  assert.equal(state.dirty, true);
  assert.ok(state.pending.includes("src/app.ts"));
});

test("autodocs --mark ignores non-major paths", () => {
  const dir = tempProject();
  writeConfig(dir, true);
  const result = run(["autodocs", "--mark", "notes/todo.md,src/keep.ts", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "marked");
  assert.deepEqual(parsed.paths, ["src/keep.ts"]);
  const state = JSON.parse(readFileSync(join(dir, ".novahiz", "state.json"), "utf8"));
  assert.ok(state.pending.includes("src/keep.ts"));
  assert.ok(!state.pending.includes("notes/todo.md"));
});

test("autodocs --mark without paths fails", () => {
  const dir = tempProject();
  writeConfig(dir, true);
  const result = run(["autodocs", "--mark", "--json"], dir);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "failed");
});

test("autodocs --flush skips when autoDocs is disabled", () => {
  const dir = tempProject();
  writeConfig(dir, false);
  run(["autodocs", "--mark", "src/app.ts", "--json"], dir);
  const result = run(["autodocs", "--flush", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.action, "flush");
  assert.equal(parsed.status, "skipped");
  assert.match(parsed.reason, /disabled/i);
  const state = JSON.parse(readFileSync(join(dir, ".novahiz", "state.json"), "utf8"));
  assert.equal(state.dirty, true);
});

test("autodocs --flush updates docs and clears dirty", () => {
  const dir = tempProject();
  writeConfig(dir, true);
  run(["autodocs", "--mark", "src/app.ts", "--json"], dir);
  const result = run(["autodocs", "--flush", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.action, "flush");
  assert.equal(parsed.status, "flushed");
  assert.equal(parsed.docsUpdated, true);
  assert.equal(parsed.pending, 0);
  const doc = readFileSync(join(dir, "novahiz-docs", "ARCHITECTURE.md"), "utf8");
  assert.match(doc, /## Recent changes/);
  assert.match(doc, /src\/app\.ts/);
  const state = JSON.parse(readFileSync(join(dir, ".novahiz", "state.json"), "utf8"));
  assert.equal(state.dirty, false);
  assert.equal(state.pending.length, 0);
  assert.ok(state.lastSync);
});

test("autodocs --flush skips when nothing is dirty", () => {
  const dir = tempProject();
  writeConfig(dir, true);
  const result = run(["autodocs", "--flush", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "skipped");
  assert.match(parsed.reason, /nothing dirty/i);
});

test("autodocs flush without ARCHITECTURE.md still clears state", () => {
  const dir = tempProject(false);
  writeConfig(dir, true);
  run(["autodocs", "--mark", "src/app.ts", "--json"], dir);
  const result = run(["autodocs", "--flush", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "flushed");
  assert.equal(parsed.docsUpdated, false);
  assert.equal(parsed.docsPath, "novahiz-docs/ARCHITECTURE.md");
});

test("autodocs human output lists key fields", () => {
  const dir = tempProject();
  writeConfig(dir, true);
  const result = run(["autodocs"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /novahiz autodocs/);
  assert.match(result.stdout, /autoDocs/);
});

test("help lists autodocs", () => {
  const result = run(["help"], tempProject());
  assert.match(result.stdout, /autodocs/);
});
