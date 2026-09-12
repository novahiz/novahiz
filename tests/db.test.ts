import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, openDb } from "../src/db.ts";

const dbPath = join(tmpdir(), `novahiz-migrate-${Date.now().toString(36)}.sqlite`);

test("openDb records the schema version and the log indexes", () => {
  const ownPath = join(tmpdir(), `novahiz-schema-${Date.now().toString(36)}.sqlite`);
  const db = openDb(ownPath);
  const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
  assert.equal(version.user_version, 1);
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>
  ).map((row) => row.name);
  assert.ok(names.includes("enforcement_log_logged_at"));
  assert.ok(names.includes("enforcement_log_session"));
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${ownPath}${suffix}`, { force: true });
    } catch {
      // best effort cleanup
    }
  }
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      // best effort cleanup
    }
  }
});

test("openDb backfills the task review columns on an older database", () => {
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"
  );
  legacy.close();

  const db = openDb(dbPath);
  const columns = new Set(
    (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((row) => row.name)
  );
  db.close();

  for (const column of ["revision", "reviewed_at", "edits_since_review", "todos_since_review"]) {
    assert.ok(columns.has(column), `expected tasks.${column} to be backfilled`);
  }
});

test("openDb keeps existing rows when it backfills columns", () => {
  const legacy = new DatabaseSync(dbPath);
  legacy.prepare("INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    "t_keep",
    "kept",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  );
  legacy.close();

  const db = openDb(dbPath);
  const row = db.prepare("SELECT id, title, revision FROM tasks WHERE id = ?").get("t_keep") as
    | { id: string; title: string; revision: number }
    | undefined;
  db.close();

  assert.equal(row?.title, "kept");
  assert.equal(row?.revision, 0);
});
