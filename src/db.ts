import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pruneSessions } from "./ledger.ts";

export { DatabaseSync };

export function openDb(dbPath: string): DatabaseSync {
  const absolute = resolve(dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  if (process.platform !== "win32") {
    try {
      chmodSync(absolute, 0o600);
    } catch {
      // best effort, the umask may forbid it
    }
  }
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
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
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_invocations (
      session_id TEXT NOT NULL,
      skill TEXT NOT NULL,
      invoked_at TEXT NOT NULL,
      PRIMARY KEY (session_id, skill)
    );
    CREATE TABLE IF NOT EXISTS roadmap_progress (
      session_id TEXT NOT NULL,
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
      session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      reviewed_at TEXT,
      edits_since_review INTEGER NOT NULL DEFAULT 0,
      todos_since_review INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
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
  `);
  migrate(db);
  // H4: enforce the session TTL on every open — best effort, prune failures
  // must never break startup.
  try {
    pruneSessions(db);
  } catch {
    // sessions table may predate updated_at on very old installs; migrate covers it
  }
  return db;
}

// Table and column names are interpolated here, unlike every other query in the
// project, because SQLite does not parameterize identifiers. H8: the allowlist
// below makes the "fixed strings only" invariant structural — any future caller
// passing a non-listed identifier throws instead of injecting SQL.
const SAFE_TABLES = new Set([
  "meta",
  "skills",
  "categories",
  "rules",
  "sessions",
  "skill_invocations",
  "roadmap_progress",
  "enforcement_log",
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

export const SCHEMA_VERSION = 1;

function migrate(db: DatabaseSync): void {
  ensureColumn(db, "tasks", "revision", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "reviewed_at", "TEXT");
  ensureColumn(db, "tasks", "edits_since_review", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "todos_since_review", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}
