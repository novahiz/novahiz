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
  assert.ok(result.requiredSkills.includes("impeccable"));
  assert.equal(result.roadmaps[0].category, "design-ui");
  assert.ok(result.categories[0].confidence > 0 && result.categories[0].confidence <= 1);
});

test("classifies a supabase prompt and requires supabase skills", () => {
  const result = classify(spec, "ajoute une migration supabase avec une policy rls");
  assert.equal(result.categories[0].id, "database-supabase");
  assert.ok(result.requiredSkills.includes("supabase"));
  assert.ok(result.requiredSkills.includes("supabase-postgres-best-practices"));
});

test("classification is deterministic", () => {
  const first = classify(spec, "audit securite owasp de l api et des dependances");
  const second = classify(spec, "audit securite owasp de l api et des dependances");
  assert.deepEqual(first, second);
});

test("falls back to general and injects the general roadmap skill", () => {
  const result = classify(spec, "bonjour, comment vas tu ?");
  assert.equal(result.categories[0].id, "general");
  assert.ok(result.requiredSkills.includes("humanizer"));
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
