import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("every category has a roadmap with at least one step", () => {
  assert.ok(spec.categories.length >= 14);
  for (const category of spec.categories) {
    assert.ok(category.roadmap, `category ${category.id} has no roadmap`);
    assert.ok(category.roadmap.steps.length >= 1, `category ${category.id} roadmap is empty`);
  }
});

test("roadmap steps have a valid shape", () => {
  const kinds = new Set(["advisory", "skill", "edit", "verify", "approval"]);
  for (const category of spec.categories) {
    for (const step of category.roadmap.steps) {
      assert.ok(step.id.length > 0, `empty step id in ${category.id}`);
      assert.ok(step.label.length > 0, `empty step label in ${category.id}`);
      assert.ok(kinds.has(step.kind), `invalid kind ${step.kind} in ${category.id}`);
      for (const skill of step.requireSkills ?? []) {
        assert.match(skill, /^[a-z0-9][a-z0-9-]*$/, `invalid skill id ${skill}`);
      }
    }
  }
});

test("design gating is not forced by the roadmap", () => {
  const design = spec.categories.find((category) => category.id === "design-ui");
  assert.ok(design?.roadmap);
  const gatedSkills = design.roadmap.steps
    .filter((step) => step.kind === "skill" && !step.optional)
    .flatMap((step) => step.requireSkills ?? []);
  assert.equal(gatedSkills.includes("impeccable"), false);
});
