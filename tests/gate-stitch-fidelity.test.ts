import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateGate, projectGlobsMatch, projectRootOf } from "../src/gate.ts";
import { loadSpec, NovahizHome } from "../src/spec.ts";

// R16-stitch-fidelity: "load the skill when the edited file is UI code of a
// project that carries Stitch references". The rule is only enforceable if the
// selector (when.projectGlobs) really resolves the repository, the rule ships
// in the catalogue, and the skill is present in the installed index.
const spec = loadSpec(NovahizHome());
const SKILL = "novahiz-stitch-fidelity";
const INDEX = new Set([SKILL, "novahiz-plan", "novahiz-clarify", "novahiz-analyse", "novahiz-implement", "novahiz-converge", "novahiz-code-review"]);

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Temp repository: `.git` marks the project root, `src/App.tsx` is the edited UI file. */
function makeProject(opts: { stitch: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), "novahiz-stitch-gate-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "App.tsx"), "export const App = () => null;\n");
  if (opts.stitch) {
    mkdirSync(join(root, "stitch"));
    writeFileSync(join(root, "stitch", "verify.config.json"), "{}\n");
  }
  return root;
}

function gate(file: string, loaded: string[]) {
  return evaluateGate({
    tool: "edit",
    filePath: file,
    content: "export const App = () => null;\n",
    prompt: "redesign the screen layout and spacing",
    categories: [], // isolated: no prompt-scoped rule, R16 is path+project scoped
    loadedSkills: loaded,
    installedSkills: INDEX,
    installedIndexAvailable: true,
    spec
  });
}

describe("R16-stitch-fidelity gate", () => {
  test("the rule ships in the catalogue with a project-scoped selector", () => {
    const rule = spec.rules.find((entry) => entry.id === "R16-stitch-fidelity");
    assert.ok(rule, "R16-stitch-fidelity missing from catalog/rules.json");
    assert.deepEqual(rule!.require, [SKILL]);
    assert.deepEqual(rule!.when.projectGlobs, ["stitch/**"]);
    assert.ok(rule!.when.pathGlobs?.includes("**/*.tsx"), "R16 must select UI files");
    const scoped = spec.rules.filter((entry) => entry.when.projectGlobs && entry.when.projectGlobs.length > 0).map((entry) => entry.id);
    assert.deepEqual(scoped, ["R16-stitch-fidelity"]);
  });

  test("stitch-verify step exists in the expo and flutter roadmaps (kind verify)", () => {
    for (const id of ["expo", "flutter"]) {
      const category = spec.categories.find((entry) => entry.id === id);
      const step = category?.roadmap?.steps.find((entry) => entry.id === "stitch-verify");
      assert.ok(step, `stitch-verify step missing from the ${id} roadmap`);
      assert.equal(step!.kind, "verify");
      assert.deepEqual(step!.requireSkills, [SKILL]);
    }
  });

  test("stitch-fidelity provider declares its adb prerequisite", () => {
    const provider = spec.providers.find((entry) => entry.id === "stitch-fidelity");
    assert.ok(provider, "provider stitch-fidelity missing from catalog/providers.json");
    assert.deepEqual(provider!.requires, ["adb"]);
    assert.ok(provider!.bootstrap?.win32 && provider!.bootstrap?.default, "bootstrap commands missing");
  });

  test("blocks a UI edit when the project carries Stitch references", () => {
    const root = makeProject({ stitch: true });
    const result = gate(join(root, "src", "App.tsx"), []);
    assert.ok(result.matchedRules.includes("R16-stitch-fidelity"), `R16 not matched: ${result.matchedRules.join(", ")}`);
    assert.deepEqual(result.missingSkills, [SKILL]);
    assert.equal(result.allow, false);
  });

  test("passes once the skill is loaded", () => {
    const root = makeProject({ stitch: true });
    const result = gate(join(root, "src", "App.tsx"), [SKILL]);
    assert.equal(result.allow, true, result.reasons.join(" | "));
    assert.ok(!result.missingSkills.includes(SKILL));
  });

  test("does not require the skill in a project without Stitch references", () => {
    const root = makeProject({ stitch: false });
    const result = gate(join(root, "src", "App.tsx"), []);
    assert.ok(!result.matchedRules.includes("R16-stitch-fidelity"));
    assert.ok(!result.requiredSkills.includes(SKILL));
    assert.ok(!result.missingSkills.includes(SKILL));
  });

  test("non-UI files in a Stitch project stay outside the rule", () => {
    const root = makeProject({ stitch: true });
    const file = join(root, "scripts", "build.js");
    mkdirSync(join(root, "scripts"));
    writeFileSync(file, "console.log('x');\n");
    const result = gate(file, []);
    assert.ok(!result.matchedRules.includes("R16-stitch-fidelity"));
    assert.ok(!result.requiredSkills.includes(SKILL));
  });

  test("pathless probes never grant the rule (fail closed)", () => {
    const root = makeProject({ stitch: true });
    const result = evaluateGate({
      tool: "bash",
      filePath: "",
      pathless: true,
      content: "node scripts/capture.mjs",
      prompt: "capture the screens",
      categories: [],
      loadedSkills: [],
      installedSkills: INDEX,
      installedIndexAvailable: true,
      spec
    });
    assert.ok(!result.matchedRules.includes("R16-stitch-fidelity"));
  });

  test("projectRootOf walks up to the repository marker", () => {
    const root = makeProject({ stitch: true });
    assert.equal(projectRootOf(join(root, "src", "App.tsx")), root);
  });

  test("projectGlobsMatch scans only the literal prefix", () => {
    const root = makeProject({ stitch: true });
    assert.equal(projectGlobsMatch(root, ["stitch/**"]), true);
    assert.equal(projectGlobsMatch(root, ["design/**"]), false);
    const plain = makeProject({ stitch: false });
    assert.equal(projectGlobsMatch(plain, ["stitch/**"]), false);
  });
});
