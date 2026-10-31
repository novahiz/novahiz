import type { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { globToRegExp, isSafeRegexPattern } from "./gate.ts";
import { capture } from "./snap.ts";

export type TodoKind = "read" | "edit" | "verify" | "delegate";
export type TodoSize = "XS" | "S" | "M" | "L" | "XL";
export const TODO_SIZES: readonly TodoSize[] = ["XS", "S", "M", "L", "XL"];
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
  project_root: string | null;
  closing_proof: string | null;
  category: string | null;
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
  size: string | null;
  updated_at: string;
}

export interface TodoInput {
  label: string;
  kind?: TodoKind;
  acceptance?: string;
  owner?: string;
  dependsOn?: string[];
  maxIterations?: number;
  /** Contract size, XS to XL. Kept as a free string in SQL, validated on write. */
  size?: TodoSize;
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
// Cadence de review : le plan doit rester vivant, mais pas au prix d'un
// `review` tous les trois edits suivi d'un nouveau blocage deux todos plus
// loin — coût constaté en session réelle (trois reviews consécutives pour un
// seul lot de travail). 10 edits ou 5 todos laissent la place à une tranche
// utile tout en gardant le garde-fou.
const DEFAULT_REVIEW_EDITS = 10;
const DEFAULT_REVIEW_TODOS = 5;
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
  size?: TodoSize | null;
}

export interface ReviewDiff {
  additions?: Array<string | TodoInput>;
  amendments?: Array<{ id: string } & TodoAmendment>;
  removals?: Array<string | { id: string; reason?: string }>;
  order?: string[];
}

export type PlanAction = "add" | "insert" | "amend" | "drop" | "reorder" | "review" | "close" | "abandon";

export interface PlanHistoryRow {
  id: number;
  task_id: string;
  action: PlanAction;
  target: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  created_at: string;
}

