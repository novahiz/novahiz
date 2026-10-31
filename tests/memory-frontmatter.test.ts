import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { readSlot, slotMetadataDrift, writeEntry } from "../src/memory.ts";

/**
 * NX-29 : une valeur de frontmatter ne peut pas injecter de clé.
 * NX-28 : l'index et le frontmatter sont comparés, et la divergence est dite.
 */

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function racine(): string {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-mem-fm-"));
  made.push(dir);
  return dir;
}

test("un titre avec saut de ligne n'injecte pas de clé dans le frontmatter", () => {
  const root = racine();
  const result = writeEntry({
    root,
    title: "Compte rendu\nstatus: archived",
    description: "Une description",
    content: "Un contenu utile pour le slot.",
    tags: ["probe"],
  });

  const file = readSlot(root, result.slot);
  assert.equal(file.meta.status, "active");
  assert.match(file.meta.title, /^Compte rendu status: archived$/);
});

test("un titre fait de trois tirets ne ferme pas le bloc", () => {
  const root = racine();
  const result = writeEntry({
    root,
    title: "---",
    description: "Une description",
    content: "Un contenu utile pour le slot.",
  });

  const file = readSlot(root, result.slot);
  assert.equal(file.meta.title, "---");
  assert.equal(file.meta.status, "active");
});

test("un titre contenant un deux-points revient intact", () => {
  const root = racine();
  const result = writeEntry({
    root,
    title: "Décision : garder le rail replié",
    description: "Une description",
    content: "Un contenu utile pour le slot.",
  });

  const file = readSlot(root, result.slot);
  assert.equal(file.meta.title, "Décision : garder le rail replié");
});

test("un index cohérent ne signale aucune divergence", () => {
  const root = racine();
  writeEntry({
    root,
    title: "Slot cohérent",
    description: "Une description",
    content: "Un contenu utile pour le slot.",
  });

  assert.deepEqual(slotMetadataDrift(root), []);
});

test("un frontmatter édité à la main est signalé", () => {
  const root = racine();
  const result = writeEntry({
    root,
    title: "Titre d'origine",
    description: "Une description",
    content: "Un contenu utile pour le slot.",
  });

  const chemin = join(root, result.slot.file);
  const original = readFileSync(chemin, "utf8");
  writeFileSync(chemin, original.replace(/^title: .*$/m, "title: Titre modifié à la main"), "utf8");

  const drift = slotMetadataDrift(root);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].id, result.slot.id);
  assert.ok(drift[0].issues.some((issue) => issue.startsWith("title")));
});
