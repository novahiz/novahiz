import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { classify } from "../src/classify.ts";
import { LITE_SKIPPED_SKILLS } from "../src/complexity.ts";
import { evaluateGate, isTempPath } from "../src/gate.ts";
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
    // Lite drops the process skills (plan, clarify, task, analyse) but keeps
    // every domain skill the full tier enforces. Keeping only implement/converge
    // was the defect: a lite design change silently lost wireframe and tokens.
    const expected = roadmapEnforced("design-ui").filter((skill) => !LITE_SKIPPED_SKILLS.includes(skill));
    assert.deepEqual([...result.enforcedSkills].sort(), expected);
    assert.ok(result.enforcedSkills.includes("novahiz-wireframe"));
    assert.ok(!result.enforcedSkills.includes("novahiz-plan"));
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

describe("NX-52: fichier jetable hors projet", () => {
  test("un chemin relatif appartient au projet, meme quand le cwd est sous %TEMP%", () => {
    // Mesure du 2026-10-31 : `novahiz doctor` sonde le gate avec `src/hero.css`
    // et un cwd sous le dossier temporaire. La sonde etait classee jetable, le
    // gate repondait allow, et le diagnostic annoncait une anomalie bloquante.
    assert.equal(isTempPath("src/hero.css"), false);
    assert.equal(isTempPath("scripts/sonde.mjs"), false);
    assert.equal(isTempPath(join(tmpdir(), "opencode", "sonde.mjs")), true);
  });

  test("un fichier sous le dossier temporaire est ignoré", () => {
    const result = evaluateGate({
      tool: "write",
      filePath: join(tmpdir(), "opencode", "sonde.mjs"),
      content: "console.log(1)",
      prompt: "évaluer le système et ses évaluations",
      categories: ["assessment"],
      tier: "full",
      loadedSkills: [],
      installedSkills: null,
      installedIndexAvailable: true,
      spec
    });
    assert.equal(result.ignored, true);
    assert.equal(result.allow, true);
    assert.deepEqual(result.requiredSkills, []);
  });

  test("un fichier du projet reste évalué", () => {
    const result = evaluateGate({
      tool: "write",
      filePath: "scripts/sonde.mjs",
      content: "console.log(1)".repeat(60),
      prompt: "évaluer le système et ses évaluations",
      categories: ["assessment"],
      tier: "full",
      loadedSkills: [],
      installedSkills: null,
      installedIndexAvailable: true,
      spec
    });
    assert.equal(result.ignored, false);
    assert.ok(result.requiredSkills.length > 0);
  });
});
