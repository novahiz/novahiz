import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_GATE: "off" }
  });
  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? ""
  };
}

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-init-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "demo-app", version: "1.2.3" }, null, 2)}\n`);
  return dir;
}

test("init --dry-run reports steps without writing", () => {
  const dir = tempProject();
  const result = run(["init", "--dry-run", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.project.name, "demo-app");
  assert.ok(Array.isArray(parsed.steps));
  assert.equal(existsSync(join(dir, "project-memory")), false);
  assert.equal(existsSync(join(dir, "novahiz-docs")), false);
  assert.equal(existsSync(join(dir, ".novahiz", "config.json")), false);
});

test("init creates memory and docs skeleton", () => {
  const dir = tempProject();
  const result = run(["init", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.failed.length, 0, JSON.stringify(parsed.steps));

  assert.ok(existsSync(join(dir, "project-memory", "index.json")));
  assert.ok(existsSync(join(dir, "project-memory", "slots")));

  for (const file of ["ARCHITECTURE.md", "CONVENTIONS.md", "DECISIONS.md", "STANDARDS.md"]) {
    assert.ok(existsSync(join(dir, "novahiz-docs", file)), file);
  }

  const index = JSON.parse(readFileSync(join(dir, "project-memory", "index.json"), "utf8"));
  assert.ok(index.slots.length >= 1);

  const autodocs = parsed.steps.find((step: { id: string }) => step.id === "autodocs");
  assert.ok(autodocs, "autodocs step present");
  assert.notEqual(autodocs.status, "failed");
  const config = JSON.parse(readFileSync(join(dir, ".novahiz", "config.json"), "utf8"));
  assert.equal(config.autoDocs, true);
});

test("init --dry-run reports autodocs without writing config", () => {
  const dir = tempProject();
  const result = run(["init", "--dry-run", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const autodocs = parsed.steps.find((step: { id: string }) => step.id === "autodocs");
  assert.ok(autodocs);
  assert.equal(autodocs.status, "dry-run");
  assert.equal(existsSync(join(dir, ".novahiz", "config.json")), false);
});

test("init is idempotent on second run", () => {
  const dir = tempProject();
  assert.equal(run(["init", "--json"], dir).status, 0);
  const second = run(["init", "--json"], dir);
  assert.equal(second.status, 0, second.stderr);
  const parsed = JSON.parse(second.stdout);
  assert.equal(parsed.failed.length, 0);
  const docsStep = parsed.steps.find((step: { id: string }) => step.id === "docs");
  assert.equal(docsStep.status, "skipped");
});

test("init --memory-only skips docs", () => {
  const dir = tempProject();
  const result = run(["init", "--memory-only", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(dir, "project-memory")));
  assert.equal(existsSync(join(dir, "novahiz-docs")), false);
});

test("init --docs-only skips memory", () => {
  const dir = tempProject();
  const result = run(["init", "--docs-only", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(dir, "novahiz-docs")));
  assert.equal(existsSync(join(dir, "project-memory")), false);
});

test("init lists cleanup candidates without deleting", () => {
  const dir = tempProject();
  writeFileSync(join(dir, "debug.novahiz-bak"), "old\n");
  const result = run(["init", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const cleanup = parsed.steps.find((step: { id: string }) => step.id === "cleanup");
  assert.ok(cleanup);
  assert.ok(parsed.cleanup.some((item: { path: string }) => item.path === "debug.novahiz-bak"));
  assert.equal(existsSync(join(dir, "debug.novahiz-bak")), true);
});

test("init --apply with --dry-run still does not delete", () => {
  const dir = tempProject();
  writeFileSync(join(dir, "debug.novahiz-bak"), "old\n");
  const result = run(["init", "--apply", "--dry-run", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(dir, "debug.novahiz-bak")), true);
});

test("init fails on empty directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-init-empty-"));
  const result = run(["init", "--json"], dir);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.failed.includes("doctor"));
});

test("init --no-seed creates memory without baseline slot", () => {
  const dir = tempProject();
  const result = run(["init", "--no-seed", "--json"], dir);
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(readFileSync(join(dir, "project-memory", "index.json"), "utf8"));
  assert.equal(index.slots.length, 0);
});

test("skill novahiz-init ships with frontmatter", () => {
  const skill = join(root, "skills", "novahiz-init", "SKILL.md");
  assert.ok(existsSync(skill));
  const raw = readFileSync(skill, "utf8");
  assert.match(raw, /^---\nname: novahiz-init\n/);
  assert.match(raw, /novahiz init/);
});

test("slash command novahiz-init exists", () => {
  const cmd = join(root, "adapters", "opencode", "commands", "novahiz-init.md");
  assert.ok(existsSync(cmd));
  assert.match(readFileSync(cmd, "utf8"), /novahiz-init/);
});

test("help lists init as project bootstrap and setup as install", () => {
  const result = run(["help"], tempProject());
  assert.match(result.stdout, /init\s+Initialize Novahiz in the current project/);
  assert.match(result.stdout, /setup\s+Install Novahiz/);
});
