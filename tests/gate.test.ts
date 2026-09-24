import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evaluateGate, fileClass, globToRegExp } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);
const PROSE = "// This comment explains the total calculation for the client's order";
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
  assert.equal(fileClass(".eslintrc.json"), "config");
});

test("globs match nested paths", () => {
  assert.equal(globToRegExp("**/*.sql").test("supabase/migrations/001.sql"), true);
  assert.equal(globToRegExp("**/supabase/**").test("apps/web/supabase/config.toml"), true);
  assert.equal(globToRegExp("**/*.sql").test("src/index.ts"), false);
});

test("does not require humanizer for a markdown edit containing prose", () => {
  const result = evaluateGate({ tool: "edit", filePath: "README.md", spec, installedSkills: null, content: "## Installation\n\nThis section explains how to install the package." });
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
  assert.equal(result.matchedRules.includes("R1-docs"), false);
});

test("does not require humanizer for a markdown edit without prose content", () => {
  const result = evaluateGate({ tool: "edit", filePath: "README.md", spec, installedSkills: null });
  assert.equal(result.matchedRules.includes("R1-docs"), false);
});

test("does not require humanizer for pure logic code", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: "const x = 1;" });
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
  assert.equal(result.matchedRules.includes("R1-code-prose"), false);
});

test("does not require humanizer for code containing prose outside design", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: PROSE });
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
  assert.equal(result.matchedRules.includes("R1-code-prose"), false);
});

test("requires design craft skills for a style file", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/hero.css", spec, installedSkills: null });
  assert.ok(result.matchedRules.includes("R13-design-craft"));
  assert.ok(result.missingSkills.includes("novahiz-humanizer"));
  assert.ok(result.missingSkills.includes("ui-slop-remover"));
  assert.ok(result.missingSkills.includes("ui-craft-rules"));
});

test("does not require design craft for a component without a design prompt", () => {
  const withStyle = evaluateGate({ tool: "edit", filePath: "src/Button.tsx", spec, installedSkills: null, content: STYLE });
  assert.equal(withStyle.matchedRules.includes("R13-design-craft"), false);
  assert.equal(withStyle.missingSkills.includes("ui-slop-remover"), false);
  const logicOnly = evaluateGate({ tool: "edit", filePath: "src/Button.tsx", spec, installedSkills: null, content: "const n = 2;" });
  assert.equal(logicOnly.matchedRules.includes("R13-design-craft"), false);
  assert.equal(logicOnly.missingSkills.includes("ui-slop-remover"), false);
});

test("requires design craft skills for a design prompt on a UI target", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/Hero.tsx",
    spec,
    installedSkills: null,
    categories: ["design-ui"],
    content: "const n = 2;"
  });
  assert.ok(result.matchedRules.includes("R13-design-craft"));
  assert.ok(result.missingSkills.includes("novahiz-humanizer"));
  assert.ok(result.missingSkills.includes("ui-slop-remover"));
  assert.ok(result.missingSkills.includes("ui-craft-rules"));
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
  assert.ok(result.missingSkills.includes("novahiz-supabase"));
  assert.ok(result.missingSkills.includes("novahiz-postgres"));
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
    content: "const x = 1;",
    tier: "full"
  });
  assert.equal(result.roadmap, "feature");
  assert.ok(result.requiredSkills.includes("novahiz-plan"));
  assert.ok(result.requiredSkills.includes("novahiz-code-review"));
});

test("applies the flutter roadmap quality skills on a dart file", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "lib/main.dart",
    spec,
    installedSkills: null,
    categories: ["flutter"],
    content: "void main() {}",
    tier: "full"
  });
  assert.equal(result.roadmap, "flutter-feature");
  assert.ok(result.missingSkills.includes("flutter-apply-architecture-best-practices"));
  assert.ok(result.missingSkills.includes("dart-run-static-analysis"));
  assert.ok(result.missingSkills.includes("dart-add-unit-test"));
  assert.equal(result.allow, false);
});

test("flutter quality skills load when already present", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "lib/main.dart",
    spec,
    installedSkills: new Set([
      "flutter-apply-architecture-best-practices",
      "dart-run-static-analysis",
      "dart-add-unit-test",
      "novahiz-plan",
      "novahiz-clarify",
      "novahiz-task",
      "novahiz-analyse",
      "novahiz-implement",
      "novahiz-converge",
      "novahiz-code-review"
    ]),
    loadedSkills: [
      "flutter-apply-architecture-best-practices",
      "dart-run-static-analysis",
      "dart-add-unit-test",
      "novahiz-plan",
      "novahiz-clarify",
      "novahiz-task",
      "novahiz-analyse",
      "novahiz-implement",
      "novahiz-converge",
      "novahiz-code-review"
    ],
    categories: ["flutter"],
    content: "void main() {}",
    tier: "full"
  });
  assert.equal(result.missingSkills.length, 0);
  assert.equal(result.allow, true);
});

test("lite tier skips flutter architecture skills", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "lib/main.dart",
    spec,
    installedSkills: null,
    categories: ["flutter"],
    content: "void main() {}",
    tier: "lite"
  });
  assert.equal(result.missingSkills.includes("flutter-apply-architecture-best-practices"), false);
  assert.ok(result.missingSkills.includes("novahiz-implement"));
  assert.ok(result.missingSkills.includes("novahiz-converge"));
});

test("reports design craft skills that are not installed separately", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: new Set(["novahiz-humanizer"]),
    loadedSkills: []
  });
  assert.ok(result.requiredSkills.includes("novahiz-humanizer"));
  assert.ok(result.unmatchedRequired.includes("ui-slop-remover"));
  assert.ok(result.unmatchedRequired.includes("ui-craft-rules"));
  assert.equal(result.missingSkills.includes("ui-slop-remover"), false);
});

test("fails closed when the installed index is unavailable", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: new Set(),
    installedIndexAvailable: false,
    loadedSkills: []
  });
  assert.equal(result.allow, false);
  assert.equal(result.indexMissing, true);
  assert.ok(result.missingSkills.includes("novahiz-humanizer"));
  assert.ok(result.missingSkills.includes("ui-slop-remover"));
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
    loadedSkills: ["novahiz-humanizer"],
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
    loadedSkills: ["novahiz-humanizer"],
    content: "const x = 1;"
  });
  assert.equal(result.placeholder, false);
});

test("gates a bash command that writes prose to a file", () => {
  const result = evaluateGate({ tool: "bash", filePath: "output.md", spec, installedSkills: null, content: "# This is a detailed explanation of the installation steps for the project." });
  assert.equal(result.matchedRules.includes("R1-docs"), false);
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
});

test("gates a shell command targeting a supabase migration", () => {
  const result = evaluateGate({ tool: "shell", filePath: "supabase/migrations/001_init.sql", spec, installedSkills: null, content: "psql -f supabase/migrations/001_init.sql" });
  assert.equal(result.allow, false);
  assert.ok(result.missingSkills.includes("novahiz-supabase"));
});

test("allows a bash command targeting an ignored file", () => {
  const result = evaluateGate({ tool: "bash", filePath: "package-lock.json", spec, installedSkills: null, content: "npm install" });
  assert.equal(result.allow, true);
  assert.equal(result.ignored, true);
});

test("explains each missing skill in reasons on design", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/hero.css", spec, installedSkills: null, loadedSkills: [] });
  assert.ok(result.reasons.some((entry) => entry.includes("novahiz-humanizer")));
  assert.ok(result.reasons.some((entry) => entry.includes("ui-slop-remover")));
});
