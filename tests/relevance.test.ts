import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSkills, type CatalogSkill } from "../src/relevance.ts";

const catalog: CatalogSkill[] = [
  { id: "humanizer", name: "humanizer", description: "Remove AI writing patterns from text", power: 5, stars: null, tags: ["text", "quality"], categories: ["code", "docs-writing"] },
  { id: "impeccable", name: "impeccable", description: "Design and improve frontend interfaces", power: 5, stars: null, tags: ["design", "ui"], categories: ["design-ui"] },
  { id: "supabase", name: "supabase", description: "Supabase database auth and edge functions", power: 5, stars: null, tags: ["database"], categories: ["database-supabase"] },
  { id: "code-reviewer", name: "code-reviewer", description: "Review pull requests and code quality", power: 4, stars: null, tags: ["review"], categories: ["review"] }
];

test("ranks the most relevant skill first", () => {
  const ranked = rankSkills(catalog, "refais le design de la page", 3);
  assert.equal(ranked[0].id, "impeccable");
});

test("matches on tags and categories", () => {
  const ranked = rankSkills(catalog, "postgres database", 3);
  assert.equal(ranked[0].id, "supabase");
});

test("is deterministic across calls", () => {
  const first = rankSkills(catalog, "review code quality", 3);
  const second = rankSkills(catalog, "review code quality", 3);
  assert.deepEqual(first, second);
});

test("returns nothing for an empty query", () => {
  assert.deepEqual(rankSkills(catalog, "", 5), []);
});

test("respects the limit", () => {
  const ranked = rankSkills(catalog, "code review text", 2);
  assert.ok(ranked.length <= 2);
});
