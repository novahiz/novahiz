import assert from "node:assert/strict";
import test from "node:test";

import { memoryRootFlag } from "../src/commands/memory.ts";

/**
 * NX-50 : `--dir` est un alias de `--root`.
 *
 * Constaté le 2026-10-31 : `novahiz memory status --dir <projet>` lisait la
 * mémoire canonique et affichait son propre chemin — la commande semblait
 * avoir répondu sur le dossier demandé.
 */

test("--root est retenu", () => {
  assert.equal(memoryRootFlag({ root: "C:/projet" }), "C:/projet");
});

test("--dir seul fonctionne", () => {
  assert.equal(memoryRootFlag({ dir: "C:/projet/project-memory" }), "C:/projet/project-memory");
});

test("--root gagne quand les deux sont donnés", () => {
  assert.equal(memoryRootFlag({ root: "C:/a", dir: "C:/b" }), "C:/a");
});

test("aucun des deux : indéfini", () => {
  assert.equal(memoryRootFlag({}), undefined);
  assert.equal(memoryRootFlag({ root: "", dir: "" }), undefined);
});

test("une valeur non textuelle est ignorée", () => {
  assert.equal(memoryRootFlag({ root: 42, dir: true }), undefined);
});
