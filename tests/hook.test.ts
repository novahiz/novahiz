import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { claudeDenyOutput, decideHook, extractReadSkill, extractSkillName, normalizeTool, unmatchedMessage } from "../src/hook.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);
const cli = join(root, "src", "cli.ts");
const testDb = join(tmpdir(), `novahiz-hook-${Date.now().toString(36)}.sqlite`);

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${testDb}${suffix}`, { force: true });
    } catch {
      // best effort cleanup
    }
  }
});
const PROSE = "// Ce commentaire explique le calcul du total de la commande pour le client";

function runHook(payload: object, extra: string[] = []): { stdout: string; status: number } {
  const args = [cli, "hook", "--harness", "claude", "--event", "PreToolUse", ...extra];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  return { stdout: result.stdout.trim(), status: result.status ?? 0 };
}

test("normalizes claude and codex tool names", () => {
  assert.equal(normalizeTool("claude", "Edit"), "edit");
  assert.equal(normalizeTool("claude", "PowerShell"), "shell");
  assert.equal(normalizeTool("codex", "apply_patch"), "patch");
  assert.equal(normalizeTool("codex", "shell"), "bash");
});

test("normalizes MCP tool names to their bare gate name", () => {
  // mcp__novahiz__cron_add_task must reach the gate as cron_add_task; the
  // codex "command"/"exec" heuristics must not reroute cron tools to bash.
  assert.equal(normalizeTool("claude", "mcp__novahiz__cron_add_task"), "cron_add_task");
  assert.equal(normalizeTool("codex", "mcp__novahiz__cron_update_command_task"), "cron_update_command_task");
});

test("extracts a skill name from several input shapes", () => {
  assert.equal(extractSkillName({ skill: "humanizer" }), "humanizer");
  assert.equal(extractSkillName({ command: "/humanizer" }), "humanizer");
  assert.equal(extractSkillName({}), null);
});

test("decideHook blocks a claude edit that adds prose", () => {
  // css target: R13 requires the design-craft skills on that path, so the
  // missing-skill assertion keeps its original intent (humanizer unloaded).
  const decision = decideHook(spec, "claude", "Edit", { file_path: "src/styles.css", new_string: PROSE });
  assert.equal(decision.kind, "evaluate");
  if (decision.kind !== "evaluate") return;
  assert.equal(decision.block, true);
  assert.ok(decision.missing.includes("novahiz-humanizer"));
});

test("decideHook passes a pure logic edit", () => {
  const decision = decideHook(spec, "claude", "Edit", { file_path: "src/app.ts", new_string: "const x = 1;" });
  assert.equal(decision.kind, "evaluate");
  if (decision.kind !== "evaluate") return;
  assert.equal(decision.block, false);
});

test("decideHook passes an ungated harness tool without evaluation", () => {
  const decision = decideHook(spec, "claude", "Glob", { pattern: "**/*.ts" });
  assert.equal(decision.kind, "pass");
});

test("decideHook evaluates MCP cron tools instead of passing them", () => {
  const decision = decideHook(spec, "claude", "mcp__novahiz__cron_add_task", { command: "node run.js" });
  assert.equal(decision.kind, "evaluate");
  if (decision.kind !== "evaluate") return;
  assert.equal(decision.tool, "cron_add_task");
});

test("claudeDenyOutput carries a deny decision", () => {
  const parsed = JSON.parse(claudeDenyOutput("missing humanizer"));
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("unmatchedMessage names the skills missing from the installed index", () => {
  const decision = {
    kind: "evaluate" as const,
    tool: "edit",
    paths: ["src/hero.css"],
    results: [],
    block: false,
    missing: [],
    unmatched: ["impeccable"]
  };
  const message = unmatchedMessage(decision);
  assert.ok(message.includes("impeccable"));
  assert.ok(message.includes("novahiz sync"));
});

test("reading a skill file registers the load on a harness without a skill tool", () => {
  const decision = decideHook(spec, "claude", "Read", { file_path: "C:/Users/x/.claude/skills/humanizer/SKILL.md" });
  assert.equal(decision.kind, "skill");
  assert.equal(decision.skill, "humanizer");
});

test("a read that is not a skill file passes without gating", () => {
  const decision = decideHook(spec, "claude", "Read", { file_path: "docs/ROADMAPS.md" });
  assert.equal(decision.kind, "pass");
});

test("extractReadSkill only matches a direct SKILL.md below a skills folder", () => {
  assert.equal(extractReadSkill({ file_path: "src/hook.ts" }), null);
  assert.equal(extractReadSkill({ file_path: "a/skills/novahiz-plan/README.md" }), null);
  assert.equal(extractReadSkill({ file_path: "a/skills/novahiz-plan/SKILL.md" }), "novahiz-plan");
  assert.equal(extractReadSkill({}), null);
});

test("cli hook denies a markdown edit without loaded skills", () => {
  const out = runHook({ tool_name: "Edit", tool_input: { file_path: "README.md", new_string: PROSE }, session_id: "hook-deny" });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  // The denial must be actionable: AUTO-REPAIR names the skills to load.
  assert.ok(parsed.hookSpecificOutput.permissionDecisionReason.includes("AUTO-REPAIR"));
});

test("cli hook allows the edit once the skills are loaded (C1 regression)", () => {
  runHook({ tool_name: "Skill", tool_input: { skill: "novahiz-implement" }, session_id: "hook-c1" });
  runHook({ tool_name: "Skill", tool_input: { skill: "novahiz-converge" }, session_id: "hook-c1" });
  const out = runHook(
    { tool_name: "Edit", tool_input: { file_path: "README.md", new_string: PROSE }, session_id: "hook-c1" }
  );
  assert.equal(out.stdout, "");
  assert.equal(out.status, 0);
});

test("cli hook allows a read-only command silently", () => {
  const out = runHook({ tool_name: "Bash", tool_input: { command: "git status" }, session_id: "hook-read" });
  assert.equal(out.stdout, "");
  assert.equal(out.status, 0);
});

test("cli hook escalates the repair directive when the loads never registered", () => {
  const payload = {
    tool_name: "Edit",
    tool_input: { file_path: "docs/ROADMAPS.md", new_string: PROSE },
    session_id: "hook-attempt"
  };
  const first = runHook(payload);
  assert.equal(JSON.parse(first.stdout).hookSpecificOutput.permissionDecision, "deny");
  const second = runHook(payload);
  const reason = JSON.parse(second.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.ok(reason.includes("attempt 2"), `expected escalation, got: ${reason.slice(0, 200)}`);
});

test("decideHook requires roadmap skills for the prompt category", () => {
  const decision = decideHook(
    spec,
    "claude",
    "Edit",
    { file_path: "src/app.ts", new_string: "const x = 1;" },
    { categories: ["audit"] }
  );
  assert.equal(decision.kind, "evaluate");
  if (decision.kind !== "evaluate") return;
  assert.equal(decision.block, true);
  assert.ok(decision.missing.includes("novahiz-security"));
});

test("cli hook blocks on an explicit category", () => {
  const out = runHook(
    { tool_name: "Edit", tool_input: { file_path: "src/app.ts", new_string: "const x = 1;" }, session_id: "hook-cat" },
    ["--categories", "audit"]
  );
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("cli hook infers the category from a supabase migration path", () => {
  const out = runHook(
    {
      tool_name: "Write",
      tool_input: { file_path: "supabase/migrations/001_init.sql", content: "create table account (id uuid primary key);" },
      session_id: "hook-supabase"
    },
    []
  );
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("codex gets an advisory line instead of a deny payload", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "hook", "--harness", "codex", "--event", "PreToolUse"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "apply_patch",
        tool_input: { patch: "*** Begin Patch\n*** Update File: README.md\n" },
        session_id: "hook-codex"
      }),
      env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
    }
  );
  const stdout = result.stdout.trim();
  assert.ok(stdout.startsWith("Novahiz advisory:"), stdout.slice(0, 200));
  assert.ok(!stdout.includes("permissionDecision"));
});
