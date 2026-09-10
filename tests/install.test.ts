import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyInto, mergeCreated, nodeVersionOk, parseArgs } from "../install/lib.mjs";

test("parses flags with equals and space forms", () => {
  const flags = parseArgs(["--harness=opencode", "--home", "/tmp/x", "--dry-run"]);
  assert.equal(flags.harness, "opencode");
  assert.equal(flags.home, "/tmp/x");
  assert.equal(flags["dry-run"], true);
});

test("node version check accepts current runtime", () => {
  assert.equal(nodeVersionOk([22, 18, 0]), true);
});

test("copyInto reports newly created files only", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-"));
  const src = join(base, "src");
  const dest = join(base, "dest");
  mkdirSync(join(src, "a"), { recursive: true });
  writeFileSync(join(src, "a", "one.txt"), "1");
  writeFileSync(join(src, "two.txt"), "2");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "two.txt"), "pre-existing");

  const result = copyInto(src, dest);
  assert.equal(result.total, 2);
  assert.deepEqual(result.created, [join(dest, "a", "one.txt")]);
  assert.equal(existsSync(join(dest, "a", "one.txt")), true);
  rmSync(base, { recursive: true, force: true });
});

test("mergeCreated deduplicates and drops missing paths", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-"));
  const present = join(base, "present.txt");
  writeFileSync(present, "x");
  const merged = mergeCreated([present], [present, join(base, "missing.txt")]);
  assert.deepEqual(merged, [present]);
  rmSync(base, { recursive: true, force: true });
});
