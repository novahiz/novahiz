import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
// @ts-expect-error -- install/hooks.mjs is untyped JavaScript by design
import { isNovahizHandler, mergeHooks } from "../install/hooks.mjs";
// @ts-expect-error -- install/prompt.mjs is untyped JavaScript by design
import { createPrompt } from "../install/prompt.mjs";
// @ts-expect-error -- install/lib.mjs is untyped JavaScript by design
import { detectedHarnesses } from "../install/lib.mjs";
// @ts-expect-error -- install/uninstall.mjs is untyped JavaScript by design
import { underHome, withinDir } from "../install/uninstall.mjs";

test("underHome keeps only paths inside the home directory", () => {
  assert.equal(underHome(join(homedir(), "novahiz", "settings.json")), true);
  assert.equal(underHome("/etc/passwd"), false);
});

test("withinDir scopes an uninstall to one harness", () => {
  const claude = join(homedir(), ".claude");
  assert.equal(withinDir(join(claude, "settings.json"), claude), true);
  assert.equal(withinDir(join(claude, "skills", "novahiz-humanizer", "SKILL.md"), claude), true);
  assert.equal(withinDir(claude, claude), true);
  assert.equal(withinDir(join(homedir(), ".config", "opencode", "plugins", "novahiz.ts"), claude), false);
  assert.equal(withinDir(join(homedir(), ".claudex", "settings.json"), claude), false);
});

test("select parses numbered multi-select and keeps defaults on Enter", async () => {
  const selectOnce = async (lines: string[], defaults: string[]) => {
    const input = Readable.from(lines);
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });
    const prompt = createPrompt(input, output);
    try {
      // One question per prompt: readline closes itself when the piped
      // input reaches EOF, so a second question would hit a closed
      // interface (ERR_USE_AFTER_CLOSE).
      return await prompt.select("Which harnesses?", ["opencode", "claude", "codex"], defaults);
    } finally {
      prompt.close();
    }
  };

  // "2" alone: only claude comes back.
  assert.deepEqual(await selectOnce(["2\n"], ["opencode"]), ["claude"]);

  // Enter keeps the checked defaults.
  assert.deepEqual(await selectOnce(["\n"], ["opencode", "claude"]), ["opencode", "claude"]);
});

test("detectedHarnesses reports CLI presence or an existing config dir", () => {
  const dirs = {
    opencode: join(homedir(), "novahiz-missing-opencode"),
    claude: join(homedir(), "novahiz-missing-claude"),
    codex: homedir()
  };
  const whichFn = (name: string) => name === "claude";
  // claude via CLI, codex via config dir, opencode entirely absent.
  assert.deepEqual(detectedHarnesses(dirs, whichFn), ["claude", "codex"]);
});

test("isNovahizHandler recognizes novahiz hook commands", () => {
  assert.equal(
    isNovahizHandler({
      type: "command",
      command: 'node "/home/u/novahiz/src/cli.ts" --home "/home/u/novahiz" hook --harness claude --event PreToolUse'
    }),
    true
  );
  assert.equal(isNovahizHandler({ type: "command", command: "npm run build" }), false);
  assert.equal(isNovahizHandler({ type: "command", command: "node unrelated-script.ts" }), false);
  assert.equal(isNovahizHandler(undefined), false);
});

test("mergeHooks preserves foreign groups and replaces novahiz ones", () => {
  const foreign = { matcher: "Bash", hooks: [{ type: "command", command: "echo foreign" }] };
  const stale = {
    matcher: "Bash",
    hooks: [{ type: "command", command: 'node "/old/home/src/cli.ts" hook --harness claude --event PreToolUse' }]
  };
  const stopForeign = { hooks: [{ type: "command", command: "echo stop" }] };
  const current = { hooks: { PreToolUse: [foreign, stale], Stop: [stopForeign] }, model: "opus" };
  const fresh = {
    matcher: "Skill|Read|Edit|Write",
    hooks: [{ type: "command", command: 'node "/new/home/src/cli.ts" hook --harness claude --event PreToolUse' }]
  };
  const merged = mergeHooks(current, { hooks: { PreToolUse: [fresh] } });
  assert.deepEqual(merged.hooks.PreToolUse, [foreign, fresh]);
  assert.deepEqual(merged.hooks.Stop, [stopForeign]);
  assert.equal(merged.model, "opus");
  assert.equal(merged.hooks.PreToolUse.length, 2);
});
