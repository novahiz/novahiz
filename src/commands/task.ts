import { join } from "node:path";
import { asString, dbPathFor, numberFlag, parse, print, readStdin, splitList, type Parsed } from "./context.ts";
import { loadSpec, novahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import { activeTask, addTodos, amendTodo, blockTodo, completeTodo, createTask, dropTodo, getTask, getTodo, insertTodo, ledgerSummary, recordTodoDone, reorderTodos, resume, reviewDue, reviewTask, revisionSignals, startTodo, type ReviewDiff, type TodoAmendment, type TodoInput, type TodoKind } from "../ledger.ts";

export function normalizeTodoInput(item: unknown): TodoInput {
  const record = (item ?? {}) as Record<string, unknown>;
  const owners = Array.isArray(record.owner)
    ? record.owner.map(String)
    : typeof record.owner === "string"
      ? record.owner.split(",").map((part) => part.trim()).filter(Boolean)
      : [];
  const dependsRaw = record.dependsOn ?? record.depends_on;
  const dependsOn = Array.isArray(dependsRaw) ? dependsRaw.map(String) : [];
  const maxIterations = Number(record.maxIterations ?? record.max_iterations);
  return {
    label: String(record.label ?? record.title ?? "").trim(),
    kind: (record.kind ? String(record.kind) : "edit") as TodoKind,
    acceptance: record.acceptance ? String(record.acceptance) : undefined,
    owner: owners.length > 0 ? owners.join(",") : undefined,
    dependsOn,
    maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : undefined
  };
}

export function commandTask(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const action = parsed.positionals[1] ?? "status";
  const session = asString(parsed.flags.session);
  const db = openDb(dbPathFor(root, spec));
  try {
    if (action === "new") return taskNew(parsed, db, session, spec);

    if (action === "plan") return taskPlan(parsed, db, session, spec);

    if (action === "todo") return taskTodo(parsed, db, session, spec);

    const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
    if (action === "start") return taskStart(parsed, db, session, spec);
    if (action === "done") return taskDone(parsed, db, session, spec);
    if (action === "block") return taskBlock(parsed, db, session, spec);

    if (action === "signals") return taskSignals(parsed, db, session, spec);

    if (action === "review") return taskReview(parsed, db, session, spec);

    if (action === "amend") return taskAmend(parsed, db, session, spec);

    if (action === "insert") return taskInsert(parsed, db, session, spec);

    if (action === "drop") return taskDrop(parsed, db, session, spec);

    if (action === "reorder") return taskReorder(parsed, db, session, spec);

    if (action === "read") return taskRead(parsed, db, session, spec);

    print({ error: `unknown task action: ${action}`, actions: ["new", "plan", "todo", "start", "done", "block", "review", "amend", "insert", "drop", "reorder", "signals", "status", "resume", "current"] });
    process.exitCode = 1;
  } catch (error) {
    print({ error: String((error as Error)?.message ?? error) });
    process.exitCode = 1;
  } finally {
    db.close();
  }

}

function taskRead(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  const state = resume(db, session || undefined);
  const summary = ledgerSummary(state);
  let review = null as ReturnType<typeof reviewDue> | null;
  const signals = state.task ? revisionSignals(db, state.task.id) : [];
  if (state.task && spec.config.ledger?.enabled !== false) {
    review = reviewDue(db, state.task.id, spec.config.ledger.review);
    summary.push(
      `  review: ${review.due ? "DUE" : "ok"} (edits ${review.edits}/${review.policy.edits}, todos ${review.todos}/${review.policy.todos})`
    );
    if (review.due) summary.push(`  -> reconcile with: novahiz task review --task ${state.task.id} --reason "<what changed>"`);
    for (const signal of signals) summary.push(`  signal ${signal.type}: ${signal.detail}`);
  }
  print({ ...state, summary, review, signals });
  return;
    }

function taskReorder(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
  if (!taskId) {
    print({ error: "task reorder requires --task or an active task" });
    process.exitCode = 1;
    return;
  }
  const requested = splitList(parsed.flags.order);
  const order = requested.length > 0 ? requested : parsed.positionals.slice(2);
  print({ task: getTask(db, taskId), todos: reorderTodos(db, taskId, order) });
  return;
    }

function taskDrop(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  if (!id) {
    print({ error: "task drop requires --id" });
    process.exitCode = 1;
    return;
  }
  print({ todo: dropTodo(db, id, asString(parsed.flags.reason)) });
  return;
    }

function taskInsert(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
  if (!taskId) {
    print({ error: "task insert requires --task or an active task" });
    process.exitCode = 1;
    return;
  }
  const label = (asString(parsed.flags.label) || parsed.positionals.slice(2).join(" ")).trim();
  if (!label) {
    print({ error: "task insert requires --label" });
    process.exitCode = 1;
    return;
  }
  const item = normalizeTodoInput({
    label,
    kind: asString(parsed.flags.kind) || "edit",
    acceptance: asString(parsed.flags.acceptance) || undefined,
    owner: splitList(parsed.flags.owner),
    maxIterations: numberFlag(parsed, "max-iterations") || undefined
  });
  const positionRaw = asString(parsed.flags.position);
  const position = positionRaw === "" ? "end" : /^\d+$/.test(positionRaw) ? Number(positionRaw) : (positionRaw as "start" | "end");
  print({ todo: insertTodo(db, taskId, item, position), task: getTask(db, taskId) });
  return;
    }

function taskAmend(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  if (!id) {
    print({ error: "task amend requires --id" });
    process.exitCode = 1;
    return;
  }
  const patch: TodoAmendment = {};
  const label = asString(parsed.flags.label);
  if (label) patch.label = label;
  const kind = asString(parsed.flags.kind);
  if (kind) patch.kind = kind as TodoKind;
  if (parsed.flags.acceptance !== undefined) patch.acceptance = asString(parsed.flags.acceptance);
  const owners = splitList(parsed.flags.owner);
  if (owners.length > 0) patch.owner = owners.join(",");
  const maxIterations = numberFlag(parsed, "max-iterations");
  if (maxIterations !== undefined && maxIterations > 0) patch.maxIterations = maxIterations;
  print({ todo: amendTodo(db, id, patch) });
  return;
    }

function taskReview(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
  if (!taskId) {
    print({ error: "task review requires --task or an active task" });
    process.exitCode = 1;
    return;
  }
  const raw = (asString(parsed.flags.json) || readStdin()).trim();
  let diff: ReviewDiff = {};
  if (raw.length > 0) {
    try {
      diff = JSON.parse(raw) as ReviewDiff;
    } catch {
      print({ error: "invalid JSON review diff" });
      process.exitCode = 1;
      return;
    }
  }
  const outcome = reviewTask(db, { taskId, ...diff });
  print({ ...outcome, reason: asString(parsed.flags.reason) });
  return;
    }

function taskSignals(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
  if (!taskId) {
    print({ error: "task signals requires --task or an active task" });
    process.exitCode = 1;
    return;
  }
  print({ task: getTask(db, taskId), signals: revisionSignals(db, taskId) });
  return;
    }

function taskBlock(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  if (!id) {
    print({ error: "task block requires --id" });
    process.exitCode = 1;
    return;
  }
  print({ todo: blockTodo(db, id, asString(parsed.flags.reason)) });
  return;
    }

function taskDone(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  if (!id) {
    print({ error: "task done requires --id" });
    process.exitCode = 1;
    return;
  }
  const todo = completeTodo(db, id, asString(parsed.flags.proof));
  if (spec.config.ledger?.enabled !== false) recordTodoDone(db, todo.task_id);
  print({ todo });
  return;
    }

function taskStart(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  if (!id) {
    print({ error: "task start requires --id" });
    process.exitCode = 1;
    return;
  }
  const target = getTodo(db, id);
  if (target && spec.config.ledger?.enabled !== false) {
    const due = reviewDue(db, target.task_id, spec.config.ledger.review);
    if (due.due) {
      print({ error: due.reason, task: target.task_id });
      process.exitCode = 1;
      return;
    }
  }
  print({ todo: startTodo(db, id) });
  return;
    }

function taskTodo(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
  if (!taskId) {
    print({ error: "task todo requires --task or an active task" });
    process.exitCode = 1;
    return;
  }
  const label = (asString(parsed.flags.label) || parsed.positionals.slice(2).join(" ")).trim();
  if (label.length === 0) {
    print({ error: "task todo requires --label" });
    process.exitCode = 1;
    return;
  }
  const maxIterations = numberFlag(parsed, "max-iterations");
  const owners = splitList(parsed.flags.owner);
  const todos = addTodos(db, taskId, [
    {
      label,
      kind: (asString(parsed.flags.kind) || "edit") as TodoKind,
      acceptance: asString(parsed.flags.acceptance) || undefined,
      owner: owners.length > 0 ? owners.join(",") : undefined,
      maxIterations: maxIterations !== undefined && maxIterations > 0 ? maxIterations : undefined
    }
  ]);
  print({ task: getTask(db, taskId), todos });
  return;
    }

function taskPlan(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
  const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
  if (!taskId) {
    print({ error: "task plan requires --task or an active task" });
    process.exitCode = 1;
    return;
  }
  const raw = (asString(parsed.flags.json) || readStdin()).trim();
  let parsedItems: unknown;
  try {
    parsedItems = JSON.parse(raw.length > 0 ? raw : "[]");
  } catch {
    print({ error: "invalid JSON plan" });
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(parsedItems)) {
    print({ error: "plan must be a JSON array of todos" });
    process.exitCode = 1;
    return;
  }
  const todos = addTodos(db, taskId, parsedItems.map(normalizeTodoInput));
  print({ task: getTask(db, taskId), todos });
  return;
    }

function taskNew(parsed: Parsed, db: ReturnType<typeof openDb>, session: string, spec: ReturnType<typeof loadSpec>): void {
  const title = (asString(parsed.flags.title) || parsed.positionals.slice(2).join(" ")).trim();
  if (title.length === 0) {
    print({ error: "task new requires --title" });
    process.exitCode = 1;
    return;
  }
  const id = asString(parsed.flags.id) || undefined;
  const task = createTask(db, { title, id, sessionId: session || undefined });
  print({ task, todos: [] });
  return;
    }


