import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIMIT_CHARS,
  DEFAULT_LIMIT_LINES,
  MAX_CONTENT_LEN,
  ensureMemoryRoot,
  findTargetSlot,
  getSlot,
  isFull,
  isSafeSlotFile,
  listSlots,
  memoryRoot,
  parseSlotInput,
  rebuildIndex,
  readIndex,
  relatedness,
  slotPath,
  writeEntry
} from "../src/memory.ts";

const base = mkdtempSync(join(tmpdir(), "novahiz-memory-"));
const root = join(base, "project-memory");

after(() => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

test("memoryRoot joins cwd with project-memory", () => {
  assert.equal(memoryRoot(base), join(base, "project-memory"));
});

test("ensureMemoryRoot creates index.json and slots/", () => {
  const index = ensureMemoryRoot(root);
  assert.equal(index.version, 1);
  assert.deepEqual(index.slots, []);
  assert.ok(existsSync(join(root, "index.json")));
  assert.ok(existsSync(join(root, "slots")));
});

test("writeEntry creates the first active slot", () => {
  const result = writeEntry({
    root,
    title: "session bootstrap",
    content: "Première entrée de la session.",
    description: "notes de session",
    tags: ["session"]
  });
  assert.equal(result.created, true);
  assert.equal(result.rotated, false);
  assert.equal(result.slot.id, "slot-001");
  assert.equal(result.slot.status, "active");
  assert.equal(result.slot.limit_chars, DEFAULT_LIMIT_CHARS);
  assert.equal(result.slot.limit_lines, DEFAULT_LIMIT_LINES);
  assert.ok(result.slot.chars > 0);
  assert.ok(result.index.slots.some((slot) => slot.id === "slot-001"));
});

test("related entries land in the same active slot", () => {
  const relatedRoot = join(base, "related-root");
  const first = writeEntry({
    root: relatedRoot,
    title: "supabase schema notes",
    content: "RLS policies drafted for public reads."
  });
  assert.equal(first.created, true);
  const second = writeEntry({
    root: relatedRoot,
    title: "supabase schema follow-up",
    content: "Added indexes on foreign keys used by list queries."
  });
  assert.equal(second.created, false);
  assert.equal(second.slot.id, first.slot.id);
  assert.ok(second.slot.chars > first.slot.chars);
});

test("unrelated title creates a second slot", () => {
  const relatedRoot = join(base, "related-root");
  const result = writeEntry({
    root: relatedRoot,
    title: "marketing seo audit",
    content: "Checked meta tags on the landing page."
  });
  assert.equal(result.created, true);
  assert.equal(listSlots(relatedRoot).slots.length, 2);
});

test("relatedness scores token overlap", () => {
  assert.ok(relatedness("supabase schema notes", "supabase schema follow-up") >= 0.25);
  assert.ok(relatedness("supabase schema notes", "marketing seo audit") < 0.25);
});

test("findTargetSlot honors forced slotId", () => {
  const index = listSlots(root);
  const forced = findTargetSlot(index, root, {
    title: "totally unrelated topic",
    slotId: "slot-001"
  });
  assert.equal(forced?.id, "slot-001");
});

test("getSlot returns Résumé and Détails sections", () => {
  const file = getSlot("slot-001", root);
  assert.equal(file.meta.id, "slot-001");
  assert.ok(file.body.summary.length > 0);
  assert.ok(file.body.details.includes("session"));
  assert.ok(file.raw.includes("## Résumé"));
  assert.ok(file.raw.includes("## Détails"));
});

test("parseSlotInput validates title and content", () => {
  assert.throws(() => parseSlotInput({ title: "", content: "x" }), /title/);
  assert.throws(() => parseSlotInput({ title: "t", content: "" }), /content|contenu/);
  const parsed = parseSlotInput({ title: "t", content: "c", tags: ["a", 1] });
  assert.deepEqual(parsed.tags, ["a", "1"]);
});

test("writeEntry rejects empty or oversized content", () => {
  assert.throws(() => writeEntry({ root, title: "t", content: "   " }), /E_CONTENT|contenu/);
  assert.throws(
    () => writeEntry({ root, title: "t", content: "x".repeat(MAX_CONTENT_LEN + 1) }),
    /E_CONTENT|trop long|100000/
  );
});

test("full slot compacts then archives and rotates", () => {
  const rotateRoot = join(base, "rotate-root");
  const chunk = "z".repeat(5000);
  const first = writeEntry({ root: rotateRoot, title: "rotation host", content: chunk });
  assert.equal(first.created, true);
  const second = writeEntry({ root: rotateRoot, title: "rotation host", content: chunk });
  assert.equal(second.rotated, true);
  assert.notEqual(second.slot.id, "slot-001");
  assert.equal(second.slot.status, "active");
  const index = listSlots(rotateRoot);
  assert.equal(index.slots.length, 2);
  const archived = index.slots.filter((slot) => slot.status === "archived");
  assert.equal(archived.length, 1);
  assert.equal(archived[0].id, "slot-001");
  assert.ok(isFull(archived[0]));
  assert.equal(index.slots.filter((slot) => slot.status === "active").length, 1);
});

test("rebuildIndex restores index.json from markdown files", () => {
  const rebuildRoot = join(base, "rebuild-root");
  writeEntry({ root: rebuildRoot, title: "keep me", content: "body one" });
  writeEntry({ root: rebuildRoot, title: "other topic", content: "body two" });
  writeFileSync(join(rebuildRoot, "index.json"), JSON.stringify({ version: 1, updated: "", slots: [] }));
  const rebuilt = rebuildIndex(rebuildRoot);
  assert.equal(rebuilt.slots.length, 2);
  const disk = JSON.parse(readFileSync(join(rebuildRoot, "index.json"), "utf8"));
  assert.equal(disk.slots.length, 2);
  assert.equal(disk.slots[0].id, "slot-001");
});

test("isSafeSlotFile rejects traversal, absolute and empty paths", () => {
  assert.equal(isSafeSlotFile("../../evil.md"), false);
  assert.equal(isSafeSlotFile("..\\..\\evil.md"), false);
  assert.equal(isSafeSlotFile("/etc/passwd"), false);
  assert.equal(isSafeSlotFile("C:\\Windows\\evil.md"), false);
  assert.equal(isSafeSlotFile(""), false);
  assert.equal(isSafeSlotFile(42), false);
  assert.equal(isSafeSlotFile("slots/slot-001.md"), true);
});

test("slotPath throws on an unsafe slot file", () => {
  assert.throws(() => slotPath(root, { file: "../../evil.md" }), /slot.file invalide/);
});

test("readIndex filters unsafe slot files from the index", () => {
  const evilRoot = join(base, "evil-root");
  ensureMemoryRoot(evilRoot);
  writeFileSync(
    join(evilRoot, "index.json"),
    JSON.stringify({
      version: 1,
      updated: new Date().toISOString(),
      slots: [
        { id: "slot-001", file: "../../evil.md", status: "active" },
        { id: "slot-002", file: "slots/slot-002.md", status: "active" }
      ]
    })
  );
  const filtered = readIndex(evilRoot);
  assert.deepEqual(
    filtered.slots.map((slot) => slot.id),
    ["slot-002"]
  );
  assert.equal(listSlots(evilRoot).slots.length, 1);
});
