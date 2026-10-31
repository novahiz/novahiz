import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { openDb } from "../src/db.ts";
import { addTodos, createTask, listTodos, reviewTask } from "../src/ledger.ts";

/**
 * NX-14 : un plan diff arrive avec un ordre calculé avant l'ajout.
 * L'ordre ne contient donc pas les todos que la revue vient de créer.
 */

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function base(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-review-order-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

function tacheAvecTrois(): { db: ReturnType<typeof openDb>; taskId: string; ids: string[] } {
  const db = base();
  const task = createTask(db, { title: "revue", category: "code", projectRoot: "C:/tmp/projet" });
  const ids = addTodos(db, task.id, [
    { label: "a", kind: "read" },
    { label: "b", kind: "read" },
    { label: "c", kind: "read" },
  ]).map((todo) => todo.id);
  return { db, taskId: task.id, ids };
}

test("une revue avec ajout et ordre d'avant l'ajout n'échoue plus", () => {
  const { db, taskId, ids } = tacheAvecTrois();

  const resultat = reviewTask(db, {
    taskId,
    additions: [{ label: "d", kind: "read" }],
    order: ids,
  });

  const labels = listTodos(db, taskId).map((todo) => todo.label);
  assert.deepEqual(labels, ["a", "b", "c", "d"]);
  assert.equal(resultat.applied.reordered, true);
  db.close();
});

test("un ordre complet reste appliqué tel quel", () => {
  const { db, taskId, ids } = tacheAvecTrois();

  reviewTask(db, { taskId, order: [ids[2], ids[0], ids[1]] });

  const labels = listTodos(db, taskId).map((todo) => todo.label);
  assert.deepEqual(labels, ["c", "a", "b"]);
  db.close();
});

test("un identifiant étranger dans l'ordre reste refusé", () => {
  const { db, taskId, ids } = tacheAvecTrois();

  assert.throws(
    () => reviewTask(db, { taskId, order: [...ids, "todo_inconnu"] }),
    /review order targets todos outside this task/,
  );
  db.close();
});

test("l'ordre demandé garde la priorité sur l'ajout", () => {
  const { db, taskId, ids } = tacheAvecTrois();

  reviewTask(db, { taskId, additions: [{ label: "d", kind: "read" }], order: [ids[1], ids[0], ids[2]] });

  const labels = listTodos(db, taskId).map((todo) => todo.label);
  assert.deepEqual(labels, ["b", "a", "c", "d"]);
  db.close();
});
