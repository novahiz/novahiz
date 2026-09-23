import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { contentSatisfies, evaluateGate, fileClass, globToRegExp } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);
const PROSE = "// This comment explains the total calculation for the client's order";

test("fileClass maps the six classes and dotfiles", () => {
  assert.equal(fileClass("a.css"), "design");
  assert.equal(fileClass("a.tsx"), "design");
  assert.equal(fileClass("a.md"), "text");
  assert.equal(fileClass("a.json"), "data");
  assert.equal(fileClass("a.ts"), "code");
  assert.equal(fileClass(".env"), "config");
  assert.equal(fileClass("Makefile"), "other");
});

test("globToRegExp matches writable paths", () => {
  assert.ok(globToRegExp("**/*.css").test("src/a.css"));
  assert.equal(globToRegExp("**/*.css").test("src/a.ts"), false);
});

test("contentSatisfies handles prose, style, regex and the length guard", () => {
  assert.equal(contentSatisfies(PROSE, ["prose"]), true);
  assert.equal(contentSatisfies("className={styles.card}", ["style"]), true);
  assert.equal(contentSatisfies("const x = 1;", ["^const "]), true);
  assert.equal(contentSatisfies("let x = 1;", ["^const "]), false);
  assert.equal(contentSatisfies("const x = 1;", ["x".repeat(1001)]), false);
});

test("evaluateGate respects minChange, contentExcludes and match:all", () => {
  const synthetic = [
    { id: "R-TEST-MIN", require: ["novahiz-humanizer"], when: { fileClasses: ["text"],         minChange: 10 } },
    { id: "R-TEST-EXCL", require: ["novahiz-humanizer"], when: { fileClasses: ["text"], contentExcludes: ["prose"] } },
    { id: "R-TEST-ALL", require: ["novahiz-humanizer"], when: { match: "all", fileClasses: ["text"], pathGlobs: ["**/*.md"] } }
  ] as unknown as typeof spec.rules;
  const custom = { ...spec, rules: [...spec.rules, ...synthetic] } as typeof spec;

  const tiny = evaluateGate({ tool: "edit", filePath: "notes.md", content: "x", spec: custom, installedSkills: null });
  assert.equal(tiny.matchedRules.includes("R-TEST-MIN"), false);

  const prose = evaluateGate({ tool: "edit", filePath: "notes.md", content: PROSE, spec: custom, installedSkills: null });
  assert.equal(prose.matchedRules.includes("R-TEST-EXCL"), false);
  assert.equal(prose.matchedRules.includes("R-TEST-ALL"), true);
});
