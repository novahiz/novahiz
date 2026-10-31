/**
 * Live-session detection per project.
 *
 * The most expensive incident of this project's history was not a bug: it was
 * two agents editing the same worktree — 72 uncommitted entries that belonged to
 * somebody else, and a commit that absorbed four staged renames. File claims
 * (src/claims.ts) stop the collision once it is declared; this module answers the
 * earlier question: "is somebody else already working here?"
 *
 * A session counts as live when it left a trace in this project recently: a
 * task, a claimed path, or recorded evidence. The ledger is shared by every
 * project, so the project root is what scopes the search.
 */
import { dirname, join, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

import type { DatabaseSync } from "./db.ts";

export const DEFAULT_LIVE_WINDOW_MINUTES = 90;

export type LiveSession = {
  session: string;
  /** Most recent trace, ISO string. */
  lastActivity: string;
  /** What proved the session is/was active here. */
  sources: string[];
};

function projectRoots(projectRoot: string): string[] {
  const raw = resolve(projectRoot);
  const key = process.platform === "win32" ? raw.toLowerCase() : raw;
  return [...new Set([raw, key])];
}

/** Is this directory the root of a project (a `.git` or a `package.json`)? */
export function isProjectRoot(dir: string): boolean {
  return existsSync(join(dir, ".git")) || existsSync(join(dir, "package.json"));
}

/**
 * The project a file belongs to.
 *
 * Measured 2026-10-29: `commandGate` recorded `process.cwd()`, which for the
 * plugin daemon is the directory opencode was started from — the user home —
 * so every project under it collapsed into one key and `otherSessions` could
 * report a conflict between two unrelated projects. The edited path says which
 * project it is; walk up to the nearest `.git` or `package.json` and use that.
 */
export function projectRootForPath(filePath: string): string {
  let dir = resolve(filePath);
  // The path may be a file that does not exist yet (a new document): start from
  // its directory when the file itself is not a directory.
  try {
    if (!statSync(dir).isDirectory()) dir = dirname(dir);
  } catch {
    dir = dirname(dir);
  }
  const start = dir;
  for (let depth = 0; depth < 8; depth += 1) {
    if (isProjectRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}


function minutesSince(iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - parsed) / 60_000);
}

export function activeSessionsOnProject(
  db: DatabaseSync,
  options: { projectRoot: string; excludeSession?: string | null; windowMinutes?: number },
): LiveSession[] {
  const windowMinutes = Math.max(Number(options.windowMinutes) || DEFAULT_LIVE_WINDOW_MINUTES, 1);
  const roots = projectRoots(options.projectRoot);
  const placeholders = roots.map(() => "?").join(", ");
  const bySession = new Map<string, { at: string; sources: Set<string> }>();

  const add = (session: unknown, at: unknown, source: string): void => {
    const id = typeof session === "string" ? session : "";
    if (id.length === 0) return;
    if (options.excludeSession && id === options.excludeSession) return;
    const timestamp = typeof at === "string" ? at : "";
    if (timestamp.length === 0 || minutesSince(timestamp) > windowMinutes) return;
    const entry = bySession.get(id) ?? { at: timestamp, sources: new Set<string>() };
    if (timestamp > entry.at) entry.at = timestamp;
    entry.sources.add(source);
    bySession.set(id, entry);
  };

  const tasks = db
    .prepare(`SELECT session_id, updated_at FROM tasks WHERE project_root IN (${placeholders}) AND session_id IS NOT NULL`)
    .all(...roots) as { session_id: string; updated_at: string }[];
  for (const row of tasks) add(row.session_id, row.updated_at, "task");

  const claims = db
    .prepare(`SELECT session_id, claimed_at FROM file_claims WHERE project_root IN (${placeholders})`)
    .all(...roots) as { session_id: string; claimed_at: string }[];
  for (const row of claims) add(row.session_id, row.claimed_at, "claim");

  const evidence = db
    .prepare(`SELECT session_id, created_at FROM evidence WHERE project_root IN (${placeholders}) AND session_id IS NOT NULL`)
    .all(...roots) as { session_id: string; created_at: string }[];
  for (const row of evidence) add(row.session_id, row.created_at, "evidence");

  // The gate records the id of every session that makes a gated call, so an
  // active session shows up even before it creates a task or claims a file.
  const seenByGate = db
    .prepare(`SELECT session_id, updated_at FROM project_sessions WHERE project_root IN (${placeholders})`)
    .all(...roots) as { session_id: string; updated_at: string }[];
  for (const row of seenByGate) add(row.session_id, row.updated_at, "gate");

  return [...bySession.entries()]
    .map(([session, entry]) => ({ session, lastActivity: entry.at, sources: [...entry.sources].sort() }))
    .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
}

/**
 * The session currently driving this project, as observed by the gate.
 *
 * MCP tools never receive the OpenCode session id, so the records they create
 * end up with `session_id = NULL` and escape per-session accounting. The gate
 * does see the id on every gated call, so it records it here; tools fall back to
 * that value when the caller passes none.
 *
 * It never guesses: with two live sessions inside the window the answer is null
 * plus the candidates, because attributing a proof to the wrong session is worse
 * than leaving it unattributed.
 */
export function recordProjectSession(
  db: DatabaseSync,
  projectRoot: string,
  session: string,
  at = new Date().toISOString(),
): void {
  if (session.trim().length === 0) return;
  const roots = projectRoots(projectRoot);
  const key = roots[roots.length - 1];
  db.prepare(
    `INSERT INTO project_sessions (project_root, session_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_root, session_id) DO UPDATE SET updated_at = excluded.updated_at`,
  ).run(key, session, at);
  // Best-effort housekeeping: a day of history is plenty to resolve a default.
  db.prepare("DELETE FROM project_sessions WHERE updated_at < ?").run(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
}

export function defaultSessionForProject(
  db: DatabaseSync,
  options: { projectRoot: string; windowMinutes?: number },
): { session: string | null; candidates: string[] } {
  const windowMinutes = Math.max(Number(options.windowMinutes) || 15, 1);
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const roots = projectRoots(options.projectRoot);
  const key = roots[roots.length - 1];
  const rows = db
    .prepare("SELECT session_id FROM project_sessions WHERE project_root = ? AND updated_at >= ? ORDER BY updated_at DESC")
    .all(key, cutoff) as { session_id: string }[];
  const candidates = [...new Set(rows.map((row) => row.session_id))];
  return { session: candidates.length === 1 ? candidates[0] : null, candidates };
}

/** One sentence a caller can show without further formatting. */
export function worktreeHint(sessions: LiveSession[], current: string): string | null {
  if (sessions.length === 0) return null;
  const names = sessions.map((entry) => entry.session).join(", ");
  return (
    `Another session is active on this project (${names}). ` +
    `Two agents in one worktree cost a contaminated commit last time. ` +
    `Either claim your paths with novahiz_claim, or open a worktree and work there ` +
    `(opencode.worktree_create) instead of editing the same tree as ${current}.`
  );
}
