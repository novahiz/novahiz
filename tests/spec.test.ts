import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeConfig } from "../src/spec.ts";

test("mergeConfig fills missing blocks from defaults", () => {
  const merged = mergeConfig({ dbPath: "custom.sqlite" });
  assert.equal(merged.dbPath, "custom.sqlite");
  assert.deepEqual(merged.classify, DEFAULT_CONFIG.classify);
  assert.deepEqual(merged.gate, DEFAULT_CONFIG.gate);
  assert.deepEqual(merged.skillRoots, DEFAULT_CONFIG.skillRoots);
});

test("mergeConfig keeps provided values and fills the rest", () => {
  const merged = mergeConfig({ gate: { mode: "warn" }, classify: { maxCategories: 5 } });
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
