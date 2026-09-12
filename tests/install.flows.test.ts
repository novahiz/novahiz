import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
// @ts-expect-error -- install/uninstall.mjs is untyped JavaScript by design
import { underHome, withinDir } from "../install/uninstall.mjs";

test("underHome keeps only paths inside the home directory", () => {
  assert.equal(underHome(join(homedir(), "novahiz", "settings.json")), true);
  assert.equal(underHome("/etc/passwd"), false);
});

test("withinDir scopes an uninstall to one harness", () => {
  const claude = join(homedir(), ".claude");
  assert.equal(withinDir(join(claude, "settings.json"), claude), true);
  assert.equal(withinDir(join(claude, "skills", "humanizer", "SKILL.md"), claude), true);
  assert.equal(withinDir(claude, claude), true);
  assert.equal(withinDir(join(homedir(), ".config", "opencode", "plugins", "novahiz.ts"), claude), false);
  assert.equal(withinDir(join(homedir(), ".claudex", "settings.json"), claude), false);
});
