import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
// @ts-expect-error -- install/hooks.mjs is untyped JavaScript by design
import { isNovahizHandler, mergeHooks } from "../install/hooks.mjs";
// @ts-expect-error -- install/uninstall.mjs is untyped JavaScript by design
import { underHome } from "../install/uninstall.mjs";

test("isNovahizHandler recognizes novahiz hook commands", () => {
  assert.equal(isNovahizHandler({ command: 'node "C:/x/novahiz/src/cli.ts" hook --harness claude --event PreToolUse' }), true);
  assert.equal(isNovahizHandler({ command: "echo hello" }), false);
});

test("mergeHooks preserves foreign groups and replaces novahiz ones", () => {
  const existing = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo foreign" }] },
        { matcher: "Edit", hooks: [{ type: "command", command: 'node "x/cli.ts" hook --harness claude --event PreToolUse' }] }
      ]
    }
  };
  const generated = {
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: 'node "x/cli.ts" hook --harness claude --event PreToolUse' }] }
      ]
    }
  };
  const merged = mergeHooks(existing, generated);
  const groups: any[] = merged.hooks.PreToolUse;
  assert.ok(groups.some((group: any) => group.hooks.some((handler: any) => handler.command === "echo foreign")));
  const ours = groups.filter((group: any) => group.hooks.some(isNovahizHandler));
  assert.equal(ours.length, 1);
  assert.equal(ours[0].matcher, "Edit|Write");
});

test("underHome keeps only paths inside the home directory", () => {
  assert.equal(underHome(join(homedir(), "novahiz", "settings.json")), true);
  assert.equal(underHome("/etc/passwd"), false);
});
