import type { DatabaseSync } from "node:sqlite";
import { globToRegExp } from "./gate.ts";
import { autoCommit } from "./graft.ts";

export type TodoKind = "read" | "edit" | "verify" | "delegate";
type TodoStatus = "pending" | "in_progress" | "done" | "blocked" | "dropped";
type TaskStatus = "active" | "done" | "abandoned";

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  reviewed_at: string | null;
  edits_since_review: number;
  todos_since_review: number;
}

interface TodoRow {
  id: string;
  task_id: string;
  seq: number;
  label: string;
  kind: TodoKind;
  status: TodoStatus;
  acceptance: string | null;
  proof: string | null;
  owner: string | null;
  depends_on: string;
  iterations: number;
  max_iterations: number | null;
  updated_at: string;
}

export interface TodoInput {
  label: string;
  kind?: TodoKind;
  acceptance?: string;
  owner?: string;
  dependsOn?: string[];
  maxIterations?: number;
  status?: TodoStatus;
}

interface WorkPacket {
  todo: string;
  label: string;
  objective: string;
  kind: TodoKind;
  files: string[];
  acceptance: string | null;
  budget: number | null;
  dependsOn: string[];
}

interface LedgerState {
  task: TaskRow | null;
  todos: TodoRow[];
  current: TodoRow | null;
}

interface TraceResult {
  required: boolean;
  ok: boolean;
  todo: TodoRow | null;
  reason: string;
}

export const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_REVIEW_EDITS = 3;
const DEFAULT_REVIEW_TODOS = 2;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

interface ReviewPolicy {
  edits: number;
  todos: number;
}

interface ReviewState {
  due: boolean;
  edits: number;
  todos: number;
  policy: ReviewPolicy;
  reason: string;
}

export interface TodoAmendment {
  label?: string;
  kind?: TodoKind;
  acceptance?: string | null;
  owner?: string | null;
  dependsOn?: string[];
  maxIterations?: number;
}

export interface ReviewDiff {
  additions?: TodoInput[];
  amendments?: Array<{ id: string } & TodoAmendment>;
  removals?: Array<string | { id: string; reason?: string }>;
  order?: string[];
}

interface RevisionSignal {
  type: string;
  todo: string | null;
  detail: string;
}

interface ReviewOutcome {
  task: TaskRow;
  revision: number;
  applied: { additions: number; amendments: number; removals: number; reordered: boolean };
  signals: RevisionSignal[];
}

function nowIso(): string {
  return new Date().toISOString();
}

