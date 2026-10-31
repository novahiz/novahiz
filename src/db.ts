import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pruneSessions } from "./ledger.ts";
import { capture } from "./snap.ts";

export { DatabaseSync };

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/**
 * Open (and migrate) the ledger.
 *
 * `capture: false` hands the snapshot over to the caller: `novahiz snap save`
 * wants the manifest to carry *its* operation and message, not whatever this
 * function would have labelled it. By default a snapshot is taken when opening
 * changed something real — a schema that did not exist yet, or rows pruning
 * removed — and never otherwise, so a label always describes what happened.
 */
export function openDb(dbPath: string, opts: { capture?: boolean } = {}): DatabaseSync {
  const absolute = resolve(dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  // Checked before the CREATE TABLE block below: a ledger this process has
  // never seen is about to have a schema built into it.
  const fresh = !tableExists(db, "skills");
  if (process.platform !== "win32") {
    try {
      chmodSync(absolute, 0o600);
    } catch {
      // best effort, the umask may forbid it
    }
  }
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_path TEXT,
      power INTEGER NOT NULL DEFAULT 3,
      stars INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      categories TEXT NOT NULL DEFAULT '[]',
      scanned_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      keywords TEXT NOT NULL DEFAULT '[]',
      default_skills TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent TEXT,
      categories TEXT NOT NULL DEFAULT '[]',
      required_skills TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      prompt TEXT,
      tier TEXT
    );
    CREATE TABLE IF NOT EXISTS skill_invocations (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      skill TEXT NOT NULL,
      invoked_at TEXT NOT NULL,
      PRIMARY KEY (session_id, skill)
    );
    CREATE TABLE IF NOT EXISTS roadmap_progress (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'done',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, step_id)
    );
    CREATE TABLE IF NOT EXISTS enforcement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      tool TEXT,
      file_path TEXT,
      file_class TEXT,
      decision TEXT,
      missing TEXT NOT NULL DEFAULT '[]',
      matched_rules TEXT NOT NULL DEFAULT '[]',
      logged_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      reviewed_at TEXT,
      edits_since_review INTEGER NOT NULL DEFAULT 0,
      todos_since_review INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'edit',
      status TEXT NOT NULL DEFAULT 'pending',
      acceptance TEXT,
      proof TEXT,
      owner TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      iterations INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS enforcement_log_logged_at ON enforcement_log(logged_at);
    CREATE INDEX IF NOT EXISTS enforcement_log_session ON enforcement_log(session_id);
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_root TEXT,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      exit_code INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      output_tail TEXT NOT NULL DEFAULT '',
      hash TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evidence_created_at ON evidence(created_at);
    CREATE INDEX IF NOT EXISTS evidence_session ON evidence(session_id);
    CREATE TABLE IF NOT EXISTS file_claims (
      path_key TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project_root TEXT,
      reason TEXT,
      claimed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS file_claims_session ON file_claims(session_id);
    CREATE INDEX IF NOT EXISTS file_claims_expiry ON file_claims(expires_at);
    CREATE TABLE IF NOT EXISTS plan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS plan_history_task ON plan_history(task_id, id);
    CREATE TABLE IF NOT EXISTS project_sessions (
      project_root TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_root, session_id)
    );
    CREATE INDEX IF NOT EXISTS project_sessions_updated ON project_sessions(updated_at);
    -- NX-43: a subagent runs in its own session id inside the same tree.
    -- Without the link, the gate sees a stranger (competing for claims) or an
    -- heir (inheriting them) depending on nothing at all.
    CREATE TABLE IF NOT EXISTS session_links (
      child_id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_links_parent ON session_links(parent_id);
    CREATE INDEX IF NOT EXISTS todos_task_id ON todos(task_id);
    CREATE INDEX IF NOT EXISTS tasks_status_session ON tasks(status, session_id);
    CREATE INDEX IF NOT EXISTS skill_invocations_session ON skill_invocations(session_id);
    CREATE INDEX IF NOT EXISTS roadmap_progress_session ON roadmap_progress(session_id);
  `);
  migrate(db);
  // H4: enforce the session TTL on every open — best effort, prune failures
  // must never break startup.
  try {
    const pruned = pruneSessions(db);
    if (opts.capture !== false) {
      // Capture only what opening actually changed. An unconditional capture
      // here labelled whatever write it found on disk as session pruning —
      // and stole the snapshot `novahiz snap save` was about to take.
      if (pruned > 0) capture(db, "prune-sessions");
      else if (fresh) capture(db, "init");
    }
  } catch {
    // sessions table may predate updated_at on very old installs; migrate covers it
  }
  return db;
}

// Table and column names are interpolated here, unlike every other query in the
// project, because SQLite does not parameterize identifiers. H8: the allowlist
// below makes the "fixed strings only" invariant structural — any future caller
// passing a non-listed identifier throws instead of injecting SQL.
export const SAFE_TABLES = new Set([
  "meta",
  "skills",
  "categories",
  "rules",
  "sessions",
  "skill_invocations",
  "roadmap_progress",
  "enforcement_log",
  "evidence",
  "file_claims",
  "plan_history",
  "project_sessions",
  "session_links",
  "tasks",
  "todos"
]);
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeIdentifier(kind: string, value: string): void {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`unsafe SQL ${kind}: ${value}`);
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  if (!SAFE_TABLES.has(table)) throw new Error(`unexpected table name: ${table}`);
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  if (!SAFE_TABLES.has(table)) throw new Error(`unexpected table name: ${table}`);
  assertSafeIdentifier("column", column);
  if (tableColumns(db, table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

export const SCHEMA_VERSION = 7;

function migrate(db: DatabaseSync): void {
  // v3: the last non-trivial classification of a session survives a plugin
  // restart and lets "continue" / "ok" resume the task instead of failing open.
  ensureColumn(db, "sessions", "prompt", "TEXT");
  ensureColumn(db, "sessions", "tier", "TEXT");
  ensureColumn(db, "tasks", "revision", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "reviewed_at", "TEXT");
  ensureColumn(db, "tasks", "edits_since_review", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "todos_since_review", "INTEGER NOT NULL DEFAULT 0");
  // F: the project a task belongs to — ledger edits are filtered against it so
  // one project's plan never counts or blocks another project's files. NULL on
  // legacy tasks keeps the previous unscoped owner behaviour.
  ensureColumn(db, "tasks", "project_root", "TEXT");
  // v4: the novahiz-task contract already asked for a size and a proof on every
  // step; the tool only accepted label/kind/acceptance/owner, so the contract
  // existed in prose only. `size` is the missing half; the proof is enforced in
  // completeTodo. `closing_proof` records how the task itself was closed.
  ensureColumn(db, "todos", "size", "TEXT");
  ensureColumn(db, "tasks", "closing_proof", "TEXT");
  // v5: the ledger is shared by every project on the machine. Evidence and
  // claims carry the project they belong to, so listing one project's proofs
  // never shows another's.
  ensureColumn(db, "evidence", "project_root", "TEXT");
  ensureColumn(db, "file_claims", "project_root", "TEXT");
  // v6: a task remembers the category it was opened under, so closing it can
  // demand the non-optional roadmap steps that category enforces. NULL on legacy
  // tasks keeps the previous behaviour (no roadmap check).
  ensureColumn(db, "tasks", "category", "TEXT");
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}
