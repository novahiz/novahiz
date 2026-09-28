import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadSpec, mergeConfig } from "../src/spec.ts";

test("mergeConfig fills missing blocks from defaults", () => {
  const merged = mergeConfig({ dbPath: "custom.sqlite" });
  assert.equal(merged.dbPath, "custom.sqlite");
  assert.deepEqual(merged.classify, DEFAULT_CONFIG.classify);
  assert.deepEqual(merged.gate, DEFAULT_CONFIG.gate);
  assert.deepEqual(merged.skillRoots, DEFAULT_CONFIG.skillRoots);
});

test("mergeConfig keeps provided values and fills the rest", () => {
  const merged = mergeConfig({ gate: { mode: "warn" }, classify: { maxCategories: 5 } } as never);
  assert.equal(merged.gate.mode, "warn");
  assert.equal(merged.gate.envEscape, DEFAULT_CONFIG.gate.envEscape);
  assert.equal(merged.classify.maxCategories, 5);
  assert.equal(merged.classify.minScore, DEFAULT_CONFIG.classify.minScore);
});

test("mergeConfig tolerates null", () => {
  assert.deepEqual(mergeConfig(null), DEFAULT_CONFIG);
});

test("mergeConfig coerces invalid gate fields", () => {
  const merged = mergeConfig({ gate: { ignoreFiles: null, tools: null, mode: "bogus" } } as never);
  assert.ok(Array.isArray(merged.gate.ignoreFiles));
  assert.ok(Array.isArray(merged.gate.tools));
  assert.equal(merged.gate.mode, "block");
});

test("mergeConfig validates classify and gate scalars", () => {
  const bad = mergeConfig({ classify: { minScore: "abc" }, gate: { enabled: "false", envEscape: 123 } } as never);
  assert.equal(bad.classify.minScore, DEFAULT_CONFIG.classify.minScore);
  assert.equal(bad.gate.enabled, true);
  assert.equal(bad.gate.envEscape, DEFAULT_CONFIG.gate.envEscape);
  const notObject = mergeConfig({ classify: "oops" } as never);
  assert.deepEqual(notObject.classify, DEFAULT_CONFIG.classify);
});

test("C2: mergeConfig restores default tools when the configured list is empty", () => {
  const merged = mergeConfig({ gate: { tools: [] } } as never);
  assert.deepEqual(merged.gate.tools, DEFAULT_CONFIG.gate.tools);
});

// Community regression: a virgin home (fresh `npm install -g novahiz`, home
// never touched) must still load a spec — from the catalog shipped inside the
// package — instead of dying with ENOENT on the very first documented command.
test("loadSpec on a virgin home falls back to the package catalog", () => {
  const virgin = mkdtempSync(join(tmpdir(), "novahiz-virgin-"));
  try {
    const spec = loadSpec(virgin);
    assert.equal(spec.root, virgin);
    assert.ok(spec.categories.length > 0, "categories served by the package catalog");
    assert.ok(spec.rules.length > 0, "rules served by the package catalog");
    assert.equal(typeof spec.config.gate.mode, "string");
  } finally {
    rmSync(virgin, { recursive: true, force: true });
  }
});
