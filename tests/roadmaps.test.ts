import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("every category has a roadmap with at least one step", () => {
  assert.ok(spec.categories.length >= 16);
  for (const category of spec.categories) {
    assert.ok(category.roadmap, `category ${category.id} has no roadmap`);
    assert.ok(category.roadmap.steps.length >= 1, `category ${category.id} roadmap is empty`);
  }
});

test("flutter roadmap enforces architecture, analyze and tests", () => {
  const flutter = spec.categories.find((category) => category.id === "flutter");
  assert.ok(flutter?.roadmap, "flutter category missing");
  const gated = flutter.roadmap.steps
    .filter((step) => step.kind === "skill" && !step.optional)
    .flatMap((step) => step.requireSkills ?? []);
  assert.ok(gated.includes("flutter-apply-architecture-best-practices"));
  assert.ok(gated.includes("dart-run-static-analysis"));
  assert.ok(gated.includes("dart-add-unit-test"));
  assert.equal(gated.includes("impeccable"), false);
});

test("flutter category outranks generic code priority", () => {
  const flutter = spec.categories.find((category) => category.id === "flutter");
  const code = spec.categories.find((category) => category.id === "code");
  assert.ok(flutter && code);
  assert.ok(flutter.priority > code.priority);
});

test("roadmap steps have a valid shape", () => {
  const kinds = new Set(["advisory", "skill", "edit", "verify", "approval"]);
  for (const category of spec.categories) {
    assert.ok(category.roadmap, `category ${category.id} has no roadmap`);
    for (const step of category.roadmap.steps) {
      assert.ok(step.id.length > 0, `empty step id in ${category.id}`);
      assert.ok(step.label.length > 0, `empty step label in ${category.id}`);
      assert.ok(kinds.has(step.kind), `invalid kind ${step.kind} in ${category.id}`);
      for (const skill of step.requireSkills ?? []) {
        assert.match(skill, /^[a-z0-9]+(?:-[a-z0-9]+)*$/i, `invalid skill id ${skill}`);
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
