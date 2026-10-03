// S3: lifecycle ecriture — memory_update, memory_archive (jamais de delete
// dur), dedup par hash, lignee previous a la rotation, Resume borne.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_SUMMARY_CHARS,
  archiveSlot,
  getSlot,
  readIndex,
  rebuildIndex,
  updateSlot,
  writeEntry
} from "../src/memory.ts";
import type { MemoryError } from "../src/memory.ts";

const errCode = (error: unknown): string => (error as MemoryError).code;

const throwsCode = (fn: () => unknown, code: string): void => {
  assert.throws(fn, (error: unknown) => errCode(error) === code);
};

describe("memory.ts - S3 lifecycle (update, archive, dedup, lignee)", () => {
  const roots: string[] = [];

  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-s3-"));
    roots.push(root);
    return root;
  };

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    }
  });

  describe("updateSlot", () => {
    test("mode replace: les Details deviennent exactement le contenu", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "original" });
      const result = updateSlot({ id: "slot-001", root, mode: "replace", content: "remplace" });
      assert.equal(result.updated, true);
      assert.equal(result.slot.id, "slot-001");
      assert.equal(getSlot("slot-001", root).body.details, "remplace");
    });

    test("mode append: le contenu s'ajoute en bloc separe", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "original" });
      updateSlot({ id: "slot-001", root, mode: "append", content: "ajout" });
      const details = getSlot("slot-001", root).body.details;
      assert.match(details, /original/);
      assert.match(details, /ajout/);
      assert.equal(details.split(/\n{2,}/).length, 2);
    });

    test("mode summary: reecrit le Resume, borne a MAX_SUMMARY_CHARS", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "x" });
      updateSlot({ id: "slot-001", root, mode: "summary", summary: "resume court" });
      assert.equal(getSlot("slot-001", root).body.summary, "resume court");
      throwsCode(
        () =>
          updateSlot({
            id: "slot-001",
            root,
            mode: "summary",
            summary: "z".repeat(MAX_SUMMARY_CHARS + 1)
          }),
        "E_CONTENT"
      );
      throwsCode(
        () => updateSlot({ id: "slot-001", root, mode: "summary", summary: "   " }),
        "E_CONTENT"
      );
    });

    test("validations: id inconnu E_SLOT, archive E_SLOT, mode inconnu E_CONTENT, contenu vide E_CONTENT", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "x" });
      throwsCode(
        () => updateSlot({ id: "slot-999", root, mode: "replace", content: "y" }),
        "E_SLOT"
      );
      throwsCode(
        () => updateSlot({ id: "nope/../x", root, mode: "replace", content: "y" }),
        "E_SLOT_ID"
      );
      throwsCode(
        () =>
          updateSlot({
            id: "slot-001",
            root,
            mode: "bogus" as unknown as "replace",
            content: "y"
          }),
        "E_CONTENT"
      );
      throwsCode(
        () => updateSlot({ id: "slot-001", root, mode: "replace", content: "  " }),
        "E_CONTENT"
      );
      archiveSlot("slot-001", root);
      throwsCode(
        () => updateSlot({ id: "slot-001", root, mode: "replace", content: "y" }),
        "E_SLOT"
      );
    });

    test("replace pluri-ligne plein: compactage borne sans rotation", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "x" });
      const big = Array.from(
        { length: 10 },
        (_, index) => `Ligne ${index} ` + "y".repeat(890)
      ).join("\n");
      const result = updateSlot({ id: "slot-001", root, mode: "replace", content: big });
      assert.equal(result.compacted, true);
      assert.equal(result.slot.id, "slot-001");
      const slot = getSlot("slot-001", root);
      assert.equal(slot.meta.status, "active");
      assert.equal(slot.body.details.split(/\r?\n/).length, 4);
      assert.ok(slot.body.summary.length <= MAX_SUMMARY_CHARS);
      assert.equal(readIndex(root).slots.length, 1, "update ne doit jamais creer de slot");
    });
  });

  describe("archiveSlot (aucune suppression)", () => {
    test("archive: statut change, fichier markdown INTACT sur disque", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "contenu a garder" });
      const result = archiveSlot("slot-001", root);
      assert.equal(result.archived, true);
      assert.equal(result.changed, true);
      assert.equal(result.slot.status, "archived");
      const meta = readIndex(root).slots.find((slot) => slot.id === "slot-001");
      assert.equal(meta?.status, "archived");
      const file = meta?.file as string;
      assert.ok(existsSync(join(root, file)), "le fichier doit survivre a l'archive");
      assert.match(readFileSync(join(root, file), "utf8"), /contenu a garder/);
    });

    test("idempotent: deuxieme archive -> changed false, aucune erreur", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "x" });
      archiveSlot("slot-001", root);
      const second = archiveSlot("slot-001", root);
      assert.equal(second.changed, false);
      assert.equal(second.slot.status, "archived");
    });

    test("id inconnu -> E_SLOT", () => {
      const root = makeRoot();
      ensureRootForTest(root);
      throwsCode(() => archiveSlot("slot-404", root), "E_SLOT");
    });

    test("slot archive sort du routage: une ecriture liee cree un nouveau slot", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma delta", content: "un" });
      archiveSlot("slot-001", root);
      const next = writeEntry({ root, title: "alpha beta gamma delta", content: "deux" });
      assert.equal(next.slot.id, "slot-002");
      assert.equal(next.created, true);
      assert.equal(getSlot("slot-001", root).meta.status, "archived");
      assert.match(getSlot("slot-002", root).body.details, /deux/);
    });
  });

  describe("dedup par hash (writeEntry)", () => {
    test("contenu identique -> duplicate true, un seul bloc", () => {
      const root = makeRoot();
      const first = writeEntry({ root, title: "alpha beta gamma", content: "fait stable" });
      assert.equal(first.duplicate, undefined);
      const second = writeEntry({ root, title: "alpha beta gamma", content: "fait stable" });
      assert.equal(second.duplicate, true);
      assert.equal(second.created, false);
      const details = getSlot("slot-001", root).body.details;
      assert.equal(details.split(/\n{2,}/).length, 1);
    });

    test("contenu different -> pas de duplicate, blocs cumules", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "fait un" });
      const other = writeEntry({ root, title: "alpha beta gamma", content: "fait deux" });
      assert.notEqual(other.duplicate, true);
      assert.equal(getSlot("slot-001", root).body.details.split(/\n{2,}/).length, 2);
    });

    test("whitespace variation du meme bloc -> meme hash -> duplicate", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma", content: "fait stable" });
      const spaced = writeEntry({
        root,
        title: "alpha beta gamma",
        content: "\n  fait stable  \n"
      });
      assert.equal(spaced.duplicate, true);
    });
  });

  describe("lignee previous a la rotation", () => {
    test("rotation: le slot neuf porte previous: parent archive (fichier + index)", () => {
      const root = makeRoot();
      writeEntry({ root, title: "slot gros sujet", content: "x".repeat(9000) });
      const next = getSlot("slot-002", root);
      assert.equal(next.meta.previous, "slot-001");
      const indexMeta = readIndex(root).slots.find((slot) => slot.id === "slot-002");
      assert.equal(indexMeta?.previous, "slot-001");
      const raw = readFileSync(
        join(root, readIndex(root).slots.find((slot) => slot.id === "slot-002")?.file as string),
        "utf8"
      );
      assert.match(raw, /^previous: slot-001$/m);
      // le slot d'origine n'avait aucun parent: pas de ligne previous
      const first = readFileSync(
        join(root, readIndex(root).slots.find((slot) => slot.id === "slot-001")?.file as string),
        "utf8"
      );
      assert.equal(/^previous:/m.test(first), false);
    });

    test("rotation double: chaine slot-003 -> slot-002 -> slot-001", () => {
      const root = makeRoot();
      writeEntry({ root, title: "slot gros sujet", content: "x".repeat(9000) });
      writeEntry({ root, title: "slot gros sujet", content: "petit apport" });
      assert.equal(getSlot("slot-002", root).meta.previous, "slot-001");
      assert.equal(getSlot("slot-003", root).meta.previous, "slot-002");
      const statuses = new Map(readIndex(root).slots.map((slot) => [slot.id, slot.status]));
      assert.equal(statuses.get("slot-001"), "archived");
      assert.equal(statuses.get("slot-002"), "archived");
      assert.equal(statuses.get("slot-003"), "active");
    });

    test("rebuild: la lignee previous survit a la reconstruction de l'index", () => {
      const root = makeRoot();
      writeEntry({ root, title: "slot gros sujet", content: "x".repeat(9000) });
      writeEntry({ root, title: "slot gros sujet", content: "petit apport" });
      const rebuilt = rebuildIndex(root);
      assert.equal(rebuilt.slots.find((slot) => slot.id === "slot-002")?.previous, "slot-001");
      assert.equal(rebuilt.slots.find((slot) => slot.id === "slot-003")?.previous, "slot-002");
      assert.equal(rebuilt.slots.find((slot) => slot.id === "slot-001")?.previous, undefined);
    });
  });
});

// Les validations d'identifiant partent avant toute lecture: on cree juste la
// racine pour que le reste du test mesure le E_SLOT et non un accident disque.
function ensureRootForTest(root: string): void {
  writeEntry({ root, title: "alpha beta gamma", content: "x" });
}
