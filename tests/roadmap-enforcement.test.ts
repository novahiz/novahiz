import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { annotateRoadmap, classify, stepEnforcement } from "../src/classify.ts";
import { loadSpec } from "../src/spec.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);

describe("roadmap: enforced vs advisory est visible", () => {
  test("la regle est celle du gate: non optionnelle ET requireSkills", () => {
    assert.deepEqual(stepEnforcement({ id: "a", label: "a", kind: "skill" } as never), {
      enforced: false,
      advisory: true,
      why: "no required skill",
    });
    assert.equal(
      stepEnforcement({ id: "b", label: "b", kind: "skill", optional: true, requireSkills: ["x"] } as never).enforced,
      false,
    );
    assert.equal(
      stepEnforcement({ id: "c", label: "c", kind: "skill", requireSkills: ["x"] } as never).enforced,
      true,
    );
  });

  test("chaque categorie annotee garde ses etapes et marque les bonnes", () => {
    for (const category of spec.categories) {
      if (!category.roadmap) continue;
      const annotated = annotateRoadmap(category.roadmap);
      assert.ok(annotated);
      assert.equal(annotated!.steps.length, category.roadmap.steps.length);
      for (let index = 0; index < annotated!.steps.length; index += 1) {
        const raw = category.roadmap.steps[index] as { id: string; optional?: boolean; requireSkills?: string[] };
        const step: { id: string; enforced: boolean; advisory: boolean } = annotated!.steps[index];
        const expected = raw.optional !== true && (raw.requireSkills ?? []).length > 0;
        assert.equal(step.enforced, expected, `${category.id}/${raw.id}`);
        assert.equal(step.advisory, !expected);
        assert.equal(step.id, raw.id);
      }
    }
  });

  test("une roadmap absente reste nulle", () => {
    assert.equal(annotateRoadmap(null), null);
    assert.equal(annotateRoadmap(undefined), null);
  });

  test("classify expose enforced sur chaque etape et chaque invocation", () => {
    const result = classify(spec, "ajoute un bouton de connexion");
    assert.ok(result.roadmaps.length > 0);
    for (const roadmap of result.roadmaps) {
      for (const step of roadmap.steps) {
        assert.equal(typeof (step as { enforced?: unknown }).enforced, "boolean");
      }
    }
    for (const invocation of result.invocations) {
      assert.equal(typeof invocation.enforced, "boolean");
      assert.equal(invocation.enforced, !invocation.optional && invocation.skills.length > 0);
    }
  });

  test("l'ensemble enforce correspond exactement aux etapes que close exige", () => {
    for (const category of spec.categories) {
      if (!category.roadmap) continue;
      const enforced = annotateRoadmap(category.roadmap)!.steps.filter((step) => step.enforced).map((step) => step.id);
      const closeRule = category.roadmap.steps
        .filter((step) => step.optional !== true && (step.requireSkills ?? []).length > 0)
        .map((step) => step.id);
      assert.deepEqual(enforced, closeRule, category.id);
    }
  });
});
