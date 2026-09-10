import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { claudeDenyOutput, decideHook, extractSkillName, normalizeTool } from "../src/hook.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);
const cli = join(root, "src", "cli.ts");

test("normalizes claude tool names", () => {
  assert.equal(normalizeTool("claude", "Edit"), "edit");
  assert.equal(normalizeTool("claude", "MultiEdit"), "edit");
  assert.equal(normalizeTool("claude", "Write"), "write");
  assert.equal(normalizeTool("claude", "Bash"), "bash");
  assert.equal(normalizeTool("claude", "PowerShell"), "shell");
  assert.equal(normalizeTool("claude", "Skill"), "skill");
});

test("normalizes codex tool names", () => {
  assert.equal(normalizeTool("codex", "apply_patch"), "patch");
  assert.equal(normalizeTool("codex", "shell"), "bash");
  assert.equal(normalizeTool("codex", "write"), "write");
  assert.equal(normalizeTool("codex", "edit_file"), "edit");
});

test("extracts a skill name from several input shapes", () => {
  assert.equal(extractSkillName({ skill: "humanizer" }), "humanizer");
  assert.equal(extractSkillName({ name: "impeccable" }), "impeccable");
  assert.equal(extractSkillName({ command: "/humanizer" }), "humanizer");
  assert.equal(extractSkillName({}), null);
});

test("decideHook blocks a claude edit without loaded skills", () => {
  const decision = decideHook(spec, "claude", "Edit", { file_path: "src/app.ts" });
  assert.equal(decision.kind, "evaluate");
  if (decision.kind !== "evaluate") return;
  assert.equal(decision.block, true);
  assert.ok(decision.missing.includes("humanizer"));
});

test("decideHook passes a read-only shell command", () => {
  const decision = decideHook(spec, "codex", "shell", { command: "git status" });
  assert.equal(decision.kind, "pass");
});

test("claudeDenyOutput carries a deny decision", () => {
  const parsed = JSON.parse(claudeDenyOutput("missing humanizer"));
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
});

test("cli hook returns a deny payload for a claude edit", () => {
  const payload = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/app.ts" }, session_id: "test-hook" });
  const result = spawnSync(process.execPath, [cli, "hook", "--harness", "claude", "--event", "PreToolUse"], {
    encoding: "utf8",
    input: payload,
    env: { ...process.env, NOVAHIZ_HOME: root }
  });
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("cli hook allows a read-only command silently", () => {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" }, session_id: "test-hook-2" });
  const result = spawnSync(process.execPath, [cli, "hook", "--harness", "claude", "--event", "PreToolUse"], {
    encoding: "utf8",
    input: payload,
    env: { ...process.env, NOVAHIZ_HOME: root }
  });
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.status, 0);
});
