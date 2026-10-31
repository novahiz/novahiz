// Regression: with a design-ui prompt the gate demanded the frontend design
// skills on any file it touched, unit tests included. The five design-scoped
// rules now carry `pathExcludes`, the negative counterpart of `pathGlobs`, so
// that a test edit is never treated as design work — while the very same rules
// keep firing on a real UI file.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateGate } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";

// Loaded from the checkout, not from NovahizHome(): this asserts on the
// catalogue the test lives with, whatever the machine has installed.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);

/** The five design-scoped rules. R9/R10 stay out: a test is code. */
const DESIGN_RULES = [
  "R11-accessibility",
  "R13-design-craft",
  "R14-impeccable",
  "R16-stitch-fidelity",
  "R17-wireframe",
];

/** What those rules require — none of it belongs on a unit test. */
const DESIGN_SKILLS = [
  "impeccable",
  "novahiz-humanizer",
  "ui-slop-remover",
  "ui-craft-rules",
  "novahiz-wcag-audit",
  "novahiz-wireframe",
  "novahiz-stitch-fidelity",
];

const INDEX = new Set([
  ...DESIGN_SKILLS,
  "novahiz-code-review",
  "novahiz-plan",
  "novahiz-clarify",
  "novahiz-analyse",
  "novahiz-implement",
  "novahiz-converge",
]);

// 1152 characters: well above R13/R14's `minChange` of 200, so the triviality
// guard cannot be what saves the test file — only the exclusion can.
const TEST_BODY = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  ...Array.from(
    { length: 12 },
    (_, i) => `test("cas ${i}", () => { assert.equal(${i}, ${i}); assert.ok(${i} >= 0); assert.notEqual(${i}, -1); });`
  ),
].join("\n");

function gate(filePath: string, categories: string[]) {
  return evaluateGate({
    tool: "edit",
    filePath,
    content: TEST_BODY,
    prompt: "corriger un test unitaire",
    categories,
    loadedSkills: [],
    installedSkills: INDEX,
    installedIndexAvailable: true,
    spec,
  });
}

describe("pathExcludes: les regles de design ne visent pas les tests unitaires", () => {
  test("les cinq regles de design portent bien pathExcludes", () => {
    for (const id of DESIGN_RULES) {
      const rule = spec.rules.find((entry) => entry.id === id);
      assert.ok(rule, `${id} manque dans catalog/rules.json`);
      assert.ok(rule!.when.pathExcludes?.length, `${id} doit declarer pathExcludes`);
      assert.ok(rule!.when.pathExcludes!.includes("**/tests/**"), `${id} doit exclure **/tests/**`);
    }
  });

  test("R15-token-economy garde sa propre cible de test: l'exclusion ne l'a pas gagnee", () => {
    const rule = spec.rules.find((entry) => entry.id === "R15-token-economy");
    assert.ok(rule, "R15-token-economy manque dans catalog/rules.json");
    assert.equal(rule!.when.pathExcludes, undefined, "R15 ne doit pas exclure les tests");
    assert.ok(rule!.when.pathGlobs?.includes("**/tests/token-economy.test.ts"));
  });

  test("une edition de test unitaire avec categorie design-ui n'exige plus les skills de design", () => {
    const result = gate("tests/plugin-warmstart.test.ts", ["design-ui"]);
    const stillDemanded = result.missingSkills.filter((skill) => DESIGN_SKILLS.includes(skill));
    assert.deepEqual(stillDemanded, [], `skills de design encore exigees sur un test: ${stillDemanded.join(", ")}`);
    for (const id of DESIGN_RULES) {
      assert.ok(!result.matchedRules.includes(id), `${id} s'est declenchee sur un test unitaire`);
    }
  });

  test("le meme chemin sous __tests__/ et en .spec.ts est aussi epargne", () => {
    for (const path of ["a/b/__tests__/x.test.ts", "tests/e2e/login.spec.ts", "src/widget.test.ts"]) {
      const result = gate(path, ["design-ui"]);
      const stillDemanded = result.missingSkills.filter((skill) => DESIGN_SKILLS.includes(skill));
      assert.deepEqual(stillDemanded, [], `${path} exige encore des skills de design`);
    }
  });

  test("la meme edition sur un vrai fichier UI continue de declencher les regles", () => {
    const result = gate("docs/page.html", ["design-ui"]);
    assert.ok(result.matchedRules.includes("R13-design-craft"), "R13 doit toujours viser un .html");
    assert.ok(result.matchedRules.includes("R14-impeccable"), "R14 doit toujours viser un .html");
    assert.ok(result.missingSkills.includes("impeccable"));
    assert.ok(result.missingSkills.includes("novahiz-humanizer"));
  });

  test("sans pathExcludes, la categorie design-ui declencherait sur une source UI ecartee d'ordinaire", () => {
    // The rule shape that caused the bug: `match: any` + a prompt category, no
    // exclusion. Proves the exclusion is what does the work, not the layout.
    // Depuis NX-01 une regle design ne vise que les sources d'interface : le
    // chemin reste donc un `.tsx`, mais un `.tsx` que les exclusions ecartent.
    const result = evaluateGate({
      tool: "edit",
      filePath: "src/components/Widget.test.tsx",
      content: TEST_BODY,
      prompt: "corriger un test unitaire",
      categories: ["design-ui"],
      loadedSkills: [],
      installedSkills: INDEX,
      installedIndexAvailable: true,
      spec: {
        ...spec,
        rules: [
          {
            id: "R-legacy",
            description: "Ancienne forme: categorie seule, sans exclusion.",
            when: { match: "any", promptCategories: ["design-ui"], minChange: 200 },
            require: ["impeccable"],
          },
        ],
      },
    });
    assert.ok(result.matchedRules.includes("R-legacy"));
    assert.ok(result.missingSkills.includes("impeccable"));
  });
});
