import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "src", "cli.ts");

function run(args: string[], cwd: string, home: string = root): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: "",
    cwd,
    env: { ...process.env, NOVAHIZ_HOME: home, NOVAHIZ_GATE: "off" }
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

/** Isolated Novahiz home whose installed-skills index either contains the
 *  impeccable skill or not — the index is the authority `init` reads. The
 *  docs templates are copied so the docs step behaves as in production. */
function tempHome(withImpeccable: boolean): string {
  const home = mkdtempSync(join(tmpdir(), "novahiz-init-home-"));
  mkdirSync(join(home, "build"), { recursive: true });
  writeFileSync(
    join(home, "build", "installed-skills.json"),
    JSON.stringify(withImpeccable ? ["impeccable", "novahiz-plan"] : ["novahiz-plan"]),
    "utf8"
  );
  cpSync(join(root, "skills", "novahiz-docs"), join(home, "skills", "novahiz-docs"), { recursive: true });
  return home;
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

test("init reports the impeccable context step when PRODUCT.md exists", () => {
  const dir = tempProject();
  writeFileSync(join(dir, "PRODUCT.md"), "# Product\n", "utf8");
  const home = tempHome(true);
  const result = run(["init", "--json"], dir, home);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const step = parsed.steps.find((item: { id: string }) => item.id === "impeccable");
  assert.ok(step, "impeccable step present");
  assert.equal(step.status, "created", step.detail);
  assert.match(step.detail, /PRODUCT\.md at PRODUCT\.md/);
  // Context present: no /impeccable init advice in next.
  assert.doesNotMatch(parsed.next, /impeccable init/);
  assert.match(parsed.next, /novahiz-init/);
});

test("init advises /impeccable init when the skill is installed but PRODUCT.md is missing", () => {
  const dir = tempProject();
  const home = tempHome(true);
  const result = run(["init", "--json"], dir, home);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const step = parsed.steps.find((item: { id: string }) => item.id === "impeccable");
  assert.ok(step);
  assert.equal(step.status, "skipped", step.detail);
  assert.match(step.detail, /PRODUCT\.md missing/);
  // Advisory never fails init.
  assert.ok(!parsed.failed.includes("impeccable"));
  assert.match(parsed.next, /\/impeccable init/);
});

test("init finds PRODUCT.md in docs/ per impeccable context resolution", () => {
  const dir = tempProject();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "PRODUCT.md"), "# Product\n", "utf8");
  const home = tempHome(true);
  const result = run(["init", "--json"], dir, home);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const step = parsed.steps.find((item: { id: string }) => item.id === "impeccable");
  assert.ok(step);
  assert.equal(step.status, "created", step.detail);
  assert.match(step.detail, /PRODUCT\.md at docs\/PRODUCT\.md/);
  assert.doesNotMatch(parsed.next, /impeccable init/);
});

test("init keeps the impeccable row quiet when the skill is not installed", () => {
  const dir = tempProject();
  const home = tempHome(false);
  const result = run(["init", "--json"], dir, home);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const step = parsed.steps.find((item: { id: string }) => item.id === "impeccable");
  assert.ok(step);
  assert.equal(step.status, "skipped");
  assert.match(step.detail, /not installed/);
  // No install advice and no init advice pushed on a machine without the skill.
  assert.doesNotMatch(parsed.next, /impeccable/);
});
