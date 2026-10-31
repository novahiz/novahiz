import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import { addTodos, closeTask, completeTodo, createTask, getTask, listTodos, reviewDue } from "../src/ledger.ts";
import { loadSpec } from "../src/spec.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function fresh(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-contract-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

function evidence(db: ReturnType<typeof openDb>, id: string, ok: boolean): void {
  db.prepare(
    `INSERT INTO evidence (id, session_id, name, command, exit_code, ok, output_tail, hash, duration_ms, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, '', ?, 0, ?)`,
  ).run(id, "tests", "npm test", ok ? 0 : 1, ok ? 1 : 0, "hash", new Date().toISOString());
}

describe("ledger: le contrat de la skill devient celui du tool", () => {
  test("une taille est acceptée et conservée", () => {
    const db = fresh();
    const task = createTask(db, { title: "contrat" });
    const [todo] = addTodos(db, task.id, [{ label: "écrire", kind: "edit", size: "S" }]);
    db.close();
    assert.equal(todo.size, "S");
  });

  test("une taille inconnue est refusée", () => {
    const db = fresh();
    const task = createTask(db, { title: "contrat" });
    assert.throws(
      () => addTodos(db, task.id, [{ label: "x", size: "XXL" as never }]),
      /invalid todo size/,
    );
    db.close();
  });

  test("un edit sans preuve est refusé", () => {
    const db = fresh();
    const task = createTask(db, { title: "preuve" });
    const [todo] = addTodos(db, task.id, [{ label: "modifier", kind: "edit" }]);
    assert.throws(() => completeTodo(db, todo.id, ""), /needs proof/);
    db.close();
  });

  test("un read sans preuve reste acceptable", () => {
    const db = fresh();
    const task = createTask(db, { title: "preuve" });
    const [todo] = addTodos(db, task.id, [{ label: "lire", kind: "read" }]);
    const done = completeTodo(db, todo.id, "");
    db.close();
    assert.equal(done.status, "done");
  });

  test("une preuve libre ferme un edit", () => {
    const db = fresh();
    const task = createTask(db, { title: "preuve" });
    const [todo] = addTodos(db, task.id, [{ label: "modifier", kind: "edit" }]);
    const done = completeTodo(db, todo.id, "npm test → 12 passed");
    db.close();
    assert.equal(done.status, "done");
    assert.equal(done.proof, "npm test → 12 passed");
  });

  test("evidence:<id> d'une preuve réussie est acceptée, d'un échec refusée", () => {
    const db = fresh();
    evidence(db, "ev_ok", true);
    evidence(db, "ev_ko", false);
    const task = createTask(db, { title: "preuve" });
    const [a, b, c] = addTodos(db, task.id, [
      { label: "vérifier ok", kind: "verify" },
      { label: "vérifier ko", kind: "verify" },
      { label: "vérifier inconnu", kind: "verify" },
    ]);
    assert.equal(completeTodo(db, a.id, "evidence:ev_ok").status, "done");
    assert.throws(() => completeTodo(db, b.id, "evidence:ev_ko"), /failed evidence/);
    assert.throws(() => completeTodo(db, c.id, "evidence:ev_missing"), /unknown evidence/);
    db.close();
  });

  test("une tâche ne se ferme plus toute seule quand le dernier todo est fait", () => {
    const db = fresh();
    const task = createTask(db, { title: "fermeture" });
    const [todo] = addTodos(db, task.id, [{ label: "seul", kind: "read" }]);
    completeTodo(db, todo.id, "");
    const after = getTask(db, task.id);
    db.close();
    assert.equal(after?.status, "active", "la tâche doit rester ouverte jusqu'à close");
  });

  test("close refuse avec un todo ouvert, sans preuve, puis accepte", () => {
    const db = fresh();
    const task = createTask(db, { title: "fermeture" });
    const [ab, c] = addTodos(db, task.id, [
      { label: "a", kind: "read" },
      { label: "b", kind: "read" },
    ]);
    assert.throws(() => closeTask(db, task.id, "fait"), /still has 2 open todo/);

    completeTodo(db, ab.id, "");
    completeTodo(db, c.id, "");
    assert.throws(() => closeTask(db, task.id, ""), /needs proof/);

    const closed = closeTask(db, task.id, "vérifié à la main");
    db.close();
    assert.equal(closed.status, "done");
    assert.equal(closed.closing_proof, "vérifié à la main");
  });

  test("close accepte une evidence vérifiée", () => {
    const db = fresh();
    evidence(db, "ev_close", true);
    const task = createTask(db, { title: "fermeture" });
    const todo = addTodos(db, task.id, [{ label: "seul", kind: "read" }])[0];
    completeTodo(db, todo.id, "");
    const closed = closeTask(db, task.id, "evidence:ev_close");
    const count = listTodos(db, task.id).length;
    db.close();
    assert.equal(closed.status, "done");
    assert.equal(count, 1);
  });

  test("la cadence de review ne diverge plus entre spec.ts et ledger.ts", () => {
    const spec = loadSpec(repoRoot);
    assert.equal(spec.config.ledger.review.edits, 10);
    assert.equal(spec.config.ledger.review.todos, 5);

    const db = fresh();
    const task = createTask(db, { title: "cadence" });
    db.prepare("UPDATE tasks SET edits_since_review = 9 WHERE id = ?").run(task.id);
    assert.equal(reviewDue(db, task.id, spec.config.ledger.review).due, false);
    db.prepare("UPDATE tasks SET edits_since_review = 10 WHERE id = ?").run(task.id);
    assert.equal(reviewDue(db, task.id, spec.config.ledger.review).due, true);
    db.close();
  });
});
