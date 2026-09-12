import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadSpec } from "../src/spec.ts";
import { openDb } from "../src/db.ts";
import { scanSkills, writeCatalog, writeSkillIndex } from "../src/catalog.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "src", "cli.ts");
const testDb = join(tmpdir(), `novahiz-cli-${Date.now().toString(36)}.sqlite`);

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${testDb}${suffix}`, { force: true });
    } catch {
      // best effort cleanup
    }
  }
});

before(() => {
  const spec = loadSpec(root);
  const skills = scanSkills(spec);
  writeSkillIndex(spec, skills);
  writeCatalog(spec, skills);
});

function run(args: string[], env: Record<string, string> = {}): string {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb, ...env }
  });
  return result.stdout.trim();
}

function runWithInput(args: string[], input: object): string {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  return result.stdout.trim();
}

test("NOVAHIZ_GATE=off disables the gate", () => {
  const parsed = JSON.parse(run(["gate", "--file", "README.md", "--tool", "edit"], { NOVAHIZ_GATE: "off" }));
  assert.equal(parsed.allow, true);
  assert.equal(parsed.disabled, true);
});

test("gate errors without a file or stdin", () => {
  const result = spawnSync(process.execPath, [cli, "gate", "--tool", "edit"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  assert.equal(result.status, 1);
});

test("roadmap command returns the category roadmap", () => {
  const parsed = JSON.parse(run(["roadmap", "--category", "code"]));
  assert.equal(parsed.category, "code");
  assert.equal(parsed.roadmap.id, "feature");
});

test("does not gate a tool that is not in gate.tools", () => {
  const parsed = JSON.parse(run(["gate", "--tool", "read", "--file", "README.md"]));
  assert.equal(parsed.allow, true);
  assert.equal(parsed.reason, "tool is not gated");
});

test("gate surfaces required skills that are absent from the installed index", () => {
  const parsed = JSON.parse(run(["gate", "--tool", "edit", "--file", "README.md", "--categories", "docs-writing"]));
  assert.ok(Array.isArray(parsed.unmatchedRequired));
  assert.ok(Array.isArray(parsed.warnings));
});

test("classify output carries a primary and a roadmap", () => {
  const parsed = JSON.parse(run(["classify", "refais le css de la landing page"]));
  assert.equal(parsed.primary, "design-ui");
  assert.equal(parsed.roadmaps[0].category, "design-ui");
  assert.ok(Array.isArray(parsed.enforcedSkills));
});

test("catalog tolerates a non-numeric limit", () => {
  const parsed = JSON.parse(run(["catalog", "design", "--limit", "abc"]));
  assert.ok(Array.isArray(parsed.results));
  assert.ok(parsed.results.length > 0);
});

test("hook Stop prints a roadmap summary", () => {
  const out = runWithInput(["hook", "--harness", "codex", "--event", "Stop"], { session_id: "stop-session" });
  assert.ok(out.includes("roadmap steps"));
});

test("providers command lists the bundled providers", () => {
  const parsed = JSON.parse(run(["providers"]));
  assert.equal(parsed.length, 7);
});

test("providers --mcp-json returns mcp entries", () => {
  const parsed = JSON.parse(run(["providers", "--mcp-json"]));
  assert.equal(parsed.playwright.type, "local");
});

test("deps command reports dependency status", () => {
  const parsed = JSON.parse(run(["deps"]));
  assert.ok(Array.isArray(parsed.dependencies));
  assert.equal(parsed.dependencies.length, 7);
});

test("sync reports the scanned skill count", () => {
  const parsed = JSON.parse(run(["sync"]));
  assert.equal(typeof parsed.scanned, "number");
  assert.ok(Array.isArray(parsed.scanErrors));
});

test("categories and rules return arrays", () => {
  assert.ok(Array.isArray(JSON.parse(run(["categories"]))));
  assert.ok(Array.isArray(JSON.parse(run(["rules"]))));
});

test("skills can be filtered by category", () => {
  const parsed = JSON.parse(run(["skills", "--category", "code"]));
  assert.ok(Array.isArray(parsed));
});

test("report renders JSON and markdown", () => {
  const asJson = JSON.parse(run(["report"]));
  assert.equal(typeof asJson, "object");
  const asMarkdown = run(["report", "--format", "markdown"]);
  assert.ok(asMarkdown.length > 0);
});

test("clean reports a plan without deleting when not applied", () => {
  const parsed = JSON.parse(run(["clean", "--dry-run", "--json"]));
  assert.equal(parsed.applied, false);
  assert.equal(parsed.deleted, 0);
  assert.ok(Array.isArray(parsed.tables));
  assert.ok(parsed.tables.length > 0);
});

test("clean refuses to delete on a non interactive stdin without --apply", () => {
  const result = spawnSync(process.execPath, [cli, "clean", "--json"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  assert.equal(result.status, 1);
});

test("clean --apply removes only the rows older than the cutoff", () => {
  const seed = openDb(testDb);
  const insert = seed.prepare(
    "INSERT INTO enforcement_log (session_id, tool, file_path, file_class, decision, missing, matched_rules, logged_at) VALUES (?, ?, ?, ?, ?, '[]', '[]', ?)"
  );
  insert.run("clean-old", "edit", "a.md", "text", "allow", new Date(Date.now() - 40 * 86_400_000).toISOString());
  insert.run("clean-fresh", "edit", "b.md", "text", "allow", new Date().toISOString());
  seed.close();

  const parsed = JSON.parse(run(["clean", "--apply", "--days", "30", "--target", "logs", "--json"]));
  assert.equal(parsed.applied, true);
  assert.equal(parsed.deleted, 1);

  const check = openDb(testDb);
  const old = check.prepare("SELECT COUNT(*) AS n FROM enforcement_log WHERE session_id = ?").get("clean-old") as { n: number };
  const fresh = check.prepare("SELECT COUNT(*) AS n FROM enforcement_log WHERE session_id = ?").get("clean-fresh") as { n: number };
  check.close();
  assert.equal(old.n, 0);
  assert.equal(fresh.n, 1);
});

test("doctor reports its checks and a blocking verdict", () => {
  const parsed = JSON.parse(run(["doctor", "--json"]));
  assert.ok(Array.isArray(parsed.checks));
  const ids = parsed.checks.map((check: { id: string }) => check.id);
  for (const expected of ["node", "npx", "index", "referenced", "gate", "db", "adapter", "agent"]) {
    assert.ok(ids.includes(expected), `doctor should report the ${expected} check`);
  }
  assert.ok(Array.isArray(parsed.blocking));
});

test("tokens reports savings in JSON and text", () => {
  const parsed = JSON.parse(run(["tokens"]));
  assert.equal(typeof parsed.events, "number");
  const text = run(["tokens", "--format", "text"]);
  assert.ok(text.includes("events:"));
  const calibrate = run(["tokens", "--calibrate", "--format", "text"]);
  assert.ok(calibrate.includes("bytes/token"));
});

test("session-load and session-state round-trip", () => {
  const session = `cli-test-${Date.now().toString(36)}`;
  run(["session-load", "--session", session, "--skill", "humanizer"]);
  const state = JSON.parse(run(["session-state", "--session", session]));
  assert.ok(state.loaded.includes("humanizer"));
});
