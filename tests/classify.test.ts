import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { classify } from "../src/classify.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("classifies a design prompt as design-ui with a roadmap", () => {
  const result = classify(spec, "refais le css de la landing page et la typographie");
  assert.equal(result.categories[0].id, "design-ui");
  assert.equal(result.primary, "design-ui");
  assert.equal(result.tier, "lite");
  // Lite tier only includes implement + converge skills
  assert.ok(result.requiredSkills.includes("novahiz-implement"));
  assert.ok(result.requiredSkills.includes("novahiz-converge"));
  assert.equal(result.roadmaps[0].category, "design-ui");
  assert.ok(result.categories[0].confidence > 0 && result.categories[0].confidence <= 1);
});

test("classifies a supabase prompt and requires supabase skills", () => {
  const result = classify(spec, "ajoute une migration supabase avec une policy rls");
  assert.equal(result.categories[0].id, "database-supabase");
  assert.ok(result.requiredSkills.includes("novahiz-supabase"));
  assert.ok(result.requiredSkills.includes("novahiz-postgres"));
});

test("classification is deterministic", () => {
  const first = classify(spec, "audit securite owasp de l api et des dependances");
  const second = classify(spec, "audit securite owasp de l api et des dependances");
  assert.deepEqual(first, second);
});

test("classifies a refactor prompt as code", () => {
  const result = classify(spec, "Decouper src/cli.ts (1435 lignes) en modules dans src/commands/ sans changer le comportement du CLI");
  assert.equal(result.primary, "code");
  assert.equal(result.tier, "lite");
  // Lite tier only includes implement + converge skills
  assert.ok(result.requiredSkills.includes("novahiz-implement"));
  assert.ok(result.requiredSkills.includes("novahiz-converge"));
});

test("falls back to general with trivial tier (no roadmap skills)", () => {
  const result = classify(spec, "bonjour, comment vas tu ?");
  assert.equal(result.categories[0].id, "general");
  assert.equal(result.tier, "trivial");
  // Trivial tier injects no roadmap skills
  assert.equal(result.requiredSkills.length, 0);
});

test("ignores accents when matching", () => {
  const result = classify(spec, "verifie la securite");
  assert.ok(result.categories.some((entry) => entry.id === "audit"));
});

test("negative keywords can suppress a category", () => {
  const result = classify(spec, "fais une migration pour la landing");
  const ids = result.categories.map((entry) => entry.id);
  assert.equal(ids.includes("database-supabase"), false);
});

test("classifies the relevant MCP providers", () => {
  const result = classify(spec, "ouvre la page web avec playwright et capture un screenshot");
  assert.ok(result.providers.includes("playwright"));
});

test("reports a confidence margin and matched negatives", () => {
  const result = classify(spec, "ajoute une migration supabase avec une policy rls");
  const top = result.categories[0];
  assert.equal(typeof top.margin, "number");
  assert.ok(top.margin >= 0);
  assert.ok(Array.isArray(top.negatives));
});

test("exposes skill invocations with their roadmap step", () => {
  const result = classify(spec, "refactor le module de paiement et corrige le total");
  const skills = result.invocations.flatMap((entry) => entry.skills);
  assert.ok(result.invocations.length > 0);
  assert.ok(skills.includes("novahiz-plan"));
  assert.ok(result.invocations.every((entry) => entry.kind === "skill"));
});

test("a clear prompt separates the top category from the next", () => {
  const result = classify(spec, "audit securite owasp de l api et des dependances");
  assert.ok(result.categories[0].margin > 0);
});

test("classifies a Flutter prompt as flutter with quality skills", () => {
  const result = classify(
    spec,
    "Ajoute un widget Flutter avec un test unitaire et lance dart analyze sur le projet"
  );
  assert.equal(result.primary, "flutter");
  assert.ok(result.requiredSkills.includes("flutter-apply-architecture-best-practices"));
  assert.ok(result.requiredSkills.includes("dart-run-static-analysis"));
  assert.ok(result.requiredSkills.includes("dart-add-unit-test"));
  assert.ok(result.providers.includes("dart"));
  assert.ok(result.providers.includes("flutter-skills"));
  assert.equal(result.roadmaps[0]?.id, "flutter-feature");
});

test("pure Dart function prompt still hits flutter over generic code", () => {
  const result = classify(spec, "Écris une fonction Dart qui parse un pubspec.yaml");
  assert.equal(result.primary, "flutter");
});