// H4: SESSION_TTL_MS was defined but never enforced — sessions accumulated
// forever. pruneSessions deletes expired sessions and their orphaned rows.
// Called from openDb on every startup (best effort, never throws).
export function pruneSessions(db: DatabaseSync): void {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  db.exec("SAVEPOINT prune_sp");
  try {
    db.prepare(
      "DELETE FROM skill_invocations WHERE session_id IN (SELECT id FROM sessions WHERE updated_at < ?)"
    ).run(cutoff);
    db.prepare(
      "DELETE FROM roadmap_progress WHERE session_id IN (SELECT id FROM sessions WHERE updated_at < ?)"
    ).run(cutoff);
    db.prepare(
      "DELETE FROM enforcement_log WHERE session_id IN (SELECT id FROM sessions WHERE updated_at < ?)"
    ).run(cutoff);
    db.prepare("DELETE FROM sessions WHERE updated_at < ?").run(cutoff);
    db.exec("RELEASE SAVEPOINT prune_sp");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT prune_sp");
    throw error;
  }
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseDeps(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (error) {
    console.warn(`[Novahiz] parseDeps: corrupted JSON ignored: ${error}`);
    return [];
  }
}

export function createTask(db: DatabaseSync, options: { title: string; id?: string; sessionId?: string }): TaskRow {
  const taskId = options.id && options.id.trim().length > 0 ? options.id.trim() : genId("task");
  const ts = nowIso();
  // H5: ensure referenced session exists (auto-create if needed for FK compliance)
  if (options.sessionId) {
    db.prepare("INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(options.sessionId, ts);
  }
  db.prepare(
    "INSERT INTO tasks (id, title, status, session_id, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)"
  ).run(taskId, options.title, options.sessionId ?? null, ts, ts);
  autoCommit("task-created", options.title);
  return getTask(db, taskId) as TaskRow;
}

export function getTask(db: DatabaseSync, id: string): TaskRow | null {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return (row as unknown as TaskRow) ?? null;
}

// C6: Helper that throws a descriptive error instead of casting null as TaskRow.
// Prevents silent null-dereference when a task ID doesn't exist.
function requireTask(db: DatabaseSync, id: string): TaskRow {
  const task = getTask(db, id);
  if (!task) throw new Error(`task not found: ${id}`);
  return task;
}

export function activeTask(db: DatabaseSync, sessionId?: string): TaskRow | null {
  const row = sessionId
    ? db.prepare("SELECT * FROM tasks WHERE status = 'active' AND session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId)
    : db.prepare("SELECT * FROM tasks WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();
  return (row as unknown as TaskRow) ?? null;
}

export function getTodo(db: DatabaseSync, id: string): TodoRow | null {
  const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
  return (row as unknown as TodoRow) ?? null;
}

export function listTodos(db: DatabaseSync, taskId: string): TodoRow[] {
  return db.prepare("SELECT * FROM todos WHERE task_id = ? ORDER BY seq").all(taskId) as unknown as TodoRow[];
}

export function addTodos(db: DatabaseSync, taskId: string, items: TodoInput[]): TodoRow[] {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);
  const insert = db.prepare(
    "INSERT INTO todos (id, task_id, seq, label, kind, status, acceptance, proof, owner, depends_on, iterations, max_iterations, updated_at) VALUES (?, ?, COALESCE((SELECT MAX(seq) FROM todos WHERE task_id = ?), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const ids: string[] = [];
  db.exec("SAVEPOINT add_todos_sp");
  try {
    for (const item of items) {
      const todoId = genId("todo");
      insert.run(
        todoId,
        taskId,
        taskId,
        item.label,
        item.kind ?? "edit",
        item.status ?? "pending",
        item.acceptance ?? null,
        null,
        item.owner ?? null,
        JSON.stringify(item.dependsOn ?? []),
        0,
        item.maxIterations ?? DEFAULT_MAX_ITERATIONS,
        nowIso()
      );
      ids.push(todoId);
    }
    reopenTask(db, taskId);
    db.exec("RELEASE SAVEPOINT add_todos_sp");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT add_todos_sp");
    throw error;
  }
  autoCommit("todos-added", `${items.length} item(s) to ${taskId}`);
  return ids.map((id) => getTodo(db, id) as TodoRow);
}

export function startTodo(db: DatabaseSync, id: string): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  if (todo.status === "done") throw new Error(`todo already done: ${id}`);
  const unfinished = parseDeps(todo.depends_on).filter((dep) => {
    const dependency = getTodo(db, dep);
    return !dependency || (dependency.status !== "done" && dependency.status !== "dropped");
  });
  if (unfinished.length > 0) {
    throw new Error(`todo ${id} is blocked by unfinished dependencies: ${unfinished.join(", ")}`);
  }
  const ts = nowIso();
  const result = db.prepare(
    "UPDATE todos SET iterations = iterations + 1, status = 'in_progress', updated_at = ? WHERE id = ? AND (max_iterations IS NULL OR iterations < max_iterations) RETURNING iterations, max_iterations"
  ).get(ts, id) as { iterations: number; max_iterations: number | null } | undefined;
  if (!result) {
    throw new Error(`todo ${id} exceeded its iteration budget (${todo.max_iterations ?? DEFAULT_MAX_ITERATIONS})`);
  }
  return getTodo(db, id) as TodoRow;
}

export function completeTodo(db: DatabaseSync, id: string, proof = ""): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  const trimmed = String(proof ?? "").trim();
  if (todo.kind === "verify" && trimmed.length === 0) {
    throw new Error(`todo ${id} is a verify step and needs proof (the command you ran and its result)`);
  }
  db.prepare("UPDATE todos SET status = 'done', proof = ?, updated_at = ? WHERE id = ?").run(trimmed.length > 0 ? trimmed : null, nowIso(), id);
  maybeCompleteTask(db, todo.task_id);
  autoCommit("todo-completed", id);
  return getTodo(db, id) as TodoRow;
}

export function blockTodo(db: DatabaseSync, id: string, reason = ""): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  // The todos table has no reason column, so the block reason travels in proof.
  db.prepare("UPDATE todos SET status = 'blocked', proof = ?, updated_at = ? WHERE id = ?").run(String(reason ?? "").trim() || null, nowIso(), id);
  return getTodo(db, id) as TodoRow;
}

function maybeCompleteTask(db: DatabaseSync, taskId: string): void {
  const open = db.prepare("SELECT COUNT(*) AS count FROM todos WHERE task_id = ? AND status NOT IN ('done', 'dropped')").get(taskId) as { count: number };
  if (open.count === 0) {
    db.prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?").run(nowIso(), taskId);
  }
}

function reopenTask(db: DatabaseSync, taskId: string): void {
  db.prepare("UPDATE tasks SET status = CASE WHEN status = 'done' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?").run(nowIso(), taskId);
}

export function resume(db: DatabaseSync, sessionId?: string): LedgerState {
  const task = activeTask(db, sessionId);
  if (!task) return { task: null, todos: [], current: null };
  const todos = listTodos(db, task.id);
  const current =
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status === "pending") ??
    null;
  return { task, todos, current };
}

