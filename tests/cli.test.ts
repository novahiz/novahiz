import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadSpec } from "../src/spec.ts";
import { openDb } from "../src/db.ts";
import { scanSkills, writeCatalog, writeSkillIndex } from "../src/catalog.ts";
import { normalizeTodoInput } from "../src/commands/task.ts";
import { parseAnswer } from "../src/commands/context.ts";

test("parseAnswer accepts yes variants and defaults to no", () => {
  assert.equal(parseAnswer("y\n"), true);
  assert.equal(parseAnswer(" yes "), true);
  assert.equal(parseAnswer("oui"), true);
  assert.equal(parseAnswer("n"), false);
  assert.equal(parseAnswer(""), false);
  assert.equal(parseAnswer("garbage"), false);
});

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "src", "cli.ts");
const testDb = join(tmpdir(), `novahiz-cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.sqlite`);

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${testDb}${suffix}`, { force: true });
    } catch {
      // best effort cleanup
    }
  }
  try {
    rmSync(gateTestHome, { recursive: true, force: true });
  } catch {
    // best effort cleanup
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
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb, NOVAHIZ_GATE: "on" }
  });
  assert.equal(result.status, 1);
});

test("roadmap command returns the category roadmap", () => {
  const parsed = JSON.parse(run(["roadmap", "--category", "code"]));
  assert.equal(parsed.category, "code");
  assert.equal(parsed.roadmap.id, "feature");
});

test("does not gate a tool that is not in gate.tools", () => {
  const parsed = JSON.parse(run(["gate", "--tool", "read", "--file", "README.md"], { NOVAHIZ_GATE: "on" }));
  assert.equal(parsed.allow, true);
  assert.equal(parsed.reason, "tool is not gated");
});

// MINEUR#5: the plugin lowercases tool names before reaching the CLI, so an
// uppercase name used to slip past the case-sensitive gate.tools check.
test("MINEUR#5: tool names are case-insensitive in the CLI", () => {
  const parsed = JSON.parse(run(["gate", "--tool", "EDIT", "--file", "README.md"], { NOVAHIZ_GATE: "on" }));
  assert.notEqual(parsed.reason, "tool is not gated");
  assert.ok(Array.isArray(parsed.targets));
  assert.ok(parsed.targets.length > 0);
});

// MINEUR#6/#7: advisory modes report allow:true + wouldBlock (exit 0) instead
// of allow:false with exit 0, and a broken enforcement DB only blocks block
// mode — warn/audit degrade to a warning.
const gateTestHome = join(tmpdir(), `novahiz-gate-minor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

function writeGateHome(mode: "warn" | "block"): void {
  mkdirSync(gateTestHome, { recursive: true });
  const config = JSON.parse(readFileSync(join(root, "novahiz.config.json"), "utf8")) as Record<string, any>;
  config.gate.mode = mode;
  writeFileSync(join(gateTestHome, "novahiz.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  // loadSpec hard-fails without the catalog, so mirror it into the mini home.
  cpSync(join(root, "catalog"), join(gateTestHome, "catalog"), { recursive: true });
}

function runFull(
  args: string[],
  env: Record<string, string> = {}
): { status: number | null; out: Record<string, any> } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: gateTestHome, NOVAHIZ_GATE: "on", ...env }
  });
  return { status: result.status, out: JSON.parse(result.stdout.trim() || "{}") };
}

// design-ui matches R13/R14, whose required skills are never loadable in the
// mini home — so the run is always "blocked" (wouldBlock in advisory modes).
const blockedRunArgs = ["gate", "--tool", "write", "--file", "README.md", "--categories", "design-ui"];

test("MINEUR#6: warn mode reports allow:true + wouldBlock with exit 0", () => {
  writeGateHome("warn");
  const { status, out } = runFull(blockedRunArgs);
  assert.equal(status, 0);
  assert.equal(out.allow, true);
  assert.equal(out.wouldBlock, true);
  assert.equal(out.mode, "warn");
});

test("MINEUR#7: broken DB blocks block mode but degrades warn mode", () => {
  const corruptDb = join(tmpdir(), `novahiz-corrupt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.sqlite`);
  writeFileSync(corruptDb, "definitely not a sqlite database");
  try {
    writeGateHome("warn");
    const warnRun = runFull(blockedRunArgs, { NOVAHIZ_DB: corruptDb });
    assert.equal(warnRun.status, 0);
    assert.equal(warnRun.out.allow, true);
    const warnings = warnRun.out.warnings as string[];
    assert.ok(Array.isArray(warnings));
    assert.ok(warnings.some((w) => w.includes("enforcement trace unavailable")));

    writeGateHome("block");
    const blockRun = runFull(blockedRunArgs, { NOVAHIZ_DB: corruptDb });
    assert.equal(blockRun.status, 2);
    assert.equal(blockRun.out.allow, false);
  } finally {
    rmSync(corruptDb, { force: true });
  }
});

