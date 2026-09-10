import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evaluateGate, fileClass, globToRegExp } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("maps extensions to file classes", () => {
  assert.equal(fileClass("src/hero.css"), "design");
  assert.equal(fileClass("src/app.ts"), "code");
  assert.equal(fileClass("README.md"), "text");
  assert.equal(fileClass("package.json"), "data");
  assert.equal(fileClass("Makefile"), "other");
});

test("globs match nested paths", () => {
  assert.equal(globToRegExp("**/*.sql").test("supabase/migrations/001.sql"), true);
  assert.equal(globToRegExp("**/supabase/**").test("apps/web/supabase/config.toml"), true);
  assert.equal(globToRegExp("**/*.sql").test("src/index.ts"), false);
});

test("blocks a design edit until humanizer and impeccable are loaded", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/hero.css", spec, installedSkills: null });
  assert.equal(result.allow, false);
  assert.deepEqual([...result.missingSkills].sort(), ["humanizer", "impeccable"]);
  assert.deepEqual(result.matchedRules, ["R1", "R2"]);
});

test("allows a design edit once both skills are loaded", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: null,
    loadedSkills: ["humanizer", "impeccable"]
  });
  assert.equal(result.allow, true);
  assert.deepEqual(result.missingSkills, []);
});

test("requires supabase skills for a migration path", () => {
  const result = evaluateGate({
    tool: "write",
    filePath: "supabase/migrations/20260101_init.sql",
    spec,
    installedSkills: null,
    loadedSkills: ["humanizer"]
  });
  assert.equal(result.allow, false);
  assert.ok(result.missingSkills.includes("supabase"));
  assert.ok(result.missingSkills.includes("supabase-postgres-best-practices"));
  assert.ok(result.matchedRules.includes("R3"));
});

test("reports required skills that are not installed separately", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: new Set(["humanizer"]),
    loadedSkills: []
  });
  assert.deepEqual(result.requiredSkills, ["humanizer"]);
  assert.deepEqual(result.unmatchedRequired, ["impeccable"]);
  assert.deepEqual(result.missingSkills, ["humanizer"]);
});
