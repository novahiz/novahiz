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