export function ownedBy(todo: TodoRow, filePath: string): boolean {
  const owner = (todo.owner ?? "").trim();
  if (owner.length === 0) return true;
  const normalized = filePath.replace(/\\/g, "/");
  return owner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((pattern) => globToRegExp(pattern).test(normalized));
}

export function traceCheck(db: DatabaseSync, options: { sessionId?: string; filePath: string; required: boolean }): TraceResult {
  if (!options.required) return { required: false, ok: true, todo: null, reason: "" };
  const state = resume(db, options.sessionId);
  const inProgress = state.todos.filter((todo) => todo.status === "in_progress");
  const match = inProgress.find((todo) => ownedBy(todo, options.filePath));
  if (match) return { required: true, ok: true, todo: match, reason: "" };
  const reason =
    inProgress.length === 0
      ? "no todo is in progress. Start one with `novahiz task start --id <todo>` before editing."
      : `no in-progress todo owns ${options.filePath}. Active todos own: ${inProgress.map((todo) => todo.owner || "(any file)").join("; ")}`;
  return { required: true, ok: false, todo: null, reason };
}

export function buildWorkPackets(db: DatabaseSync, taskId: string): WorkPacket[] {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);
  return listTodos(db, taskId)
    .filter((todo) => todo.status === "pending" || todo.status === "in_progress")
    .map((todo) => ({
      todo: todo.id,
      label: todo.label,
      objective: todo.acceptance ?? todo.label,
      kind: todo.kind,
      files: (todo.owner ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      acceptance: todo.acceptance,
      budget: todo.max_iterations,
      dependsOn: parseDeps(todo.depends_on)
    }));
}

export function amendTodo(db: DatabaseSync, id: string, patch: TodoAmendment): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  if (todo.status === "done" || todo.status === "dropped") throw new Error(`cannot amend a ${todo.status} todo: ${id}`);
  const label = patch.label ?? todo.label;
  const kind = patch.kind ?? todo.kind;
  const acceptance = patch.acceptance === undefined ? todo.acceptance : patch.acceptance;
  const owner = patch.owner === undefined ? todo.owner : patch.owner;
  const dependsOn = patch.dependsOn === undefined ? todo.depends_on : JSON.stringify(patch.dependsOn);
  const maxIterations = patch.maxIterations === undefined ? todo.max_iterations : patch.maxIterations;
  if (maxIterations !== null && maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations <= 0)) {
    throw new Error(`maxIterations must be a positive integer, got: ${maxIterations}`);
  }
  db.prepare(
    "UPDATE todos SET label = ?, kind = ?, acceptance = ?, owner = ?, depends_on = ?, max_iterations = ?, updated_at = ? WHERE id = ?"
  ).run(label, kind, acceptance, owner, dependsOn, maxIterations, nowIso(), id);
  return getTodo(db, id) as TodoRow;
}

export function reorderTodos(db: DatabaseSync, taskId: string, orderedIds: string[]): TodoRow[] {
  const todos = listTodos(db, taskId);
  const existing = new Set(todos.map((todo) => todo.id));
  if (orderedIds.length !== todos.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !existing.has(id))) {
    throw new Error(`reorder must list each todo of task ${taskId} exactly once`);
  }
  const update = db.prepare("UPDATE todos SET seq = ?, updated_at = ? WHERE id = ?");
  const ts = nowIso();
  orderedIds.forEach((id, index) => update.run(index + 1, ts, id));
  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(ts, taskId);
  return listTodos(db, taskId);
}

