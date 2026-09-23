import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { openDb } from "../src/db.ts";
import {
  activeTask,
  addTodos,
  amendTodo,
  blockTodo,
  buildWorkPackets,
  completeTodo,
  createTask,
  DEFAULT_MAX_ITERATIONS,
  dropTask,
  dropTodo,
  getTask,
  insertTodo,
  ledgerSummary,
  listTodos,
  ownedBy,
  recordEdit,
  recordTodoDone,
  reorderTodos,
  resume,
  reviewBlockReason,
  reviewDue,
  reviewTask,
  revisionSignals,
  startTodo,
  traceCheck
} from "../src/ledger.ts";

const dbPath = join(tmpdir(), `novahiz-ledger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.sqlite`);
const db = openDb(dbPath);
let counter = 0;

function makeTask(title: string) {
  counter += 1;
  const id = `t_${Date.now().toString(36)}_${counter}`;
  return createTask(db, { title, id, sessionId: `s_${id}` });
}

after(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      // best effort cleanup
    }
  }
});

test("creates a task and finds it as active", () => {
  const task = makeTask("Ship the ledger");
  assert.equal(task.status, "active");
  assert.equal(task.title, "Ship the ledger");
  assert.equal(getTask(db, task.id)?.id, task.id);
  assert.equal(activeTask(db, task.session_id as string)?.id, task.id);
});

test("adds todos with sequence numbers and defaults", () => {
  const task = makeTask("Plan work");
  const created = addTodos(db, task.id, [
    { label: "read the code", kind: "read" },
    { label: "edit the file", kind: "edit", owner: "src/**" },
    { label: "verify", kind: "verify", acceptance: "tests pass" }
  ]);
  assert.deepEqual(created.map((todo) => todo.seq), [1, 2, 3]);
  assert.equal(created[0].status, "pending");
  assert.equal(created[0].iterations, 0);
  assert.equal(created[0].max_iterations, DEFAULT_MAX_ITERATIONS);
  assert.equal(listTodos(db, task.id).length, 3);
});

test("refuses to add todos to an unknown task", () => {
  assert.throws(() => addTodos(db, "does-not-exist", [{ label: "x" }]), /unknown task/);
});

test("starts a todo, counts iterations, honors dependencies", () => {
  const task = makeTask("Dependencies");
  const [first, second] = addTodos(db, task.id, [
    { label: "first", kind: "read" },
    { label: "second", kind: "edit" }
  ]);
  db.prepare("UPDATE todos SET depends_on = ? WHERE id = ?").run(JSON.stringify([first.id]), second.id);
  assert.throws(() => startTodo(db, second.id), /unfinished dependencies/);
  const started = startTodo(db, first.id);
  assert.equal(started.status, "in_progress");
  assert.equal(started.iterations, 1);
  completeTodo(db, first.id, "read done");
  const unblocked = startTodo(db, second.id);
  assert.equal(unblocked.status, "in_progress");
});

test("enforces the iteration budget", () => {
  const task = makeTask("Budget");
  const [todo] = addTodos(db, task.id, [{ label: "loop", kind: "edit", maxIterations: 1 }]);
  startTodo(db, todo.id);
  assert.throws(() => startTodo(db, todo.id), /iteration budget/);
});

test("requires proof for verify steps", () => {
  const task = makeTask("Proof");
  const [todo] = addTodos(db, task.id, [{ label: "verify", kind: "verify" }]);
  assert.throws(() => completeTodo(db, todo.id), /needs proof/);
  const done = completeTodo(db, todo.id, "node --test 119 pass");
  assert.equal(done.status, "done");
  assert.equal(done.proof, "node --test 119 pass");
});

test("completes the task when every todo is done", () => {
  const task = makeTask("Finish");
  const [a, b] = addTodos(db, task.id, [{ label: "a" }, { label: "b", kind: "verify" }]);
  completeTodo(db, a.id, "ok");
  completeTodo(db, b.id, "tested");
  assert.equal(getTask(db, task.id)?.status, "done");
});

test("blocks a todo with a reason", () => {
  const task = makeTask("Blocked");
  const [todo] = addTodos(db, task.id, [{ label: "stuck" }]);
  const blocked = blockTodo(db, todo.id, "waiting on upstream");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.proof, "waiting on upstream");
});