export interface PlanChange {
  taskId: string;
  action: PlanAction;
  target?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
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
// Called from openDb on every startup (best effort, never throws). Returns the
// number of rows it removed: the caller decides whether there is anything
// worth snapshotting, so an untouched ledger is not captured — and, worse, not
// mislabelled with this operation while it captures somebody else's write.
export function pruneSessions(db: DatabaseSync): number {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  // TTL = inactivité, pas « temps écoulé depuis la dernière classification ».
  // Une session qui charge une skill reste active : sa ligne `sessions` n'est
  // écrite qu'à la classification, donc la comparer seule à la coupure purgeait
  // les skills d'une session en plein travail (constaté : 4 skills en base
  // contre 15 chargées, d'où des GATE RELOAD en boucle). On retient la plus
  // récente des deux activités — classification ou chargement de skill.
  const staleIds = (
    db
      .prepare(
        `SELECT s.id AS id FROM sessions s
         WHERE s.updated_at < ?
           AND COALESCE(
                 (SELECT MAX(i.invoked_at) FROM skill_invocations i WHERE i.session_id = s.id),
                 s.updated_at
               ) < ?`,
      )
      .all(cutoff, cutoff) as { id: string }[]
  ).map((row) => row.id);
  if (staleIds.length === 0) return 0;
  const placeholders = staleIds.map(() => "?").join(", ");
  db.exec("SAVEPOINT prune_sp");
  let removed = 0;
  try {
    removed += Number(
      db
        .prepare(`DELETE FROM skill_invocations WHERE session_id IN (${placeholders})`)
        .run(...staleIds).changes,
    );
    removed += Number(
      db
        .prepare(`DELETE FROM roadmap_progress WHERE session_id IN (${placeholders})`)
        .run(...staleIds).changes,
    );
    removed += Number(
      db
        .prepare(`DELETE FROM enforcement_log WHERE session_id IN (${placeholders})`)
        .run(...staleIds).changes,
    );
    removed += Number(
      db
        .prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`)
        .run(...staleIds).changes,
    );
    db.exec("RELEASE SAVEPOINT prune_sp");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT prune_sp");
    throw error;
  }
  return removed;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const PLAN_SNAPSHOT_MAX = 4000;

function planSnapshot(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    return json.length > PLAN_SNAPSHOT_MAX ? `${json.slice(0, PLAN_SNAPSHOT_MAX)}…` : json;
  } catch {
    return null;
  }
}

function todoSnapshot(todo: TodoRow): Record<string, unknown> {
  return {
    label: todo.label,
    kind: todo.kind,
    status: todo.status,
    acceptance: todo.acceptance,
    owner: todo.owner,
    dependsOn: parseDeps(todo.depends_on),
    size: todo.size,
    maxIterations: todo.max_iterations
  };
}

/**
 * Journal of every plan mutation.
 *
 * `amend`, `insert`, `drop` and `reorder` rewrote the plan silently: the ledger
 * kept the current state and nothing else, so a reviewer could not tell who
 * removed a step or when a dependency moved. Each mutation now appends one row
 * with the before/after snapshot; the plan itself is untouched.
 */
export function recordPlanChange(db: DatabaseSync, change: PlanChange): void {
  db.prepare(
    "INSERT INTO plan_history (task_id, action, target, before_json, after_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    change.taskId,
    change.action,
    change.target ?? null,
    planSnapshot(change.before),
    planSnapshot(change.after),
    change.reason ?? null,
    nowIso()
  );
}

export function planHistory(db: DatabaseSync, taskId: string, limit = 50): PlanHistoryRow[] {
  const bounded = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return db
    .prepare("SELECT * FROM plan_history WHERE task_id = ? ORDER BY id DESC LIMIT ?")
    .all(taskId, bounded) as unknown as PlanHistoryRow[];
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

export function createTask(
  db: DatabaseSync,
  options: { title: string; id?: string; sessionId?: string; projectRoot?: string; category?: string },
): TaskRow {
  const taskId = options.id && options.id.trim().length > 0 ? options.id.trim() : genId("task");
  const ts = nowIso();
  // H5: ensure referenced session exists (auto-create if needed for FK compliance)
  if (options.sessionId) {
    db.prepare("INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(options.sessionId, ts);
  }
  // F: remember which project the plan belongs to so the ledger can filter its
  // edits to that project. Callers that cannot know it (legacy MCP flows) pass
  // nothing and get NULL = unscoped, the behaviour before this column existed.
  const projectRoot = options.projectRoot && options.projectRoot.trim().length > 0 ? resolve(options.projectRoot) : null;
  const category = options.category && options.category.trim().length > 0 ? options.category.trim() : null;
  db.prepare(
    "INSERT INTO tasks (id, title, status, session_id, created_at, updated_at, project_root, category) VALUES (?, ?, 'active', ?, ?, ?, ?, ?)"
  ).run(taskId, options.title, options.sessionId ?? null, ts, ts, projectRoot, category);
  capture(db, "task-created", options.title);
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
  // G2: two worlds, never mixed. A caller with a session only ever sees its own
  // tasks; a sessionless caller only sees unbound tasks (session_id NULL) — a
  // session-bound plan can no longer be grabbed (counted, blocked) by a foreign
  // sessionless gate run, and the newest active task is no longer a free-for-all.
  const row = sessionId
    ? db.prepare("SELECT * FROM tasks WHERE status = 'active' AND session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId)
    : db.prepare("SELECT * FROM tasks WHERE status = 'active' AND session_id IS NULL ORDER BY created_at DESC LIMIT 1").get();
  return (row as unknown as TaskRow) ?? null;
}

export function getTodo(db: DatabaseSync, id: string): TodoRow | null {
  const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
  return (row as unknown as TodoRow) ?? null;
}

export function listTodos(db: DatabaseSync, taskId: string): TodoRow[] {
  return db.prepare("SELECT * FROM todos WHERE task_id = ? ORDER BY seq").all(taskId) as unknown as TodoRow[];
}

function normalizeSize(value: unknown): TodoSize | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim().toUpperCase();
  if (!TODO_SIZES.includes(raw as TodoSize)) {
    throw new Error(`invalid todo size: ${String(value)} (expected ${TODO_SIZES.join(", ")})`);
  }
  return raw as TodoSize;
}

export function addTodos(db: DatabaseSync, taskId: string, items: TodoInput[], options: { silent?: boolean } = {}): TodoRow[] {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);
  const insert = db.prepare(
    "INSERT INTO todos (id, task_id, seq, label, kind, status, acceptance, proof, owner, depends_on, iterations, max_iterations, size, updated_at) VALUES (?, ?, COALESCE((SELECT MAX(seq) FROM todos WHERE task_id = ?), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        normalizeSize(item.size),
        nowIso()
      );
      ids.push(todoId);
      if (!options.silent) {
        recordPlanChange(db, { taskId, action: "add", target: todoId, after: item });
      }
    }
    reopenTask(db, taskId);
    db.exec("RELEASE SAVEPOINT add_todos_sp");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT add_todos_sp");
    throw error;
  }
  capture(db, "todos-added", `${items.length} item(s) to ${taskId}`);
  return ids.map((id) => getTodo(db, id) as TodoRow);
}

/** True when a dependency reference names rows that are all settled.
 *
 *  A plan lists dependencies the way a human writes them ("T2", "P5"), while a
 *  row is keyed by a generated id, and `normalizeTodoInput` (src/commands/task.ts)
 *  accepts either without checking which one it got. Both consumers - startTodo
 *  and the ready-signal sweep - resolved the reference as an id only, so every
 *  label-declared dependency looked up null, read as "unfinished", and wedged the
 *  dependent todo for the whole life of the task (`blocked by unfinished
 *  dependencies: T2, T3, T4, T5, T6` with all six already done, observed
 *  2026-10-14 on task_mv82uzkvd5pk14). The rows keep whatever the plan said, so
 *  resolution happens on read rather than by rewriting the ledger.
 *
 *  Fail closed in both directions: a reference matching no row is never settled,
 *  so a typo can never unblock a step; an ambiguous reference (two rows share the
 *  prefix) stays unsettled until every candidate row is settled, so an ambiguous
 *  name cannot pick the cheapest row to satisfy. */
function depSettled(db: DatabaseSync, taskId: string, ref: string): boolean {
  const direct = getTodo(db, ref);
  if (direct) return direct.status === "done" || direct.status === "dropped";
  const rows = listTodos(db, taskId).filter(
    (row) => row.label === ref || row.label.startsWith(`${ref}:`)
  );
  if (rows.length === 0) return false;
  return rows.every((row) => row.status === "done" || row.status === "dropped");
}

export function startTodo(db: DatabaseSync, id: string): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  if (todo.status === "done") throw new Error(`todo already done: ${id}`);
  const unfinished = parseDeps(todo.depends_on).filter((dep) => !depSettled(db, todo.task_id, dep));
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

/** A proof may point at recorded evidence, which the ledger can verify. */
function assertProof(db: DatabaseSync, todo: TodoRow, proof: string): void {
  const trimmed = proof.trim();
  // edit and verify both change reality: closing either without a trace is the
  // exact hole this ledger is supposed to close. `read` and `delegate` record
  // an intention, so an empty proof stays acceptable there.
  if (todo.kind !== "edit" && todo.kind !== "verify") return;
  if (trimmed.length === 0) {
    const article = todo.kind === "edit" ? "an edit" : "a verify";
    throw new Error(
      `todo ${todo.id} is ${article} step and needs proof: the command you ran and its result, ` +
        `or evidence:<id> returned by novahiz_verify`,
    );
  }
  const match = /^evidence:(\S+)$/.exec(trimmed);
  if (!match) return;
  const row = db.prepare("SELECT id, ok, name FROM evidence WHERE id = ?").get(match[1]) as
    | { id: string; ok: number; name: string }
    | undefined;
  if (!row) throw new Error(`proof references unknown evidence ${match[1]}; run novahiz_verify first`);
  if (Number(row.ok) !== 1) {
    throw new Error(`proof references failed evidence ${match[1]} (${row.name}); fix the failure and verify again`);
  }
}

export function completeTodo(db: DatabaseSync, id: string, proof = ""): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  const trimmed = String(proof ?? "").trim();
  assertProof(db, todo, trimmed);
  db.prepare("UPDATE todos SET status = 'done', proof = ?, updated_at = ? WHERE id = ?").run(trimmed.length > 0 ? trimmed : null, nowIso(), id);
  capture(db, "todo-completed", id);
  return getTodo(db, id) as TodoRow;
}

export function blockTodo(db: DatabaseSync, id: string, reason = ""): TodoRow {
  const todo = getTodo(db, id);
  if (!todo) throw new Error(`unknown todo: ${id}`);
  // The todos table has no reason column, so the block reason travels in proof.
  db.prepare("UPDATE todos SET status = 'blocked', proof = ?, updated_at = ? WHERE id = ?").run(String(reason ?? "").trim() || null, nowIso(), id);
  return getTodo(db, id) as TodoRow;
}

export function openTodoIds(db: DatabaseSync, taskId: string): string[] {
  return (
    db
      .prepare("SELECT id FROM todos WHERE task_id = ? AND status NOT IN ('done', 'dropped') ORDER BY seq")
      .all(taskId) as { id: string }[]
  ).map((row) => row.id);
}

/**
 * Close a task explicitly.
 *
 * A task used to close itself the moment its last todo was marked done, so the
 * closing verification was never a step of its own: the plan vanished before
 * anybody could prove the result. Now the task stays active until this call,
 * which refuses while a todo is open and demands a proof (free text or a
 * recorded evidence id).
 */
export function closeTask(
  db: DatabaseSync,
  taskId: string,
  proof = "",
  required?: { steps: string[]; scopes: string[] },
): TaskRow {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);
  if (task.status !== "active") throw new Error(`task ${taskId} is already ${task.status}`);
  const open = openTodoIds(db, taskId);
  if (open.length > 0) {
    throw new Error(`task ${taskId} still has ${open.length} open todo(s): ${open.join(", ")}`);
  }
  // Roadmap steps are no longer decorative: a category's non-optional steps are
  // the ones the gate enforces, and closing the task without recording them was
  // how critique / polish / a11y silently disappeared from a "finished" plan.
  const steps = required?.steps ?? [];
  const scopes = (required?.scopes ?? []).filter((scope) => scope.length > 0);
  if (steps.length > 0 && scopes.length > 0) {
    const placeholders = scopes.map(() => "?").join(", ");
    const done = new Set(
      (
        db
          .prepare(
            `SELECT step_id FROM roadmap_progress WHERE status IN ('done', 'dropped') AND session_id IN (${placeholders})`,
          )
          .all(...scopes) as { step_id: string }[]
      ).map((row) => row.step_id),
    );
    const missing = steps.filter((step) => !done.has(step));
    if (missing.length > 0) {
      throw new Error(
        `task ${taskId} cannot close: roadmap step(s) not recorded as done: ${missing.join(", ")}. ` +
          `Searched scopes: ${scopes.join(", ")}. ` +
          `Run novahiz_step({ done: "<id>" }) for each, or novahiz_step({ session: "default", done: "<id>" }) when the task has no session, or drop the step from the category roadmap.`,
      );
    }
  }
  const trimmed = String(proof ?? "").trim();
  if (trimmed.length === 0) {
    throw new Error(`closing task ${taskId} needs proof: what you verified, or evidence:<id> from novahiz_verify`);
  }
  const match = /^evidence:(\S+)$/.exec(trimmed);
  if (match) {
    const row = db.prepare("SELECT id, ok, name FROM evidence WHERE id = ?").get(match[1]) as
      | { id: string; ok: number; name: string }
      | undefined;
    if (!row) throw new Error(`closing proof references unknown evidence ${match[1]}; run novahiz_verify first`);
    if (Number(row.ok) !== 1) {
      throw new Error(`closing proof references failed evidence ${match[1]} (${row.name}); fix the failure and verify again`);
    }
  }
  db.prepare("UPDATE tasks SET status = 'done', closing_proof = ?, updated_at = ? WHERE id = ?").run(trimmed, nowIso(), taskId);
  recordPlanChange(db, { taskId, action: "close", before: { status: task.status }, after: { status: "done" }, reason: trimmed });
  capture(db, "task-closed", taskId);
  return getTask(db, taskId) as TaskRow;
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
    // P2-C (LOW): owner globs come from todo labels; reject nested-quantifier
    // shapes before compiling so a crafted owner cannot ReDoS every edit check.
    .some((pattern) => isSafeRegexPattern(pattern) && globToRegExp(pattern).test(normalized));
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
  const size = patch.size === undefined ? todo.size : normalizeSize(patch.size);
  db.prepare(
    "UPDATE todos SET label = ?, kind = ?, acceptance = ?, owner = ?, depends_on = ?, max_iterations = ?, size = ?, updated_at = ? WHERE id = ?"
  ).run(label, kind, acceptance, owner, dependsOn, maxIterations, size, nowIso(), id);
  recordPlanChange(db, {
    taskId: todo.task_id,
    action: "amend",
    target: id,
    before: todoSnapshot(todo),
    after: todoSnapshot(getTodo(db, id) as TodoRow),
  });
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
  recordPlanChange(db, {
    taskId,
    action: "reorder",
    before: todos.map((todo) => todo.id),
    after: orderedIds,
  });
  return listTodos(db, taskId);
}

export function insertTodo(db: DatabaseSync, taskId: string, item: TodoInput, position?: number | "start" | "end"): TodoRow {
  // M-Ledger: wrap insert + reorder in a savepoint so a reorder failure doesn't
  // leave a half-inserted todo visible.
  db.exec("SAVEPOINT insert_sp");
  try {
    const created = addTodos(db, taskId, [item], { silent: true })[0];
    recordPlanChange(db, {
      taskId,
      action: "insert",
      target: created.id,
      after: { item, position: position ?? "end" },
    });
    if (position === undefined || position === "end") {
      db.exec("RELEASE SAVEPOINT insert_sp");
      // addTodos tried to snapshot while insert_sp was open and was deferred:
      // capture now that the transaction is released.
      capture(db, "todos-added", `1 item(s) to ${taskId}`);
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
    capture(db, "todos-added", `1 item(s) to ${taskId}`);
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
  recordPlanChange(db, {
    taskId: todo.task_id,
    action: "drop",
    target: id,
    before: todoSnapshot(todo),
    reason: String(reason ?? "").trim() || null,
  });
  capture(db, "todo-dropped", id);
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
  recordPlanChange(db, {
    taskId: id,
    action: "abandon",
    before: { status: task.status },
    after: { status: "abandoned" },
    reason: trimmed || null,
  });
  capture(db, "task-abandoned", trimmed ? `${id}: ${trimmed}` : id);
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

/**
 * Does an open todo of this task own filePath through a non-empty owner
 * pattern? Blank owners own everything (ownedBy semantics) and are excluded
 * on purpose: review mechanics — cadence and block — stay tied to explicit
 * ownership, so edits from another session or project never advance this plan.
 */
export function ownedByOpenTodo(db: DatabaseSync, taskId: string, filePath: string): boolean {
  if (filePath.length === 0) return false;
  return listTodos(db, taskId).some(
    (todo) =>
      (todo.status === "pending" || todo.status === "in_progress") &&
      (todo.owner ?? "").trim().length > 0 &&
      ownedBy(todo, filePath)
  );
}

/**
 * Which gate targets a due plan review should block.
 * Only paths owned by an open todo with a non-empty owner pattern are blocked.
 * Empty owners and tasks with no owned open todos never expand the block set,
 * so a due review no longer freezes the whole gate.
 */
export function reviewBlockReason(db: DatabaseSync, taskId: string, filePath: string, policy?: ReviewPolicy): string | null {
  const due = reviewDue(db, taskId, policy);
  if (!due.due) return null;
  return ownedByOpenTodo(db, taskId, filePath) ? due.reason : null;
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
    // Deps resolve by label as well as by id (resolveDep), so a plan written
    // with "T2"/"P5" labels is not reported as permanently unfinished.
    if (deps.length > 0 && deps.every((dep) => settled.has(dep) || depSettled(db, todo.task_id, dep))) {
      signals.push({ type: "ready", todo: todo.id, detail: `${todo.label} has no unfinished dependencies.` });
    }
  }
  return signals;
}

/**
 * Parse an untrusted plan diff (the `changes` payload): accepts an object or
 * a JSON string, keeps only the four known keys and requires each of them to
 * be an array. Unknown keys are dropped on purpose — spreading the raw
 * payload into reviewTask is what used to feed non-scalar values to SQLite
 * ("Provided value cannot be bound to SQLite parameter 1").
 */
export function parseReviewDiff(raw: unknown): ReviewDiff {
  if (raw === undefined || raw === null || raw === "") return {};
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('changes must be JSON like {"additions":[...],"removals":[...]}');
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("changes must be an object like { additions, amendments, removals, order }");
  }
  const source = value as Record<string, unknown>;
  const diff: Record<string, unknown> = {};
  for (const key of ["additions", "amendments", "removals", "order"] as const) {
    const entry = source[key];
    if (entry === undefined || entry === null) continue;
    if (!Array.isArray(entry)) throw new Error(`changes.${key} must be an array`);
    diff[key] = entry;
  }
  return diff as ReviewDiff;
}

/**
 * Scalar-only guard for todo fields SQLite will bind: a nested object used to
 * escape as a binding error deep inside addTodos/amendTodo. Every malformed
 * field is refused here with a readable message instead.
 */
function assertScalarTodoFields(item: object, origin: "addition" | "amendment"): void {
  const rec = item as Record<string, unknown>;
  const fail = (field: string, expected: string): never => {
    throw new Error(`review ${origin} ${field} must be ${expected}`);
  };
  if (rec.label !== undefined && (typeof rec.label !== "string" || rec.label.trim().length === 0)) {
    fail("label", "a non-empty string");
  }
  if (rec.kind !== undefined && typeof rec.kind !== "string") fail("kind", "a string");
  if (rec.status !== undefined && typeof rec.status !== "string") fail("status", "a string");
  if (rec.acceptance !== undefined && rec.acceptance !== null && typeof rec.acceptance !== "string") {
    fail("acceptance", "a string or null");
  }
  if (rec.owner !== undefined && rec.owner !== null && typeof rec.owner !== "string") {
    fail("owner", "a string or null");
  }
  if (
    rec.dependsOn !== undefined &&
    (!Array.isArray(rec.dependsOn) || rec.dependsOn.some((id) => typeof id !== "string"))
  ) {
    fail("dependsOn", "an array of todo ids");
  }
  if (
    rec.maxIterations !== undefined &&
    (typeof rec.maxIterations !== "number" || !Number.isInteger(rec.maxIterations) || rec.maxIterations <= 0)
  ) {
    fail("maxIterations", "a positive integer");
  }
}

/**
 * NX-45 / NX-46 : les étapes qu'une clôture doit exiger.
 *
 * La roadmap de la catégorie fournit sa liste ; la configuration peut y
 * ajouter `audit` et `converge` pour un projet qui veut la même discipline
 * partout. Fonction pure, donc testable sans base.
 */
export function closeStepsFor(
  categorySteps: readonly string[],
  closeConfig?: { requireAudit?: boolean; requireConverge?: boolean },
): string[] {
  const steps = [...categorySteps];
  const extra: string[] = [];
  if (closeConfig?.requireAudit === true) extra.push("audit");
  if (closeConfig?.requireConverge === true) extra.push("converge");
  for (const step of extra) {
    if (!steps.includes(step)) steps.push(step);
  }
  return steps;
}

export function reviewTask(db: DatabaseSync, options: { taskId: string } & ReviewDiff): ReviewOutcome {
  const task = getTask(db, options.taskId);
  if (!task) throw new Error(`unknown task: ${options.taskId}`);
  const additions = (options.additions ?? []).map((item) => {
    // String shorthand mirrors removals: a bare string is the todo's label.
    if (typeof item === "string" && item.trim().length > 0) return { label: item };
    if (typeof item === "object" && item !== null && typeof item.label === "string" && item.label.trim().length > 0) {
      assertScalarTodoFields(item, "addition");
      return item;
    }
    throw new Error("review addition must be a non-empty label string or a todo object with a non-empty label");
  });
  const amendments = (options.amendments ?? []).map((item) => {
    if (typeof item !== "object" || item === null || typeof item.id !== "string" || item.id.trim().length === 0) {
      throw new Error("review amendment must be an object with a non-empty id");
    }
    assertScalarTodoFields(item, "amendment");
    return item;
  });
  const removals = (options.removals ?? []).map((item) => {
    if (typeof item === "string" && item.trim().length > 0) return { id: item, reason: "" };
    if (typeof item === "object" && item !== null && typeof item.id === "string" && item.id.trim().length > 0) {
      return { id: item.id, reason: typeof item.reason === "string" ? item.reason : "" };
    }
    throw new Error("review removal must be a todo id string or an object with a non-empty id");
  });
  const order = options.order;
  if (order !== undefined && (!Array.isArray(order) || order.some((id) => typeof id !== "string" || id.trim().length === 0))) {
    throw new Error("review order must be an array of todo id strings");
  }
  db.exec("BEGIN");
  try {
    for (const { id, reason } of removals) {
      const target = getTodo(db, id);
      if (!target || target.task_id !== options.taskId) {
        throw new Error(`review removal targets a todo outside this task: ${id}`);
      }
      dropTodo(db, id, reason);
    }
    for (const change of amendments) {
      const { id, ...patch } = change;
      const target = getTodo(db, id);
      if (!target || target.task_id !== options.taskId) {
        throw new Error(`review amendment targets a todo outside this task: ${id}`);
      }
      amendTodo(db, id, patch);
    }
    for (const item of additions) insertTodo(db, options.taskId, item, "end");
    /*
     * NX-14 : un plan diff arrive avec un ordre calculé AVANT l'ajout. La
     * liste fournie ne contient donc pas les todos tout juste créés, et
     * `reorderTodos` exigeait chaque todo exactement une fois — la revue
     * échouait sur un diff parfaitement cohérent. Les nouveaux todos sont
     * désormais ajoutés à la fin de l'ordre demandé, dans leur ordre
     * d'insertion. Un ordre complet reste appliqué tel quel.
     */
    if (order) {
      const courants = listTodos(db, options.taskId).map((todo) => todo.id);
      const inconnus = order.filter((id) => !courants.includes(id));
      // Un identifiant étranger reste une erreur : seul l'ajout de la revue a
      // le droit de manquer à l'ordre, parce qu'il n'existait pas encore.
      if (inconnus.length > 0) {
        throw new Error(`review order targets todos outside this task: ${inconnus.join(", ")}`);
      }
      const demandes = new Set(order);
      const ordreComplet = [...order, ...courants.filter((id) => !demandes.has(id))];
      reorderTodos(db, options.taskId, ordreComplet);
    }
    const revision = task.revision + 1;
    const ts = nowIso();
    db.prepare(
      "UPDATE tasks SET revision = ?, reviewed_at = ?, edits_since_review = 0, todos_since_review = 0, updated_at = ? WHERE id = ?"
    ).run(revision, ts, ts, options.taskId);
    recordPlanChange(db, {
      taskId: options.taskId,
      action: "review",
      before: { revision: task.revision },
      after: {
        revision,
        additions: additions.length,
        amendments: amendments.length,
        removals: removals.length,
        reordered: Boolean(options.order),
      },
    });
    db.exec("COMMIT");
    const result = {
      task: requireTask(db, options.taskId),
      revision,
      applied: { additions: additions.length, amendments: amendments.length, removals: removals.length, reordered: Boolean(options.order) },
      signals: revisionSignals(db, options.taskId)
    };
    capture(db, "task-reviewed", `revision ${revision}`);
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