export function insertTodo(db: DatabaseSync, taskId: string, item: TodoInput, position?: number | "start" | "end"): TodoRow {
  // M-Ledger: wrap insert + reorder in a savepoint so a reorder failure doesn't
  // leave a half-inserted todo visible.
  db.exec("SAVEPOINT insert_sp");
  try {
    const created = addTodos(db, taskId, [item])[0];
    if (position === undefined || position === "end") {
      db.exec("RELEASE SAVEPOINT insert_sp");
      return created;
    }
    const others = listTodos(db, taskId).filter((todo) => todo.id !== created.id);
    let orderedIds: string[];
    if (position === "start") {
      orderedIds = [created.id, ...others.map((todo) => todo.id)];
    } else {
      orderedIds = [
        ...others.filter((todo) => todo.seq <= position).map((todo) => todo.id),
        created.id,
        ...others.filter((todo) => todo.seq > position).map((todo) => todo.id)
      ];
    }
    reorderTodos(db, taskId, orderedIds);
    db.exec("RELEASE SAVEPOINT insert_sp");
    return getTodo(db, created.id) as TodoRow;
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT insert_sp");
    db.exec("RELEASE SAVEPOINT insert_sp");
    throw error;
  }
}

export function dropTodo(db: DatabaseSync, id: string, reason = ""): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  db.prepare("UPDATE todos SET status = 'dropped', proof = ?, updated_at = ? WHERE id = ?").run(
    String(reason ?? "").trim() || null,
    nowIso(),
    id
  );
  maybeCompleteTask(db, todo.task_id);
  autoCommit("todo-dropped", id);
  return getTodo(db, id) as TodoRow;
}

export function dropTask(db: DatabaseSync, id: string, reason = ""): TaskRow {
  const task = requireTask(db, id);
  const trimmed = String(reason ?? "").trim();
  // Active tasks may only be abandoned with an explicit reason (cleanup /
  // superseded work). Finished tasks can be dropped without one.
  if (task.status === "active" && trimmed.length === 0) {
    throw new Error(`refusing to abandon active task ${id} without a reason; pass --reason (or finish the task first)`);
  }
  try {
    db.exec("SAVEPOINT drop_task_sp");
    db.prepare(
      "UPDATE todos SET status = 'dropped', proof = ?, updated_at = ? WHERE task_id = ? AND status NOT IN ('done', 'dropped')"
    ).run(trimmed || null, nowIso(), id);
    db.prepare("UPDATE tasks SET status = 'abandoned', updated_at = ? WHERE id = ?").run(nowIso(), id);
    db.exec("RELEASE SAVEPOINT drop_task_sp");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT drop_task_sp");
    throw error;
  }
  autoCommit("task-abandoned", trimmed ? `${id}: ${trimmed}` : id);
  return requireTask(db, id);
}

export function recordEdit(db: DatabaseSync, taskId: string): number {
  const result = db.prepare(
    "UPDATE tasks SET edits_since_review = edits_since_review + 1, updated_at = ? WHERE id = ? RETURNING edits_since_review"
  ).get(nowIso(), taskId) as { edits_since_review: number } | undefined;
  if (!result) throw new Error(`task not found: ${taskId}`);
  return result.edits_since_review;
}

export function recordTodoDone(db: DatabaseSync, taskId: string): number {
  db.prepare("UPDATE tasks SET todos_since_review = todos_since_review + 1, updated_at = ? WHERE id = ?").run(nowIso(), taskId);
  return requireTask(db, taskId).todos_since_review;
}

export function reviewDue(db: DatabaseSync, taskId: string, policy: ReviewPolicy = { edits: DEFAULT_REVIEW_EDITS, todos: DEFAULT_REVIEW_TODOS }): ReviewState {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);
  const due = task.edits_since_review >= policy.edits || task.todos_since_review >= policy.todos;
  const reason = due
    ? `plan review due (${task.edits_since_review} edits, ${task.todos_since_review} todos since last review; cadence ${policy.edits} edits / ${policy.todos} todos). Reconcile with \`novahiz task review\`.`
    : "";
  return { due, edits: task.edits_since_review, todos: task.todos_since_review, policy, reason };
}