test("resume prefers the in-progress todo then the next pending", () => {
  const task = makeTask("Resume");
  const session = task.session_id as string;
  const [first, second] = addTodos(db, task.id, [{ label: "first" }, { label: "second" }]);
  assert.equal(resume(db, session).current?.id, first.id);
  startTodo(db, second.id);
  assert.equal(resume(db, session).current?.id, second.id);
});

test("ownedBy matches glob owners and blank owners own everything", () => {
  const task = makeTask("Owners");
  const [any, globbed] = addTodos(db, task.id, [
    { label: "any" },
    { label: "globbed", owner: "src/**/*.ts" }
  ]);
  assert.equal(ownedBy(any, "anything/here.md"), true);
  assert.equal(ownedBy(globbed, "src/lib/app.ts"), true);
  assert.equal(ownedBy(globbed, "docs/readme.md"), false);
});

test("traceCheck requires an in-progress todo that owns the file", () => {
  const task = makeTask("Trace");
  const session = task.session_id as string;
  assert.equal(traceCheck(db, { filePath: "src/app.ts", required: false }).ok, true);
  const none = traceCheck(db, { sessionId: session, filePath: "src/app.ts", required: true });
  assert.equal(none.ok, false);
  assert.match(none.reason, /no todo is in progress/);
  const [todo] = addTodos(db, task.id, [{ label: "edit app", owner: "src/**/*.ts" }]);
  startTodo(db, todo.id);
  const ok = traceCheck(db, { sessionId: session, filePath: "src/app.ts", required: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.todo?.id, todo.id);
  const wrong = traceCheck(db, { sessionId: session, filePath: "docs/readme.md", required: true });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /no in-progress todo owns/);
});

test("builds work packets with files and budget", () => {
  const task = makeTask("Packets");
  addTodos(db, task.id, [
    { label: "read", kind: "read" },
    { label: "edit", kind: "edit", owner: "src/a.ts, src/b.ts" }
  ]);
  const packets = buildWorkPackets(db, task.id);
  assert.equal(packets.length, 2);
  assert.deepEqual(packets[1].files, ["src/a.ts", "src/b.ts"]);
  assert.equal(packets[1].budget, DEFAULT_MAX_ITERATIONS);
  assert.deepEqual(packets[0].dependsOn, []);
});

test("summarizes the ledger", () => {
  const task = makeTask("Summary");
  const [a, b] = addTodos(db, task.id, [{ label: "first" }, { label: "verify", kind: "verify" }]);
  completeTodo(db, a.id, "done");
  startTodo(db, b.id);
  const lines = ledgerSummary(resume(db, task.session_id as string));
  assert.match(lines[0], /\(1\/2 done\)/);
  assert.ok(lines.some((line) => line.includes("[x] 1. first | proof: done")));
  assert.ok(lines.some((line) => line.includes("next: verify")));
});

test("amends a todo in place", () => {
  const task = makeTask("Amend");
  const [todo] = addTodos(db, task.id, [{ label: "old" }]);
  const amended = amendTodo(db, todo.id, { label: "new", kind: "verify", acceptance: "tests pass" });
  assert.equal(amended.label, "new");
  assert.equal(amended.kind, "verify");
  assert.equal(amended.acceptance, "tests pass");
});

test("inserts a todo at a position", () => {
  const task = makeTask("Insert");
  addTodos(db, task.id, [{ label: "a" }, { label: "b" }]);
  const inserted = insertTodo(db, task.id, { label: "first" }, "start");
  const ids = listTodos(db, task.id).map((entry) => entry.id);
  assert.equal(ids.length, 3);
  assert.equal(ids[0], inserted.id);
});

test("drops a todo without blocking task completion", () => {
  const task = makeTask("Drop");
  const [a, b] = addTodos(db, task.id, [{ label: "keep" }, { label: "drop me" }]);
  completeTodo(db, a.id, "done");
  const dropped = dropTodo(db, b.id, "not needed");
  assert.equal(dropped.status, "dropped");
  assert.equal(getTask(db, task.id)?.status, "done");
});

test("refuses to abandon an active task without a reason", () => {
  const task = makeTask("Active drop guard");
  addTodos(db, task.id, [{ label: "open work" }]);
  assert.throws(() => dropTask(db, task.id), /without a reason/);
  assert.equal(getTask(db, task.id)?.status, "active");
});

