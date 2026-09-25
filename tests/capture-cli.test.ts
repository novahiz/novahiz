import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts", "capture-cli.mjs");

function runCapture(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("capture refuses a --label that would escape the output directory", () => {
  const base = mkdtempSync(join(tmpdir(), "capture-guard-"));
  const out = join(base, "out");
  mkdirSync(out);
  const victim = join(base, "victim.txt");
  writeFileSync(victim, "keep");
  for (const label of ["../victim", "..", "a/b", ".hidden"]) {
    const result = runCapture(["--label", label, "--out", out]);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /unsafe --label/, label);
    assert.ok(existsSync(victim), `${label} deleted the victim file`);
  }
});

test("capture refuses unsafe names in --compare before reading anything", () => {
  const result = runCapture(["--compare", "../x", "after"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe --compare/);
});
