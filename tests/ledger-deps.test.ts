import test from "node:test";
import assert from "node:assert/strict";
import { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dbPathFor } from "../src/commands/context.ts";
import { openDb } from "../src/db.ts";
import { loadSpec } from "../src/spec.ts";
import { addTodos, completeTodo, createTask, revisionSignals, startTodo, type TodoInput } from "../src/ledger.ts";

// Regression: label-declared dependencies never unblocked their dependent todo.
//
// `normalizeTodoInput` (src/commands/task.ts) accepts a dependency written either
// as a todo id or as the label a human writes in a plan ("T2", "P5"). Both
// consumers resolved the reference as an id only - startTodo (src/ledger.ts:275)
// and the ready-signal sweep (src/ledger.ts:563). A label therefore looked up
// null, which the guard read as "unfinished", so the todo stayed blocked for the
// whole life of the task with every dependency already done:
//
//   todo X is blocked by unfinished dependencies: T2, T3, T4, T5, T6
//
// observed 2026-10-14 on task_mv82uzkvd5pk14, which stalled its verification step
// on a plan nothing was wrong with. The rows store whatever the plan said, so the
// fix resolves references at read time instead of rewriting the ledger.
//
// A reference that resolves to nothing must keep blocking: the fallback widens
// what unblocks a step, never what a typo can satisfy.

interface Seed {
  taskId: string;
  labels: string[];
  ids: string[];
}

const root = mkdtempSync(join(tmpdir(), "novahiz-ledger-"));
const spec = loadSpec(root);
const db = openDb(dbPathFor(root, spec));

after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** A task holding one todo per label, with the given dependencies attached. */
function seed(labels: string[], dependsOn: Record<string, string[]> = {}): Seed {
  const task = createTask(db, { title: `ledger-deps: ${labels.join("|")}` });
  const items: TodoInput[] = labels.map((label) => ({ label, kind: "edit", dependsOn: dependsOn[label] ?? [] }));
  const rows = addTodos(db, task.id, items);
  return { taskId: task.id, labels, ids: rows.map((row) => row.id) };
}

const idFor = (plan: Seed, label: string): string => {
  const index = plan.labels.indexOf(label);
  assert.ok(index >= 0, `label absent from this test plan: ${label}`);
  return plan.ids[index];
};

test("une dependance ecrite par label debloque une fois la cible faite", () => {
  const rows = seed(["T1: preparer", "T2: verifier"], { "T2: verifier": ["T1"] });

  // The exact failure, reproduced first: T1 is not done yet, so the block is honest.
  assert.throws(() => startTodo(db, idFor(rows, "T2: verifier")), /blocked by unfinished dependencies: T1/);

  completeTodo(db, idFor(rows, "T1: preparer"), "preuve observee");

  assert.equal(startTodo(db, idFor(rows, "T2: verifier")).status, "in_progress");
});

test("une dependance ecrite par identifiant continue de fonctionner", () => {
  const rows = seed(["A: un", "B: deux"]);
  const task = createTask(db, { title: "id-dep-path" });
  const inserted = addTodos(db, task.id, [
    { label: "A: un", kind: "edit" },
    { label: "B: deux", kind: "edit", dependsOn: [rows.ids[0]] }
  ]);

  assert.throws(() => startTodo(db, inserted[1].id), /blocked by unfinished dependencies/);

  completeTodo(db, rows.ids[0], "preuve observee");
  assert.equal(startTodo(db, inserted[1].id).status, "in_progress");
});

test("le signal ready suit aussi les labels", () => {
  const rows = seed(["P1: poser", "P2: livrer"], { "P2: livrer": ["P1"] });
  completeTodo(db, idFor(rows, "P1: poser"), "preuve observee");

  const signals = revisionSignals(db, rows.taskId);
  assert.ok(
    signals.some((signal) => signal.type === "ready" && signal.todo === idFor(rows, "P2: livrer")),
    `expected a ready signal on the label-dependent todo, received: ${JSON.stringify(signals)}`
  );
});

test("une reference inconnue bloque toujours", () => {
  const task = createTask(db, { title: "typo-dep" });
  const rows = addTodos(db, task.id, [{ label: "T2: suite", kind: "edit", dependsOn: ["T9"] }]);
  assert.throws(() => startTodo(db, rows[0].id), /blocked by unfinished dependencies: T9/);
});

test("un label ambigu bloque plutot que choisir au hasard", () => {
  const task = createTask(db, { title: "ambiguous-label" });
  // Two todos share the "T1" prefix, so "T1" cannot name one of them unambiguously.
  const rows = addTodos(db, task.id, [
    { label: "T1: un", kind: "edit" },
    { label: "T1: deux", kind: "edit" },
    { label: "T2: attend", kind: "edit", dependsOn: ["T1"] }
  ]);

  assert.throws(() => startTodo(db, rows[2].id), /blocked by unfinished dependencies: T1/);

  // Completing one of the two must not unblock the dependent todo.
  completeTodo(db, rows[0].id, "preuve observee");
  assert.throws(() => startTodo(db, rows[2].id), /blocked by unfinished dependencies: T1/);

  completeTodo(db, rows[1].id, "preuve observee");
  assert.equal(startTodo(db, rows[2].id).status, "in_progress");
});