test("abandons an active task with a reason and drops open todos", () => {
  const task = makeTask("Abandon me");
  const [open, finished] = addTodos(db, task.id, [
    { label: "open", kind: "edit" },
    { label: "done already", kind: "read" }
  ]);
  completeTodo(db, finished.id, "ok");
  const abandoned = dropTask(db, task.id, "superseded by cleanup");
  assert.equal(abandoned.status, "abandoned");
  const todos = listTodos(db, task.id);
  assert.equal(todos.find((todo) => todo.id === open.id)?.status, "dropped");
  assert.equal(todos.find((todo) => todo.id === finished.id)?.status, "done");
  assert.throws(() => dropTask(db, "missing-task"), /task not found/);
});

test("reopens a completed task when work is added to it", () => {
  const task = makeTask("Reopen");
  const [only] = addTodos(db, task.id, [{ label: "only" }]);
  completeTodo(db, only.id, "done");
  assert.equal(getTask(db, task.id)?.status, "done");
  addTodos(db, task.id, [{ label: "more" }]);
  assert.equal(getTask(db, task.id)?.status, "active");
});

test("reorders todos and rejects a partial list", () => {
  const task = makeTask("Reorder");
  const [a, b] = addTodos(db, task.id, [{ label: "a" }, { label: "b" }]);
  const ordered = reorderTodos(db, task.id, [b.id, a.id]);
  assert.deepEqual(ordered.map((entry) => entry.id), [b.id, a.id]);
  assert.throws(() => reorderTodos(db, task.id, [a.id]));
});

test("flags a plan review when the edit cadence is exceeded", () => {
  const task = makeTask("Edit cadence");
  assert.equal(reviewDue(db, task.id).due, false);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  assert.equal(reviewDue(db, task.id).due, true);
});

test("blocks only paths owned by an open todo when review is due", () => {
  const task = makeTask("Targeted review");
  const [owned] = addTodos(db, task.id, [{ label: "owned work", owner: "src/commands/gate.ts" }]);
  const [unowned] = addTodos(db, task.id, [{ label: "unowned work" }]);
  assert.equal(owned.owner, "src/commands/gate.ts");
  assert.equal(unowned.owner, null);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  assert.equal(reviewDue(db, task.id).due, true);
  const linked = reviewBlockReason(db, task.id, "src/commands/gate.ts");
  assert.ok(linked && linked.includes("plan review due"));
  assert.equal(reviewBlockReason(db, task.id, "README.md"), null);
  assert.equal(reviewBlockReason(db, task.id, "dist/bundle.js"), null);
  completeTodo(db, owned.id, "done");
  completeTodo(db, unowned.id, "done");
  reviewTask(db, { taskId: task.id, additions: [], amendments: [] });
  assert.equal(reviewDue(db, task.id).due, false);
  assert.equal(reviewBlockReason(db, task.id, "src/commands/gate.ts"), null);
});

test("does not block any path when review is due but no open todo has an owner", () => {
  const task = makeTask("Due without owners");
  addTodos(db, task.id, [{ label: "no owner" }]);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  assert.equal(reviewDue(db, task.id).due, true);
  assert.equal(reviewBlockReason(db, task.id, "src/anything.ts"), null);
  assert.equal(reviewBlockReason(db, task.id, "README.md"), null);
});

test("counts finished todos toward the review cadence", () => {
  const task = makeTask("Todo cadence");
  recordTodoDone(db, task.id);
  assert.equal(reviewDue(db, task.id).due, false);
  recordTodoDone(db, task.id);
  assert.equal(reviewDue(db, task.id).due, true);
});

test("applies a review diff and resets the cadence", () => {
  const task = makeTask("Review diff");
  const [a] = addTodos(db, task.id, [{ label: "a" }]);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  recordEdit(db, task.id);
  const outcome = reviewTask(db, {
    taskId: task.id,
    additions: [{ label: "new step" }],
    amendments: [{ id: a.id, label: "renamed" }]
  });
  assert.equal(outcome.revision, 1);
  assert.equal(outcome.applied.additions, 1);
  assert.equal(outcome.applied.amendments, 1);
  assert.equal(reviewDue(db, task.id).due, false);
  assert.equal(getTask(db, task.id)?.revision, 1);
});

test("surfaces revision signals", () => {
  const task = makeTask("Signals");
  addTodos(db, task.id, [{ label: "edit without criteria", kind: "edit" }]);
  const types = revisionSignals(db, task.id).map((signal) => signal.type);
  assert.ok(types.includes("missing_acceptance"));
  assert.ok(types.includes("unowned"));
});
