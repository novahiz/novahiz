import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
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

test("hook Stop prints a roadmap summary", () => {
  const out = runWithInput(["hook", "--harness", "codex", "--event", "Stop"], { session_id: "stop-session" });
  assert.ok(out.includes("roadmap steps"));
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

// novahiz.config.json is gitignored user state: a fresh clone — including CI —
// only carries the example, which is structurally identical for these assertions.
function rootConfigPath(): string {
  const configPath = join(root, "novahiz.config.json");
  return existsSync(configPath) ? configPath : join(root, "novahiz.config.example.json");
}

function writeGateHome(mode: "warn" | "block"): void {
  mkdirSync(gateTestHome, { recursive: true });
  const config = JSON.parse(readFileSync(rootConfigPath(), "utf8")) as Record<string, any>;
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

// MINEUR#8 + 0.3.6: cron command tools must be gated in the CLI defaults, the
// project config, and the plugin adapter fallback. cron_add_task,
// cron_add_ai_task and cron_add_http_task all accept a `command` field, so a
// shell command can reach an executor through them exactly like
// cron_add_command_task did.
test("MINEUR#8: cron command tools are gated by default", () => {
  const cronTools = [
    "cron_add_command_task",
    "cron_add_task",
    "cron_add_ai_task",
    "cron_add_http_task",
    "cron_update_command_task",
    "cron_update_task",
    "cron_run_task_now"
  ];
  const config = JSON.parse(readFileSync(rootConfigPath(), "utf8")) as Record<string, any>;
  for (const tool of cronTools) {
    assert.ok(config.gate.tools.includes(tool), `config gate.tools missing ${tool}`);
  }
  const spec = loadSpec(root);
  for (const tool of cronTools) {
    assert.ok(spec.config.gate.tools.includes(tool), `spec gate.tools missing ${tool}`);
  }
  const adapter = readFileSync(join(root, "adapters", "opencode", "novahiz.ts"), "utf8");
  for (const tool of cronTools) {
    assert.ok(adapter.includes(`"${tool}"`), `adapter fallback missing ${tool}`);
  }
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

test("a virgin home still checks from the package catalog", () => {
  const virgin = join(tmpdir(), `novahiz-virgin-${Date.now().toString(36)}`);
  const result = spawnSync(process.execPath, ["--no-warnings", cli, "check"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: virgin }
  });
  assert.equal(result.status, 0, `unexpected failure: ${result.stderr}`);
  assert.equal(result.stderr.trim(), "", "no stack trace, no warnings");
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.categories > 0, "package catalog served the categories");
  assert.equal(parsed.installedSkills, 0, "still reports the untouched install");
  assert.equal(parsed.indexAvailable, false);
  assert.equal(parsed.lastSync, null);
});

test("a corrupted home catalog reports one clean line instead of a stack trace", () => {
  const broken = join(tmpdir(), `novahiz-broken-${Date.now().toString(36)}`);
  mkdirSync(join(broken, "catalog"), { recursive: true });
  writeFileSync(join(broken, "catalog", "categories.json"), "{ not json", "utf8");
  try {
    const result = spawnSync(process.execPath, ["--no-warnings", cli, "check"], {
      encoding: "utf8",
      input: "",
      env: { ...process.env, NOVAHIZ_HOME: broken }
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim().split("\n").length, 1);
    assert.match(result.stderr, /^novahiz: /);
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
});

test("check reports the stored last sync", () => {
  const parsed = JSON.parse(run(["check"]));
  assert.ok("lastSync" in parsed);
});

test("providers command lists the bundled providers", () => {
  const parsed = JSON.parse(run(["providers"]));
  assert.equal(parsed.length, 11);
});

test("providers --mcp-json returns mcp entries", () => {
  const parsed = JSON.parse(run(["providers", "--mcp-json"]));
  assert.equal(parsed.playwright.type, "local");
});

test("deps command reports dependency status", () => {
  const parsed = JSON.parse(run(["deps"]));
  assert.ok(Array.isArray(parsed.dependencies));
  assert.equal(parsed.dependencies.length, 11);
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

// WS3: graft fail() used to only set exitCode, letting the switch keep going
// ("graft not found" then a spawn anyway, or a usage fail then commitGraft("").
// It must exit at once, with exactly one error line and no stdout.
test("WS3: graft fail() exits at once with a single error line", () => {
  const result = spawnSync(process.execPath, [cli, "graft", "commit", "-m", "x"], {
    encoding: "utf8",
    input: "",
    env: {
      ...process.env,
      NOVAHIZ_HOME: root,
      NOVAHIZ_DB: testDb,
      NOVAHIZ_GRAFT_BIN: join(tmpdir(), "no-such-graft-binary-ws3")
    }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "");
  const lines = String(result.stderr)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(lines.length, 1);
  // Environment-dependent message (graft installed → "not initialized",
  // absent → "CLI not found"); the property is: one line, then exit.
  assert.match(lines[0], /^error: graft (CLI not found|not initialized)/);
});

test("normalizeTodoInput rejects an unknown kind and defaults to edit", () => {
  assert.throws(() => normalizeTodoInput({ label: "x", kind: "bogus" }), /invalid todo kind/);
  assert.equal(normalizeTodoInput({ label: "x" }).kind, "edit");
});

// WS3: --position was cast without validation, so any string reached
// insertTodo. An unknown value must be rejected before anything is written,
// while the documented forms (number, start, end) keep working.
test("WS3: task insert rejects an invalid --position and writes nothing", () => {
  const env = { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb };
  const created = spawnSync(process.execPath, [cli, "task", "new", "--title", "PosFix", "--session", "pos-fix"], {
    encoding: "utf8",
    input: "",
    env
  });
  assert.equal(created.status, 0);
  const bad = spawnSync(
    process.execPath,
    [cli, "task", "insert", "--session", "pos-fix", "--label", "x", "--position", "middle"],
    { encoding: "utf8", input: "", env }
  );
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stdout.trim()).error, /invalid position/);
  assert.equal(JSON.parse(run(["task", "current", "--session", "pos-fix"])).todos, 0);
  const ok = run(["task", "insert", "--session", "pos-fix", "--label", "y", "--position", "start"]);
  assert.equal(JSON.parse(ok).todo.status, "pending");
  assert.equal(JSON.parse(run(["task", "current", "--session", "pos-fix"])).todos, 1);
});

// WS3 MEDIUM: the catalog is not signed, so `providers/deps --install` must
// plan by default, execute only under --yes, and may only start a binary from
// the bootstrap allowlist (node/npm/npx/uv/uvx/python/py).
const installHome = join(tmpdir(), `novahiz-ws3-install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
const markerScript = join(installHome, "marker.mjs").replace(/\\/g, "/");
const markerFile = join(installHome, "marker.txt");

function writeInstallHome(install: string[]): void {
  rmSync(installHome, { recursive: true, force: true });
  mkdirSync(join(installHome, "catalog"), { recursive: true });
  writeFileSync(
    join(installHome, "marker.mjs"),
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(markerFile)}, "ran");\n`,
    "utf8"
  );
  writeFileSync(
    join(installHome, "catalog", "providers.json"),
    JSON.stringify([{ id: "ws3-test", kind: "cli", label: "ws3", source: "test", categories: [], install }]),
    "utf8"
  );
}

after(() => {
  try {
    rmSync(installHome, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

test("WS3: providers --install plans without executing and --yes runs an allowlisted command", () => {
  writeInstallHome(["node", markerScript]);
  const plan = JSON.parse(run(["providers", "--install"], { NOVAHIZ_HOME: installHome }));
  assert.ok(Array.isArray(plan.plan));
  assert.equal(plan.plan[0].id, "ws3-test");
  assert.match(plan.note, /--yes/);
  assert.equal(existsSync(markerFile), false, "the plan must not execute anything");
  const exec = spawnSync(process.execPath, [cli, "providers", "--install", "--yes"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: installHome, NOVAHIZ_DB: testDb }
  });
  assert.equal(exec.status, 0, exec.stderr);
  const lines = exec.stdout.trim().split("\n");
  const results = JSON.parse(lines[lines.length - 1]);
  assert.equal(results[0].ok, true, `install failed: ${exec.stdout} ${exec.stderr}`);
  assert.equal(existsSync(markerFile), true, "--yes must execute the allowlisted command");
});

test("WS3: providers --install --yes refuses a binary outside the allowlist", () => {
  writeInstallHome(["evil-bin", "--version"]);
  const exec = spawnSync(process.execPath, [cli, "providers", "--install", "--yes"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: installHome, NOVAHIZ_DB: testDb }
  });
  const lines = exec.stdout.trim().split("\n");
  const results = JSON.parse(lines[lines.length - 1]);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /refused disallowed bootstrap binary/);
});

test("WS3: deps --install plans without executing until --yes", () => {
  writeInstallHome(["node", markerScript]);
  const plan = JSON.parse(run(["deps", "--install"], { NOVAHIZ_HOME: installHome }));
  assert.ok(Array.isArray(plan.plan));
  assert.match(plan.note, /--yes/);
  assert.equal(existsSync(markerFile), false, "the plan must not execute anything");
  const exec = spawnSync(process.execPath, [cli, "deps", "--install", "--yes"], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NOVAHIZ_HOME: installHome, NOVAHIZ_DB: testDb }
  });
  assert.equal(exec.status, 0, exec.stderr);
  const lines = exec.stdout.trim().split("\n");
  const results = JSON.parse(lines[lines.length - 1]);
  assert.equal(results[0].step, "install");
  assert.equal(results[0].ok, true, `install failed: ${exec.stdout} ${exec.stderr}`);
  assert.equal(existsSync(markerFile), true, "--yes must execute the allowlisted command");
});

// WS3: --done used to reach the database without validation; an off-pattern
// step id must be rejected before anything is written, while the documented
// roadmap ids (kebab-case) keep working.
test("WS3: step rejects an invalid step id and writes nothing", () => {
  const env = { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb };
  const bad = spawnSync(process.execPath, [cli, "step", "--session", "ws3-step", "--done", "../../evil step"], {
    encoding: "utf8",
    input: "",
    env
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /invalid step id/);
  assert.equal(JSON.parse(run(["step", "--session", "ws3-step"])).steps.length, 0, "nothing may be written");
  run(["step", "--session", "ws3-step", "--done", "impeccable-critique"]);
  assert.equal(JSON.parse(run(["step", "--session", "ws3-step"])).steps.length, 1, "a valid kebab id still works");
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
