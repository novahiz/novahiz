import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { classify } from "../src/classify.ts";
import { evaluateGate } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);

function roadmapEnforced(categoryId: string): string[] {
  const category = spec.categories.find((entry) => entry.id === categoryId);
  assert.ok(category?.roadmap, `roadmap manquante pour ${categoryId}`);
  const skills: string[] = [];
  for (const step of category!.roadmap!.steps) {
    if (step.optional) continue;
    for (const skill of step.requireSkills ?? []) {
      if (!skills.includes(skill)) skills.push(skill);
    }
  }
  return skills.sort();
}

describe("gate/classify: une seule source de verite", () => {
  test("R6 et R10 ne doublonnent plus les roadmaps", () => {
    assert.equal(spec.rules.find((rule) => rule.id === "R6-Novahiz"), undefined);
    assert.equal(spec.rules.find((rule) => rule.id === "R10-security"), undefined);
  });

  test("R11 ne vise plus que design-ui", () => {
    const rule = spec.rules.find((entry) => entry.id === "R11-accessibility");
    assert.ok(rule);
    assert.deepEqual([...rule!.when.promptCategories!], ["design-ui"]);
  });

  test("un audit exige la roadmap audit, pas la couche R6/R11", () => {
    const result = evaluateGate({
      tool: "edit",
      filePath: "notes/report.txt",
      content: "",
      prompt: "audit de securite complet du serveur",
      categories: ["audit"],
      tier: "full",
      loadedSkills: [],
      installedSkills: null,
      installedIndexAvailable: true,
      spec
    });
    assert.deepEqual([...result.requiredSkills].sort(), roadmapEnforced("audit"));
    assert.ok(!result.requiredSkills.includes("novahiz-wcag-audit"));
    assert.ok(!result.matchedRules.includes("R6-Novahiz"));
    assert.ok(!result.matchedRules.includes("R10-security"));
  });

  test("classify annonce exactement ce que le gate exige sur un audit", () => {
    const result = classify(spec, "audit de securite complet du serveur");
    assert.equal(result.tier, "full");
    assert.deepEqual([...result.enforcedSkills].sort(), roadmapEnforced("audit"));
  });

  test("un audit sans prompt ne retombe pas en trivial", () => {
    const result = evaluateGate({
      tool: "edit",
      filePath: "notes/report.txt",
      content: "",
      categories: ["audit"],
      loadedSkills: [],
      installedSkills: null,
      installedIndexAvailable: true,
      spec
    });
    assert.equal(result.tier, "full");
    assert.deepEqual([...result.requiredSkills].sort(), roadmapEnforced("audit"));
  });

  test("le prompt FR bouton de connexion est classe design-ui en lite", () => {
    const result = classify(spec, "ajoute un bouton de connexion sur l'écran d'accueil");
    assert.equal(result.tier, "lite");
    assert.equal(result.primary, "design-ui");
    assert.deepEqual([...result.enforcedSkills].sort(), ["novahiz-converge", "novahiz-implement"]);
  });

  test("un bug de login reste dans debug, pas dans design-ui", () => {
    const result = classify(spec, "fix the login bug");
    assert.equal(result.tier, "lite");
    assert.ok(result.categories.some((entry) => entry.id === "debug"));
    assert.ok(!result.categories.some((entry) => entry.id === "design-ui"));
  });

  test("le gate exige design et wireframe sur une vue Flutter design-ui", () => {
    const result = evaluateGate({
      tool: "edit",
      filePath: "lib/ui/features/auth/views/login_view.dart",
      content: "x".repeat(900),
      prompt: "ajoute un bouton de connexion sur l'écran d'accueil",
      categories: ["design-ui"],
      tier: "lite",
      loadedSkills: [],
      installedSkills: null,
      installedIndexAvailable: true,
      spec
    });
    for (const skill of [
      "novahiz-humanizer",
      "ui-slop-remover",
      "ui-craft-rules",
      "impeccable",
      "novahiz-wcag-audit",
      "novahiz-wireframe",
      "novahiz-implement",
      "novahiz-converge"
    ]) {
      assert.ok(result.requiredSkills.includes(skill), `skill manquante: ${skill}`);
    }
  });

  test("le projet Flutter: la roadmap complete sans skill de design en trop", () => {
    const result = evaluateGate({
      tool: "edit",
      filePath: "lib/ui/features/welcome/views/welcome_view.dart",
      content: "x".repeat(600),
      prompt: "implement a login button on the welcome screen",
      categories: ["flutter"],
      tier: "full",
      loadedSkills: [],
      installedSkills: null,
      installedIndexAvailable: true,
      spec
    });
    assert.deepEqual([...result.requiredSkills].sort(), roadmapEnforced("flutter"));
    assert.ok(!result.requiredSkills.includes("novahiz-wcag-audit"));
  });
});