export function revisionSignals(db: DatabaseSync, taskId: string): RevisionSignal[] {
  const todos = listTodos(db, taskId);
  const signals: RevisionSignal[] = [];
  const inProgress = todos.filter((todo) => todo.status === "in_progress");
  if (inProgress.length > 1) {
    signals.push({ type: "parallel", todo: null, detail: `${inProgress.length} todos are in progress at once; keep a single active step.` });
  }
  for (const todo of todos) {
    if (todo.status === "blocked") {
      signals.push({ type: "blocked", todo: todo.id, detail: `${todo.label} is blocked: ${todo.proof ?? "no reason given"}` });
    }
    if (todo.status === "in_progress" || todo.status === "pending") {
      const max = todo.max_iterations ?? DEFAULT_MAX_ITERATIONS;
      if (todo.iterations >= max) {
        signals.push({ type: "budget", todo: todo.id, detail: `${todo.label} hit its iteration budget (${todo.iterations}/${max}); split, drop, or re-scope it.` });
      }
      if (todo.kind === "edit" && !todo.acceptance) {
        signals.push({ type: "missing_acceptance", todo: todo.id, detail: `${todo.label} has no acceptance criterion.` });
      }
      if (!todo.owner) {
        signals.push({ type: "unowned", todo: todo.id, detail: `${todo.label} owns no file; a parallel agent could collide.` });
      }
    }
  }
  const settled = new Set(todos.filter((todo) => todo.status === "done" || todo.status === "dropped").map((todo) => todo.id));
  for (const todo of todos) {
    if (todo.status !== "pending") continue;
    const deps = parseDeps(todo.depends_on);
    if (deps.length > 0 && deps.every((dep) => settled.has(dep))) {
      signals.push({ type: "ready", todo: todo.id, detail: `${todo.label} has no unfinished dependencies.` });
    }
  }
  return signals;
}

export function reviewTask(db: DatabaseSync, options: { taskId: string } & ReviewDiff): ReviewOutcome {
  const task = getTask(db, options.taskId);
  if (!task) throw new Error(`unknown task: ${options.taskId}`);
  const additions = options.additions ?? [];
  const amendments = options.amendments ?? [];
  const removals = options.removals ?? [];
  db.exec("BEGIN");
  try {
    for (const item of removals) {
      const id = typeof item === "string" ? item : item.id;
      const reason = typeof item === "string" ? "" : item.reason ?? "";
      dropTodo(db, id, reason);
    }
    for (const change of amendments) {
      const { id, ...patch } = change;
      amendTodo(db, id, patch);
    }
    for (const item of additions) insertTodo(db, options.taskId, item, "end");
    if (options.order) reorderTodos(db, options.taskId, options.order);
    const revision = task.revision + 1;
    const ts = nowIso();
    db.prepare(
      "UPDATE tasks SET revision = ?, reviewed_at = ?, edits_since_review = 0, todos_since_review = 0, updated_at = ? WHERE id = ?"
    ).run(revision, ts, ts, options.taskId);
    db.exec("COMMIT");
    const result = {
      task: requireTask(db, options.taskId),
      revision,
      applied: { additions: additions.length, amendments: amendments.length, removals: removals.length, reordered: Boolean(options.order) },
      signals: revisionSignals(db, options.taskId)
    };
    autoCommit("task-reviewed", `revision ${revision}`);
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function ledgerSummary(state: LedgerState): string[] {
  if (!state.task) return [];
  const done = state.todos.filter((todo) => todo.status === "done").length;
  const lines = [`Ledger ${state.task.id}: ${state.task.title} (${done}/${state.todos.length} done)`];
  for (const todo of state.todos) {
    const flag = todo.status === "in_progress" ? ">" : todo.status === "done" ? "x" : todo.status === "blocked" ? "!" : todo.status === "dropped" ? "-" : " ";
    const proof = todo.proof ? ` | proof: ${todo.proof}` : "";
    lines.push(`  [${flag}] ${todo.seq}. ${todo.label}${proof}`);
  }
  if (state.current) {
    const max = state.current.max_iterations ?? DEFAULT_MAX_ITERATIONS;
    lines.push(`  next: ${state.current.label} (budget ${state.current.iterations}/${max})`);
  }
  return lines;
}
