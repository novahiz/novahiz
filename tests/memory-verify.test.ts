import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { readIndex, readSlot, recordSlotVerification, writeEntry } from "../src/memory.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "novahiz-memverify-"));
  made.push(root);
  const memory = join(root, "project-memory");
  mkdirSync(memory, { recursive: true });
  return memory;
}

describe("memory: une entrée peut porter sa vérification", () => {
  test("verify est conservé dans le frontmatter du slot", () => {
    const memory = project();
    const written = writeEntry({
      root: memory,
      title: "RIB encore en placeholder",
      content: "Le RIB réel n'est pas encore fourni.",
      verify: "typecheck",
    });
    const reloaded = readSlot(memory, written.slot);
    assert.equal(reloaded.meta.verify, "typecheck");
    assert.equal(reloaded.raw.includes("verify: typecheck"), true);
  });

  test("recordSlotVerification enregistre le verdict et sa date", () => {
    const memory = project();
    const written = writeEntry({
      root: memory,
      title: "Migration appliquée",
      content: "La migration est passée en base.",
      verify: "tests",
    });
    const at = "2026-10-29T06:30:00.000Z";
    const result = recordSlotVerification(written.slot.id, { root: memory, verdict: "ok", at });

    const reloaded = readSlot(memory, written.slot);
    const index = readIndex(memory);
    const meta = index.slots.find((slot) => slot.id === written.slot.id);
    assert.equal(result.verdict, "ok");
    assert.equal(reloaded.meta.last_verdict, "ok");
    assert.equal(reloaded.meta.last_verified, at);
    assert.equal(meta?.last_verdict, "ok");
  });

  test("un slot sans verify refuse l'enregistrement", () => {
    const memory = project();
    const written = writeEntry({
      root: memory,
      title: "Note libre",
      content: "Aucune assertion vérifiable.",
    });
    assert.throws(
      () => recordSlotVerification(written.slot.id, { root: memory, verdict: "ok" }),
      /ne déclare aucune commande verify/,
    );
  });

  test("changer la commande efface un verdict devenu caduc", () => {
    const memory = project();
    const written = writeEntry({
      root: memory,
      title: "Contrat de vérification",
      content: "Première version.",
      verify: "typecheck",
    });
    recordSlotVerification(written.slot.id, { root: memory, verdict: "ok" });

    writeEntry({
      root: memory,
      title: "Contrat de vérification",
      content: "La commande change de nature.",
      slotId: written.slot.id,
      verify: "tests",
    });

    const reloaded = readSlot(memory, written.slot);
    assert.equal(reloaded.meta.verify, "tests");
    assert.equal(reloaded.meta.last_verdict, undefined);
    assert.equal(reloaded.meta.last_verified, undefined);
  });

  test("l'index relu porte les champs de vérification", () => {
    const memory = project();
    writeEntry({ root: memory, title: "Avec verify", content: "x", verify: "build" });
    const index = readIndex(memory);
    assert.equal(index.slots[0].verify, "build");
  });
});
