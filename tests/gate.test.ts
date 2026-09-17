import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evaluateGate, fileClass, globToRegExp } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);
const PROSE = "// Ce commentaire explique le calcul du total de la commande pour le client";
const STYLE = "className={styles.card}";

test("maps extensions to file classes", () => {
  assert.equal(fileClass("src/hero.css"), "design");
  assert.equal(fileClass("src/app.ts"), "code");
  assert.equal(fileClass("README.md"), "text");
  assert.equal(fileClass("package.json"), "data");
  assert.equal(fileClass("Makefile"), "other");
});

test("classifies dotfiles instead of dropping them to other", () => {
  assert.equal(fileClass(".env"), "config");
  assert.equal(fileClass(".env.local"), "config");
  assert.equal(fileClass(".gitignore"), "config");
  assert.equal(fileClass(".eslintrc.json"), "data");
});

test("globs match nested paths", () => {
  assert.equal(globToRegExp("**/*.sql").test("supabase/migrations/001.sql"), true);
  assert.equal(globToRegExp("**/supabase/**").test("apps/web/supabase/config.toml"), true);
  assert.equal(globToRegExp("**/*.sql").test("src/index.ts"), false);
});

test("requires humanizer for a markdown edit", () => {
  const result = evaluateGate({ tool: "edit", filePath: "README.md", spec, installedSkills: null });
  assert.equal(result.allow, false);
  assert.ok(result.missingSkills.includes("humanizer"));
  assert.ok(result.matchedRules.includes("R1-docs"));
});

test("does not require humanizer for pure logic code", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: "const x = 1;" });
  assert.equal(result.missingSkills.includes("humanizer"), false);
  assert.equal(result.matchedRules.includes("R1-code-prose"), false);
});

test("requires humanizer for code containing prose", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: PROSE });
  assert.ok(result.missingSkills.includes("humanizer"));
  assert.ok(result.matchedRules.includes("R1-code-prose"));
});

test("requires impeccable for a style file", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/hero.css", spec, installedSkills: null });
  assert.ok(result.missingSkills.includes("impeccable"));
  assert.ok(result.matchedRules.includes("R2-style"));
});

test("requires impeccable for a styled component only with style content", () => {
  const withStyle = evaluateGate({ tool: "edit", filePath: "src/Button.tsx", spec, installedSkills: null, content: STYLE });
  assert.ok(withStyle.missingSkills.includes("impeccable"));
  const logicOnly = evaluateGate({ tool: "edit", filePath: "src/Button.tsx", spec, installedSkills: null, content: "const n = 2;" });
  assert.equal(logicOnly.missingSkills.includes("impeccable"), false);
});

test("requires impeccable for a design prompt on a UI target", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/Hero.tsx",
    spec,
    installedSkills: null,
    categories: ["design-ui"],
    content: "const n = 2;"
  });
  assert.ok(result.missingSkills.includes("impeccable"));
  assert.ok(result.matchedRules.includes("R5-design"));
});

test("ignores generated and lock files", () => {
  const result = evaluateGate({ tool: "edit", filePath: "package-lock.json", spec, installedSkills: null });
  assert.equal(result.allow, true);
  assert.equal(result.ignored, true);
  assert.deepEqual(result.matchedRules, []);
});

test("requires supabase skills for a migration path", () => {
  const result = evaluateGate({
    tool: "write",
    filePath: "supabase/migrations/20260101_init.sql",
    spec,
    installedSkills: null,
    loadedSkills: []
  });
  assert.ok(result.missingSkills.includes("supabase"));
  assert.ok(result.missingSkills.includes("supabase-postgres-best-practices"));
  assert.ok(result.matchedRules.includes("R3-supabase"));
});

test("does not force supabase for a plain sql file", () => {
  const result = evaluateGate({ tool: "edit", filePath: "db/query.sql", spec, installedSkills: null });
  assert.equal(result.matchedRules.includes("R3-supabase"), false);
});

test("applies the primary roadmap skill steps", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    categories: ["code"],
    content: "const x = 1;"
  });
  assert.equal(result.roadmap, "feature");
  assert.ok(result.requiredSkills.includes("novahiz-plan"));
  assert.ok(result.requiredSkills.includes("code-reviewer"));
});

test("reports required skills that are not installed separately", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: new Set(["humanizer"]),
    loadedSkills: []
  });
  assert.deepEqual(result.requiredSkills, []);
  assert.deepEqual(result.unmatchedRequired, ["impeccable"]);
  assert.deepEqual(result.missingSkills, []);
});

test("fails closed when the installed index is unavailable", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "README.md",
    spec,
    installedSkills: new Set(),
    installedIndexAvailable: false,
    loadedSkills: []
  });
  assert.equal(result.allow, false);
  assert.equal(result.indexMissing, true);
  assert.ok(result.missingSkills.includes("humanizer"));
});

test("does not block a valid empty index", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "README.md",
    spec,
    installedSkills: new Set(),
    installedIndexAvailable: true,
    loadedSkills: []
  });
  assert.equal(result.allow, true);
  assert.equal(result.indexMissing, false);
});

test("blocks a placeholder marker in code content", () => {
  const marker = "not " + "implemented";
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    loadedSkills: ["humanizer"],
    content: `throw new Error("${marker}");`
  });
  assert.equal(result.placeholder, true);
  assert.equal(result.allow, false);
  assert.ok(result.reasons.some((entry) => entry.includes("placeholder")));
});

test("does not flag clean code as a placeholder", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    loadedSkills: ["humanizer"],
    content: "const x = 1;"
  });
  assert.equal(result.placeholder, false);
});

test("explains each missing skill in reasons", () => {
  const result = evaluateGate({ tool: "edit", filePath: "README.md", spec, installedSkills: null, loadedSkills: [] });
  assert.ok(result.reasons.some((entry) => entry.includes("humanizer")));
});
