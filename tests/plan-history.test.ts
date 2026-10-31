import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import {
  addTodos,
  amendTodo,
  closeTask,
  completeTodo,
  createTask,
  dropTask,
  dropTodo,
  insertTodo,
  planHistory,
  reorderTodos,
  reviewTask,
} from "../src/ledger.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function fresh(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-history-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

describe("plan_history: chaque mutation laisse une trace", () => {
  test("add, amend, drop et reorder sont journalisés avec avant/après", () => {
    const db = fresh();
    const task = createTask(db, { title: "journal" });
    const [a, b] = addTodos(db, task.id, [
      { label: "un", kind: "read", size: "S" },
      { label: "deux", kind: "read" },
    ]);

    amendTodo(db, a.id, { label: "un bis", size: "M" });
    dropTodo(db, b.id, "hors périmètre");
    reorderTodos(db, task.id, [b.id, a.id]);

    const actions = planHistory(db, task.id, 50).map((row) => row.action);
    db.close();

    assert.deepEqual(actions, ["reorder", "drop", "amend", "add", "add"]);
  });

  test("amend conserve l'état avant et après", () => {
    const db = fresh();
    const task = createTask(db, { title: "journal" });
    const [todo] = addTodos(db, task.id, [{ label: "avant", kind: "read" }]);
    amendTodo(db, todo.id, { label: "après", size: "L" });

    const amend = planHistory(db, task.id, 10).find((row) => row.action === "amend");
    db.close();

    assert.ok(amend);
    const before = JSON.parse(String(amend!.before_json));
    const after = JSON.parse(String(amend!.after_json));
    assert.equal(before.label, "avant");
    assert.equal(after.label, "après");
    assert.equal(after.size, "L");
  });

  test("insert est journalisé une seule fois (pas de doublon add)", () => {
    const db = fresh();
    const task = createTask(db, { title: "journal" });
    addTodos(db, task.id, [{ label: "base", kind: "read" }]);
    insertTodo(db, task.id, { label: "inséré", kind: "read" });

    const actions = planHistory(db, task.id, 50).map((row) => row.action);
    db.close();
    assert.equal(actions.filter((action) => action === "insert").length, 1);
    assert.equal(actions.filter((action) => action === "add").length, 1);
  });

  test("drop garde sa raison", () => {
    const db = fresh();
    const task = createTask(db, { title: "journal" });
    const [todo] = addTodos(db, task.id, [{ label: "à jeter", kind: "read" }]);
    dropTodo(db, todo.id, "doublon");

    const drop = planHistory(db, task.id, 10).find((row) => row.action === "drop");
    db.close();
    assert.equal(drop?.reason, "doublon");
    assert.equal(drop?.target, todo.id);
  });

  test("review, close et abandon sont journalisés", () => {
    const db = fresh();
    const task = createTask(db, { title: "journal" });
    const [todo] = addTodos(db, task.id, [{ label: "seul", kind: "read" }]);
    reviewTask(db, { taskId: task.id, additions: [{ label: "ajout après revue", kind: "read" }] });
    completeTodo(db, todo.id, "");

    const added = db
      .prepare("SELECT id FROM todos WHERE task_id = ? AND status = 'pending'")
      .all(task.id) as { id: string }[];
    for (const row of added) completeTodo(db, row.id, "");
    closeTask(db, task.id, "vérifié");

    const other = createTask(db, { title: "abandon" });
    dropTask(db, other.id, "remplacée");

    const actions = planHistory(db, task.id, 50).map((row) => row.action);
    const otherActions = planHistory(db, other.id, 50).map((row) => row.action);
    db.close();

    assert.ok(actions.includes("review"));
    assert.ok(actions.includes("close"));
    assert.deepEqual(otherActions, ["abandon"]);
  });

  test("l'historique est borné et trié du plus récent au plus ancien", () => {
    const db = fresh();
    const task = createTask(db, { title: "journal" });
    for (let i = 0; i < 8; i += 1) {
      addTodos(db, task.id, [{ label: `t${i}`, kind: "read" }]);
    }
    const all = planHistory(db, task.id, 100);
    const limited = planHistory(db, task.id, 3);
    db.close();

    assert.equal(all.length, 8);
    assert.equal(limited.length, 3);
    assert.ok(limited[0].id > limited[2].id);
  });
});
