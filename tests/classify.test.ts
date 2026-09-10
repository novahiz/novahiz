import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { classify } from "../src/classify.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("classifies a design prompt as design-ui", () => {
  const result = classify(spec, "refais le css de la landing page et la typographie");
  assert.equal(result.categories[0].id, "design-ui");
  assert.ok(result.requiredSkills.includes("impeccable"));
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

test("falls back to general on a neutral prompt", () => {
  const result = classify(spec, "bonjour, comment vas tu ?");
  assert.equal(result.categories[0].id, "general");
  assert.deepEqual(result.requiredSkills, []);
});

test("ignores accents when matching", () => {
  const result = classify(spec, "verifie la securite");
  assert.ok(result.categories.some((entry) => entry.id === "audit"));
});