// MINEUR#8: cron command tools must be gated in the CLI defaults, the project
// config, and the plugin adapter fallback.
test("MINEUR#8: cron command tools are gated by default", () => {
  const cronTools = [
    "cron_add_command_task",
    "cron_update_command_task",
    "cron_update_task",
    "cron_run_task_now"
  ];
  const config = JSON.parse(readFileSync(join(root, "novahiz.config.json"), "utf8")) as Record<string, any>;
  for (const tool of cronTools) {
    assert.ok(config.gate.tools.includes(tool), `config gate.tools missing ${tool}`);
  }
  const spec = loadSpec(root);
  for (const tool of cronTools) {
    assert.ok(spec.config.gate.tools.includes(tool), `spec gate.tools missing ${tool}`);
  }
  const adapter = readFileSync(join(root, "adapters", "opencode", "novahiz.ts"), "utf8");
  assert.ok(adapter.includes('"cron_add_command_task"'), "adapter fallback missing cron tools");
});

test("gate surfaces required skills that are absent from the installed index", () => {
  const parsed = JSON.parse(run(["gate", "--tool", "edit", "--file", "README.md", "--categories", "docs-writing"], { NOVAHIZ_GATE: "on" }));
  assert.ok(Array.isArray(parsed.unmatchedRequired));
  assert.ok(Array.isArray(parsed.warnings));
});

test("classify output carries a primary and a roadmap", () => {
  const parsed = JSON.parse(run(["classify", "build a production supabase schema with rls and edge functions"]));
  assert.equal(parsed.primary, "database-supabase");
  assert.equal(parsed.roadmaps[0].category, "database-supabase");
  assert.ok(Array.isArray(parsed.enforcedSkills));
});

