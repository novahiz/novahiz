import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { claudeDenyOutput, decideHook, extractSkillName, normalizeTool, unmatchedMessage } from "../src/hook.ts";
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

test("extracts a skill name from several input shapes", () => {
  assert.equal(extractSkillName({ skill: "humanizer" }), "humanizer");
  assert.equal(extractSkillName({ command: "/humanizer" }), "humanizer");
  assert.equal(extractSkillName({}), null);
});

test("decideHook blocks a claude edit that adds prose", () => {
  const decision = decideHook(spec, "claude", "Edit", { file_path: "src/app.ts", new_string: PROSE });
  assert.equal(decision.kind, "evaluate");
  if (decision.kind !== "evaluate") return;
  assert.equal(decision.block, true);
  assert.ok(decision.missing.includes("humanizer"));
});

test("decideHook passes a pure logic edit", () => {
  const decision = decideHook(spec, "claude", "Edit", { file_path: "src/app.ts", new_string: "const x = 1;" });
  assert.equal(decision.kind, "evaluate");
  if (decision.kind !== "evaluate") return;
  assert.equal(decision.block, false);
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

test("cli hook denies a markdown edit without loaded skills", () => {
  const out = runHook({ tool_name: "Edit", tool_input: { file_path: "README.md", new_string: "texte" }, session_id: "hook-deny" });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("cli hook allows the edit once the skill is loaded (C1 regression)", () => {
  runHook({ tool_name: "Skill", tool_input: { skill: "humanizer" }, session_id: "hook-c1" });
  const out = runHook({ tool_name: "Edit", tool_input: { file_path: "README.md", new_string: "texte" }, session_id: "hook-c1" });
  assert.equal(out.stdout, "");
  assert.equal(out.status, 0);
});

test("cli hook allows a read-only command silently", () => {
  const out = runHook({ tool_name: "Bash", tool_input: { command: "git status" }, session_id: "hook-read" });
  assert.equal(out.stdout, "");
  assert.equal(out.status, 0);
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
  assert.ok(decision.missing.includes("security-guidance"));
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
