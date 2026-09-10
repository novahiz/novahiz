import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "../src/catalog.ts";

test("parses simple key value frontmatter", () => {
  const parsed = parseFrontmatter("---\nname: gate\ndescription: Le gardien\n---\n\nbody");
  assert.equal(parsed.name, "gate");
  assert.equal(parsed.description, "Le gardien");
});

test("parses block scalar descriptions", () => {
  const content = "---\nname: humanizer\ndescription: |\n  Remove signs of AI writing.\n  Use when editing text.\n---\nbody";
  const parsed = parseFrontmatter(content);
  assert.equal(parsed.name, "humanizer");
  assert.ok(parsed.description.includes("Remove signs of AI writing."));
  assert.ok(parsed.description.includes("Use when editing text."));
});

test("parses folded scalar descriptions", () => {
  const content = "---\nname: x\ndescription: >\n  Une phrase\n  sur deux lignes.\n---\nbody";
  const parsed = parseFrontmatter(content);
  assert.equal(parsed.description, "Une phrase sur deux lignes.");
});

test("returns empty on missing frontmatter", () => {
  assert.deepEqual(parseFrontmatter("# no frontmatter"), {});
});
