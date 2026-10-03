// Characterization suite (S0): locks le comportement ACTUEL de src/memory.ts
// avant toute modification. Toute evolution de S1-S5 doit ajuster ces tests de
// facon deliberee (et documentee), pas les contourner.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_LIMIT_CHARS,
  DEFAULT_LIMIT_LINES,
  MAX_CONTENT_LEN,
  MAX_SUMMARY_CHARS,
  MAX_TITLE_LEN,
  assertSlotId,
  createSlot,
  ensureMemoryRoot,
  findTargetSlot,
  getSlot,
  isFull,
  isSafeSlotFile,
  nextSlotId,
  parseSlotInput,
  readIndex,
  rebuildIndex,
  relatedness,
  slotPath,
  writeEntry,
  writeIndex
} from "../src/memory.ts";
import type { MemoryError } from "../src/memory.ts";

const errCode = (error: unknown): string => (error as MemoryError).code;

const throwsCode = (fn: () => unknown, code: string): void => {
  assert.throws(fn, (error: unknown) => errCode(error) === code);
};

describe("memory.ts - characterization (comportement actuel, S0)", () => {
  const roots: string[] = [];

  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-memtest-"));
    roots.push(root);
    return root;
  };

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    }
  });

  describe("index: creation et persistance", () => {
    test("racine vierge: ensureMemoryRoot cree index.json version 1, 0 slot", () => {
      const root = makeRoot();
      const index = ensureMemoryRoot(root);
      assert.equal(index.version, 1);
      assert.equal(index.slots.length, 0);
      assert.ok(existsSync(join(root, "index.json")));
    });

    test("readIndex sur index absent: retourne l'index vide SANS ecrire le fichier", () => {
      const root = makeRoot();
      const index = readIndex(root);
      assert.equal(index.slots.length, 0);
      assert.equal(existsSync(join(root, "index.json")), false);
      assert.equal(existsSync(join(root, "slots")), false);
    });

    test("readIndex filtre silencieusement les slots au file non sur (traversal)", () => {
      const root = makeRoot();
      ensureMemoryRoot(root);
      const crafted = {
        version: 1,
        updated: new Date().toISOString(),
        slots: [
          {
            id: "slot-001",
            title: "ok",
            description: "",
            created: new Date().toISOString(),
            chars: 1,
            lines: 1,
            limit_chars: 8000,
            limit_lines: 200,
            status: "active",
            tags: [],
            file: "../evil.md"
          },
          {
            id: "slot-002",
            title: "safe",
            description: "",
            created: new Date().toISOString(),
            chars: 1,
            lines: 1,
            limit_chars: 8000,
            limit_lines: 200,
            status: "active",
            tags: [],
            file: "slots/slot-002-safe.md"
          }
        ]
      };
      writeFileSync(join(root, "index.json"), JSON.stringify(crafted), "utf8");
      const index = readIndex(root);
      assert.deepEqual(
        index.slots.map((slot) => slot.id),
        ["slot-002"]
      );
    });

    test("writeIndex persiste exactement ce qui lui est fourni", () => {
      const root = makeRoot();
      const made = createSlot(root, { title: "aa bb cc dd" });
      const emptied = writeIndex(root, { ...made.index, slots: [] });
      assert.equal(emptied.slots.length, 0);
      assert.equal(readIndex(root).slots.length, 0);
    });
  });

  describe("routage: relatedness et seuil 0.25", () => {
    test("identique vers 1, disjoint vers 0, partiel = commun/max", () => {
      assert.equal(relatedness("alpha beta gamma", "alpha beta gamma"), 1);
      assert.equal(relatedness("zorglub matrice", "alpha beta"), 0);
      assert.equal(relatedness("alpha", "alpha beta gamma delta"), 0.25);
    });

    test("mots de 2 caracteres ou moins ignores, casse froissee", () => {
      assert.equal(relatedness("de la Alpha", "alpha DE"), 1);
      assert.equal(relatedness("de la", "les des"), 0);
    });

    test("findTargetSlot: score >= 0.25 route vers le slot existant", () => {
      const root = makeRoot();
      const made = createSlot(root, { title: "alpha beta gamma delta" });
      const target = findTargetSlot(made.index, root, { title: "alpha" });
      assert.equal(target?.id, made.meta.id);
    });

    test("findTargetSlot: 0.2 < 0.25 retourne null (nouvel emplacement)", () => {
      const root = makeRoot();
      const made = createSlot(root, { title: "alpha beta gamma delta epsilon" });
      const target = findTargetSlot(made.index, root, { title: "alpha" });
      assert.equal(target, null);
    });

    test("findTargetSlot: les slots archives ne sont jamais proposes", () => {
      const root = makeRoot();
      const made = createSlot(root, { title: "alpha beta gamma delta" });
      const index = writeIndex(root, {
        ...made.index,
        slots: [{ ...made.meta, status: "archived" }]
      });
      assert.equal(findTargetSlot(index, root, { title: "alpha" }), null);
    });

    test("findTargetSlot: slotId explicite inconnu -> E_SLOT", () => {
      const root = makeRoot();
      const index = ensureMemoryRoot(root);
      throwsCode(() => findTargetSlot(index, root, { title: "t", slotId: "slot-999" }), "E_SLOT");
    });

    test("findTargetSlot: slotId archive -> E_SLOT avec mention archive", () => {
      const root = makeRoot();
      const made = createSlot(root, { title: "xx yy zz" });
      const index = writeIndex(root, {
        ...made.index,
        slots: [{ ...made.meta, status: "archived" }]
      });
      assert.throws(
        () => findTargetSlot(index, root, { title: "t", slotId: made.meta.id }),
        (error: unknown) => errCode(error) === "E_SLOT" && /archiv/.test((error as Error).message)
      );
    });
  });

  describe("writeEntry: cycle de vie", () => {
    test("premiere ecriture: slot-001 cree, actif, resume = description", () => {
      const root = makeRoot();
      const result = writeEntry({
        root,
        title: "alpha beta gamma delta",
        content: "ligne une",
        description: "desc premiere"
      });
      assert.equal(result.created, true);
      assert.equal(result.rotated, false);
      assert.equal(result.compacted, false);
      assert.equal(result.slot.id, "slot-001");
      assert.equal(result.slot.status, "active");
      assert.equal(result.index.slots.length, 1);
      const file = getSlot("slot-001", root);
      assert.equal(file.body.summary, "desc premiere");
      assert.match(file.body.details, /ligne une/);
    });

    test("meme titre: routage vers le slot existant, append cumule", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma delta", content: "ligne une" });
      const second = writeEntry({ root, title: "alpha beta gamma delta", content: "ligne deux" });
      assert.equal(second.created, false);
      assert.equal(second.slot.id, "slot-001");
      const file = getSlot("slot-001", root);
      assert.match(file.body.details, /ligne une/);
      assert.match(file.body.details, /ligne deux/);
    });

    test("titre disjoint: slot-002, deux entrees dans l'index", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma delta", content: "un" });
      const other = writeEntry({ root, title: "zorglub matrice xyz", content: "deux" });
      assert.equal(other.created, true);
      assert.equal(other.slot.id, "slot-002");
      assert.equal(other.index.slots.length, 2);
    });

    test("slotId explicite valide: ecrit dedans meme si le titre est disjoint", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      const forced = writeEntry({
        root,
        title: "zzz sujet totalement different",
        content: "two",
        slotId: "slot-001"
      });
      assert.equal(forced.slot.id, "slot-001");
      assert.equal(forced.created, false);
      assert.match(getSlot("slot-001", root).body.details, /two/);
    });

    test("tags: fusion, trim, dedoublonnage au merge (cap 12)", () => {
      const root = makeRoot();
      writeEntry({ root, title: "t proc test", content: "a", tags: ["infra", "infra", " sec "] });
      const merged = writeEntry({ root, title: "t proc test", content: "b", tags: ["ops"] });
      assert.deepEqual([...merged.slot.tags].sort(), ["infra", "ops", "sec"]);
      assert.ok(merged.slot.tags.length <= 12);
    });

    test("append avec description: meta.description mise a jour, resume du corps inchange", () => {
      const root = makeRoot();
      writeEntry({ root, title: "sujet alpha ici", content: "a" });
      const result = writeEntry({
        root,
        title: "sujet alpha ici",
        content: "b",
        description: "nouvelle description"
      });
      assert.equal(result.slot.description, "nouvelle description");
      assert.equal(getSlot("slot-001", root).body.summary, "sujet alpha ici");
    });

    test("validations: contenu vide E_CONTENT, titre vide E_TITLE, contenu trop long E_CONTENT", () => {
      const root = makeRoot();
      throwsCode(() => writeEntry({ root, title: "t", content: "   " }), "E_CONTENT");
      throwsCode(() => writeEntry({ root, title: " ", content: "x" }), "E_TITLE");
      throwsCode(
        () => writeEntry({ root, title: "t", content: "x".repeat(MAX_CONTENT_LEN + 1) }),
        "E_CONTENT"
      );
    });

    test("titre long tronque a MAX_TITLE_LEN sans erreur", () => {
      const root = makeRoot();
      const result = writeEntry({ root, title: "t".repeat(500), content: "x" });
      assert.equal(result.slot.title.length, MAX_TITLE_LEN);
    });

    test("getSlot: id valide absent -> E_SLOT, id dangereux -> E_SLOT_ID", () => {
      const root = makeRoot();
      ensureMemoryRoot(root);
      throwsCode(() => getSlot("slot-999", root), "E_SLOT");
      throwsCode(() => getSlot("../evil", root), "E_SLOT_ID");
      throwsCode(() => getSlot("a/b", root), "E_SLOT_ID");
      throwsCode(() => getSlot("a\\b", root), "E_SLOT_ID");
      throwsCode(() => getSlot("", root), "E_SLOT_ID");
    });
  });

  describe("rotation a la plenitude", () => {
    test("ligne unique de 9000 chars: compactage impossible -> rotation directe", () => {
      const root = makeRoot();
      const result = writeEntry({ root, title: "slot gros test", content: "x".repeat(9000) });
      assert.equal(result.created, true);
      assert.equal(result.compacted, false);
      assert.equal(result.rotated, true);
      assert.equal(result.slot.id, "slot-002");
      const statuses = new Map(result.index.slots.map((slot) => [slot.id, slot.status]));
      assert.equal(statuses.get("slot-001"), "archived");
      assert.equal(statuses.get("slot-002"), "active");
      assert.match(getSlot("slot-001", root).body.details, /^x{9000}$/);
    });

    test("S3: contenu pluri-ligne plein -> compactage borne libere la place, pas de rotation", () => {
      const root = makeRoot();
      const content = Array.from(
        { length: 10 },
        (_, index) => `Ligne ${index} ` + "y".repeat(890)
      ).join("\n");
      const result = writeEntry({ root, title: "slot multiline", content });
      assert.equal(result.created, true);
      assert.equal(result.compacted, true);
      // S3: le Resume est borne, le compactage libere assez de caracteres —
      // la rotation n'a plus lieu d'etre sur ce profil de contenu.
      assert.equal(result.rotated, false);
      assert.equal(result.slot.id, "slot-001");

      const slot = getSlot("slot-001", root);
      assert.equal(slot.meta.status, "active");
      assert.ok(slot.body.summary.length <= MAX_SUMMARY_CHARS);
      assert.ok(slot.body.summary.startsWith("slot multiline"));
      assert.match(slot.body.summary, /Ligne 5/);
      assert.equal(slot.body.details.split(/\r?\n/).length, 4);
      assert.ok(slot.meta.chars < DEFAULT_LIMIT_CHARS);
    });

    test("ecriture forcee vers un slot archive -> E_SLOT", () => {
      const root = makeRoot();
      writeEntry({ root, title: "slot gros test", content: "x".repeat(9000) });
      throwsCode(
        () => writeEntry({ root, title: "autre sujet la", content: "y", slotId: "slot-001" }),
        "E_SLOT"
      );
    });
  });

  describe("index corrompu (E_INDEX)", () => {
    const corrupt = (root: string): void => {
      ensureMemoryRoot(root);
      writeFileSync(join(root, "index.json"), "NOT JSON {", "utf8");
    };

    test("readIndex -> E_INDEX quand le JSON est illisible", () => {
      const root = makeRoot();
      corrupt(root);
      throwsCode(() => readIndex(root), "E_INDEX");
    });

    test("S1: writeEntry auto-guerit un index corrompu (healed true, ecriture reussie)", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      corrupt(root);
      const result = writeEntry({ root, title: "ee ff gg hh", content: "two" });
      assert.equal(result.index.healed, true);
      assert.equal(result.slot.id, "slot-002");
      const disk = JSON.parse(
        readFileSync(join(root, "index.json"), "utf8")
      ) as Record<string, unknown>;
      assert.equal("healed" in disk, false);
      assert.equal((disk.slots as unknown[]).length, 2);
      assert.equal(existsSync(join(root, ".lock")), false);
    });

    test("S1: rebuildIndex reconstruit depuis un index corrompu (correctif du bug S0)", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      writeEntry({ root, title: "ee ff gg hh", content: "two" });
      corrupt(root);
      const rebuilt = rebuildIndex(root);
      assert.deepEqual(
        rebuilt.slots.map((slot) => slot.id),
        ["slot-001", "slot-002"]
      );
    });

    test("rebuildIndex (fichiers sains) reconstruit l'index depuis les slots", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      writeEntry({ root, title: "ee ff gg hh", content: "two" });
      writeIndex(root, { ...readIndex(root), slots: [] });
      const rebuilt = rebuildIndex(root);
      assert.deepEqual(
        rebuilt.slots.map((slot) => slot.id),
        ["slot-001", "slot-002"]
      );
      assert.equal(
        (rebuilt.slots[0]?.file ?? "").replace(/\\/g, "/").startsWith("slots/"),
        true
      );
      assert.ok((rebuilt.slots[0]?.chars ?? 0) > 0);
    });
  });

  describe("securite des chemins et identifiants", () => {
    test("isSafeSlotFile refuse absolu, traversal, lecteur, vide", () => {
      const refused = [
        "../evil.md",
        "slots/../../evil.md",
        "/etc/passwd",
        "\\evil.md",
        "C:\\evil.md",
        "",
        "   "
      ];
      for (const candidate of refused) {
        assert.equal(isSafeSlotFile(candidate), false, `devrait refuser: ${candidate}`);
      }
      assert.equal(isSafeSlotFile(42 as unknown as string), false);
      assert.equal(isSafeSlotFile(null as unknown as string), false);
    });

    test("isSafeSlotFile accepte les chemins relatifs (racine ou sous-dossier)", () => {
      assert.equal(isSafeSlotFile("slot-001-alpha.md"), true);
      assert.equal(isSafeSlotFile("slots/slot-001-alpha.md"), true);
    });

    test("slotPath refuse un meta.file hors racine -> E_INDEX", () => {
      throwsCode(() => slotPath("C:\\base", { file: "../x.md" }), "E_INDEX");
      throwsCode(() => slotPath("C:\\base", { file: "/abs.md" }), "E_INDEX");
      assert.ok(slotPath("C:\\base", { file: "slots\\slot-001-a.md" }).includes("slots"));
    });

    test("assertSlotId: identifiant propre accepte, segmente ou trop long refuse", () => {
      assert.equal(assertSlotId("slot-001"), "slot-001");
      const refused = ["", "a/b", "a\\b", "x..y", "..", "n".repeat(129)];
      for (const candidate of refused) {
        throwsCode(() => assertSlotId(candidate), "E_SLOT_ID");
      }
    });

    test("parseSlotInput: validation title/content/slotId + coercion tags", () => {
      const parsed = parseSlotInput({
        title: "t",
        content: "c",
        tags: ["a", 2],
        slotId: "slot-001"
      });
      assert.equal(parsed.title, "t");
      assert.deepEqual(parsed.tags, ["a", "2"]);
      throwsCode(() => parseSlotInput({ title: "", content: "c" }), "E_TITLE");
      throwsCode(() => parseSlotInput({ title: "t", content: "" }), "E_CONTENT");
      throwsCode(() => parseSlotInput({ title: "t", content: "c", slotId: "../x" }), "E_SLOT_ID");
      throwsCode(() => parseSlotInput({ title: "t", content: "c", slotId: "a/b" }), "E_SLOT_ID");
    });
  });

  describe("plenitude et allocation d'identifiants", () => {
    test("isFull: bornes exactes sur chars et lines (>=)", () => {
      const base = { limit_chars: DEFAULT_LIMIT_CHARS, limit_lines: DEFAULT_LIMIT_LINES };
      assert.equal(isFull({ ...base, chars: DEFAULT_LIMIT_CHARS, lines: 0 }), true);
      assert.equal(isFull({ ...base, chars: DEFAULT_LIMIT_CHARS - 1, lines: 0 }), false);
      assert.equal(isFull({ ...base, chars: 0, lines: DEFAULT_LIMIT_LINES }), true);
      assert.equal(isFull({ ...base, chars: 0, lines: DEFAULT_LIMIT_LINES - 1 }), false);
    });

    test("nextSlotId: max existant + 1 (allocation continue)", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      writeEntry({ root, title: "ee ff gg hh", content: "two" });
      assert.equal(nextSlotId(readIndex(root)), "slot-003");
    });
  });
});