test("catalog rejects a non-numeric limit", () => {
  const result = spawnSync(process.execPath, [cli, "catalog", "design", "--limit", "abc"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--limit.*number|number.*--limit/);
});

test("an unknown command exits non-zero with a single clean line", () => {
  // Node 22 emits ExperimentalWarning (type stripping) on stderr; silence Node noise so only the CLI line remains.
  const result = spawnSync(process.execPath, ["--no-warnings", cli, "bogus"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  assert.equal(result.status, 1);
  const lines = result.stderr.trim().split("\n").filter((line) => line.trim().length > 0);
  assert.equal(lines.length, 1);
  assert.match(result.stderr, /unknown command .bogus./);
});

test("a missing install reports one clean line instead of a stack trace", () => {
  const missing = join(tmpdir(), `novahiz-absent-${Date.now().toString(36)}`);
  const result = spawnSync(process.execPath, ["--no-warnings", cli, "check"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: missing }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim().split("\n").length, 1);
  assert.match(result.stderr, /^novahiz: /);
});

test("check reports the stored last sync", () => {
  const parsed = JSON.parse(run(["check"]));
  assert.ok("lastSync" in parsed);
});

test("providers command lists the bundled providers", () => {
  const parsed = JSON.parse(run(["providers"]));
  assert.equal(parsed.length, 10);
});

test("providers --mcp-json returns mcp entries", () => {
  const parsed = JSON.parse(run(["providers", "--mcp-json"]));
  assert.equal(parsed.playwright.type, "local");
});

test("deps command reports dependency status", () => {
  const parsed = JSON.parse(run(["deps"]));
  assert.ok(Array.isArray(parsed.dependencies));
  assert.equal(parsed.dependencies.length, 10);
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
  const asJson = JSON.parse(run(["report", "--json"]));
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

  test("a numeric flag out of range is rejected instead of falling back", () => {
    const cases: [string[], RegExp][] = [
      [["clean", "--days", "0", "--dry-run"], /minimum limit of 1/],
      [["catalog", "gate", "--limit", "2.5"], /integer/],
      [["classify", "text", "--min-score", "-1"], /minimum limit of 0/]
    ];
    for (const [args, expected] of cases) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        input: "",
        env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
      });
      assert.equal(result.status, 1, `${args.join(" ")} should fail`);
      assert.match(result.stderr, expected);
    }
  });

  test("doctor reports its checks and a blocking verdict", () => {
  const parsed = JSON.parse(run(["doctor", "--json"]));
  assert.ok(Array.isArray(parsed.checks));
  const ids = parsed.checks.map((check: { id: string }) => check.id);
    for (const expected of ["node", "npx", "index", "referenced", "cli", "gate", "db", "schema", "adapter", "agent", "memory", "memory-tools"]) {
    assert.ok(ids.includes(expected), `doctor should report the ${expected} check`);
  }
  assert.ok(Array.isArray(parsed.blocking));
});

test("tokens reports savings in JSON and text", () => {
  const parsed = JSON.parse(run(["tokens", "--json"]));
  assert.equal(typeof parsed.events, "number");
  const text = run(["tokens", "--format", "text"]);
  assert.ok(text.includes("events:"));
  const calibrate = JSON.parse(run(["tokens", "--json", "--calibrate"]));
  assert.equal(typeof calibrate.estimatedBytesSaved, "number");
});

test("session-load and session-state round-trip", () => {
  const session = `cli-test-${Date.now().toString(36)}`;
run(["session-load", "--session", session, "--skill", "novahiz-humanizer"]);
   const state = JSON.parse(run(["session-state", "--session", session]));
   assert.ok(state.loaded.includes("novahiz-humanizer"));
});

test("C1: --prompt drives the gate tier", () => {
  const parsed = JSON.parse(
    run([
      "gate",
      "--tool",
      "edit",
      "--file",
      "src/app.ts",
      "--categories",
      "code",
      "--content",
      "const x = 1;",
      "--prompt",
      "Implement a complete authentication system with database schema, security tests and session handling across multiple files"
    ], { NOVAHIZ_GATE: "on" })
  );
  assert.equal(parsed.targets[0].tier, "full");
});

test("C2: gate.enabled=false in config does not disable enforcement", () => {
  const home = join(tmpdir(), `novahiz-cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(home, { recursive: true });
  cpSync(join(root, "catalog"), join(home, "catalog"), { recursive: true });
  writeFileSync(join(home, "novahiz.config.json"), JSON.stringify({ gate: { enabled: false, mode: "block" } }));
  const result = spawnSync(process.execPath, [cli, "gate", "--tool", "edit", "--file", "src/hero.css"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: home, NOVAHIZ_DB: testDb, NOVAHIZ_GATE: "on" }
  });
  rmSync(home, { recursive: true, force: true });
  const parsed = JSON.parse(result.stdout.trim());
  assert.notEqual(parsed.disabled, true);
  assert.equal(parsed.allow, false);
  assert.match(result.stderr, /enabled=false.*ignored/);
});

test("P0-B: classify --stdin accepts a prompt larger than the argv limit", () => {
  // >32767 chars would break Windows argv; stdin has no such limit.
  const prompt = `implement a complete authentication system with database schema ${"and security tests ".repeat(2100)}`;
  assert.ok(prompt.length > 32_767, "prompt must exceed the Windows argv limit");
  const result = spawnSync(process.execPath, [cli, "classify", "--stdin"], {
    encoding: "utf8",
    input: prompt,
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout.trim());
  // commandClassify trims the received text before echoing it.
  assert.equal(parsed.prompt, prompt.trim());
});

test("P0-B: session-load validates the name format and the installed index", () => {
  const session = `cli-idx-${Date.now().toString(36)}`;
  const base = { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb };
  const unknown = spawnSync(process.execPath, [cli, "session-load", "--session", session, "--skill", "no-such-skill-xyz"], {
    encoding: "utf8",
    input: "",
    env: base
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /unknown skill/);
  const malformed = spawnSync(process.execPath, [cli, "session-load", "--session", session, "--skill", "evil,name"], {
    encoding: "utf8",
    input: "",
    env: base
  });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stdout, /invalid skill name/);
  const known = spawnSync(process.execPath, [cli, "session-load", "--session", session, "--skill", "novahiz-humanizer"], {
    encoding: "utf8",
    input: "",
    env: base
  });
  assert.equal(known.status, 0);
});

test("task resume and current dispatch without an active task", () => {
  const current = JSON.parse(run(["task", "current", "--session", "cli-missing-session"]));
  assert.equal(current.error, undefined);
  assert.equal(current.task, null);
  assert.equal(typeof current.todos, "number");
  const resumed = JSON.parse(run(["task", "resume", "--session", "cli-missing-session"]));
  assert.equal(resumed.error, undefined);
  assert.ok(Array.isArray(resumed.summary));
  assert.equal(resumed.next, null);
});

test("normalizeTodoInput rejects an unknown kind and defaults to edit", () => {
  assert.throws(() => normalizeTodoInput({ label: "x", kind: "bogus" }), /invalid todo kind/);
  assert.equal(normalizeTodoInput({ label: "x" }).kind, "edit");
});

// MAJEUR l.135: bash/shell/cron with no target path must still enforce
// prompt-scoped rules instead of passing unconditionally.
test("MAJEUR l.135: pathless bash enforces prompt-scoped rules", () => {
  writeGateHome("block");
  const result = spawnSync(process.execPath, [cli, "gate", "--tool", "bash", "--args-stdin", "--categories", "database-supabase"], {
    encoding: "utf8",
    input: JSON.stringify({}),
    env: { ...process.env, NOVAHIZ_HOME: gateTestHome, NOVAHIZ_GATE: "on" }
  });
  assert.equal(result.status, 2);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.allow, false);
  assert.ok((out.requiredSkills as string[]).includes("novahiz-supabase"));
  assert.equal(out.targets[0].path, "");
});

test("MAJEUR l.135: pathless bash without matching categories stays allowed", () => {
  writeGateHome("block");
  const result = spawnSync(process.execPath, [cli, "gate", "--tool", "bash", "--args-stdin"], {
    encoding: "utf8",
    input: JSON.stringify({}),
    env: { ...process.env, NOVAHIZ_HOME: gateTestHome, NOVAHIZ_GATE: "on" }
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.allow, true);
  assert.deepEqual(out.missingSkills, []);
  assert.equal(out.wouldBlock, undefined);
});
