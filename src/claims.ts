/**
 * File claims: say out loud which session owns which paths.
 *
 * Two agents in the same worktree is the default reality here, and it produced
 * the worst incident of the last session: 72 uncommitted entries that belonged
 * to somebody else, a commit that absorbed four staged renames, and a test row
 * written to the shared database. The ledger can already declare `owner` globs
 * per todo, but nothing prevented two sessions from planning the same files.
 *
 * A claim is deliberately narrow: a path, a session, an expiry. It is not a
 * lock on the whole repo and it never rewrites anybody's work. The gate reads
 * it and refuses an edit on a path another session still holds.
 */
import { isAbsolute, relative, resolve } from "node:path";

import type { DatabaseSync } from "./db.ts";

export const DEFAULT_CLAIM_TTL_MINUTES = 30;
export const MAX_CLAIM_TTL_MINUTES = 240;

export type ClaimRow = {
  path_key: string;
  path: string;
  session_id: string;
  project_root: string | null;
  reason: string | null;
  claimed_at: string;
  expires_at: string;
};

export type ClaimConflict = {
  path: string;
  session: string;
  reason: string | null;
  expiresAt: string;
  minutesLeft: number;
};

function pathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function projectKey(projectRoot: string): string {
  const absolute = resolve(projectRoot);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function nowIso(): string {
  return new Date().toISOString();
}

function purgeExpired(db: DatabaseSync, now = nowIso()): number {
  return Number(db.prepare("DELETE FROM file_claims WHERE expires_at <= ?").run(now).changes);
}

/**
 * Claim paths for a session. Paths already held by the same session are
 * refreshed; paths held by another live session are returned as conflicts and
 * left untouched. All-or-nothing is a deliberate choice: a partial claim would
 * make the caller believe it owns files it does not.
 */
export function claimPaths(
  db: DatabaseSync,
  input: { session: string; paths: string[]; ttlMinutes?: number; reason?: string; projectRoot?: string },
): { claimed: string[]; conflicts: ClaimConflict[]; expiresAt: string } {
  if (input.session.trim().length === 0) throw new Error("claim requires a session id");
  const paths = [...new Set(input.paths.map((entry) => entry.trim()).filter(Boolean))];
  if (paths.length === 0) throw new Error("claim requires at least one path");
  const ttl = Math.min(
    Math.max(Number(input.ttlMinutes) || DEFAULT_CLAIM_TTL_MINUTES, 1),
    MAX_CLAIM_TTL_MINUTES,
  );
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  purgeExpired(db, now);

  const conflicts: ClaimConflict[] = [];
  const available: string[] = [];
  const lookup = db.prepare("SELECT * FROM file_claims WHERE path_key = ?");
  for (const filePath of paths) {
    const row = lookup.get(pathKey(filePath)) as ClaimRow | undefined;
    if (!row || row.session_id === input.session || row.expires_at <= now) {
      available.push(filePath);
      continue;
    }
    const minutesLeft = Math.max(
      0,
      Math.ceil((Date.parse(row.expires_at) - Date.now()) / 60_000),
    );
    conflicts.push({
      path: row.path,
      session: row.session_id,
      reason: row.reason,
      expiresAt: row.expires_at,
      minutesLeft,
    });
  }
  if (conflicts.length > 0) {
    return { claimed: [], conflicts, expiresAt };
  }

  db.exec("SAVEPOINT claim_sp");
  try {
    const upsert = db.prepare(
      `INSERT INTO file_claims (path_key, path, session_id, project_root, reason, claimed_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path_key) DO UPDATE SET
         session_id = excluded.session_id,
         project_root = excluded.project_root,
         reason = excluded.reason,
         claimed_at = excluded.claimed_at,
         expires_at = excluded.expires_at`,
    );
    const scope = input.projectRoot ? projectKey(input.projectRoot) : null;
    for (const filePath of available) {
      upsert.run(pathKey(filePath), resolve(filePath), input.session, scope, input.reason ?? null, now, expiresAt);
    }
    db.exec("RELEASE claim_sp");
  } catch (error) {
    db.exec("ROLLBACK TO claim_sp");
    throw error;
  }
  return { claimed: available.map((filePath) => resolve(filePath)), conflicts, expiresAt };
}

/** Release only the claims the caller actually owns. */
export function releasePaths(
  db: DatabaseSync,
  input: { session: string; paths?: string[] },
): { released: string[] } {
  if (input.session.trim().length === 0) throw new Error("release requires a session id");
  const keys = (input.paths ?? []).map(pathKey);
  const rows = (
    keys.length > 0
      ? db.prepare("SELECT * FROM file_claims WHERE session_id = ?").all(input.session)
      : db.prepare("SELECT * FROM file_claims WHERE session_id = ?").all(input.session)
  ) as ClaimRow[];
  const owned = keys.length > 0 ? rows.filter((row) => keys.includes(row.path_key)) : rows;
  const remove = db.prepare("DELETE FROM file_claims WHERE path_key = ? AND session_id = ?");
  const released: string[] = [];
  for (const row of owned) {
    if (Number(remove.run(row.path_key, input.session).changes) > 0) released.push(row.path);
  }
  return { released };
}

export function listClaims(db: DatabaseSync, options: { projectRoot?: string } = {}): ClaimRow[] {
  purgeExpired(db);
  if (options.projectRoot) {
    return db
      .prepare("SELECT * FROM file_claims WHERE project_root = ? ORDER BY claimed_at DESC")
      .all(projectKey(options.projectRoot)) as unknown as ClaimRow[];
  }
  return db.prepare("SELECT * FROM file_claims ORDER BY claimed_at DESC").all() as unknown as ClaimRow[];
}

/** The claim blocking `filePath` for `session`, if any. */
export function conflictingClaim(
  db: DatabaseSync,
  input: { session: string; filePath: string; family?: ReadonlySet<string> },
): ClaimRow | null {
  if (input.session.trim().length === 0) return null;
  const row = db
    .prepare("SELECT * FROM file_claims WHERE path_key = ? AND expires_at > ?")
    .get(pathKey(input.filePath), nowIso()) as ClaimRow | undefined;
  if (!row) return null;
  if (row.session_id === input.session) return null;
  // NX-43: a claim held by a parent or a delegated child is the same work, not
  // a conflict. Without this, a subagent would be refused the files its own
  // parent just claimed.
  if (input.family?.has(row.session_id)) return null;
  return row;
}

/** The live claim any session of `sessions` holds on `filePath`, if any. */
export function claimedByAny(
  db: DatabaseSync,
  input: { sessions: Iterable<string>; filePath: string },
): ClaimRow | null {
  const ids = [...input.sessions].filter((id) => id.trim().length > 0);
  if (ids.length === 0) return null;
  const placeholders = ids.map(() => "?").join(", ");
  const row = db
    .prepare(`SELECT * FROM file_claims WHERE path_key = ? AND expires_at > ? AND session_id IN (${placeholders})`)
    .get(pathKey(input.filePath), nowIso(), ...ids) as ClaimRow | undefined;
  return row ?? null;
}

/**
 * NX-42 : une commande de migration est une action destructive sans chemin.
 *
 * `supabase db push` ou `prisma migrate deploy` n'editent aucun fichier : le
 * contrôle de claim par chemin ne les voit jamais. Deux sessions peuvent donc
 * appliquer la même migration sans se croiser. La détection est volontairement
 * étroite — seules les commandes qui écrivent le schéma — pour ne pas bloquer
 * un `db lint` ou un `migrate status`.
 */
const MIGRATION_COMMANDS = [
  /^supabase\s+db\s+(push|reset)\b/i,
  /^npx\s+supabase\s+db\s+(push|reset)\b/i,
  /^prisma\s+migrate\s+(deploy|dev|reset)\b/i,
  /^npx\s+prisma\s+migrate\s+(deploy|dev|reset)\b/i,
  /^drizzle-kit\s+(push|migrate)\b/i,
  /^npx\s+drizzle-kit\s+(push|migrate)\b/i,
  /^alembic\s+(upgrade|downgrade)\b/i,
  /^flyway\s+migrate\b/i
];

export function migrationCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim();
  return MIGRATION_COMMANDS.some((pattern) => pattern.test(normalized));
}

/** The live claim this session holds on `filePath`, if any. */
export function claimedBy(
  db: DatabaseSync,
  input: { session: string; filePath: string },
): ClaimRow | null {
  if (input.session.trim().length === 0) return null;
  const row = db
    .prepare("SELECT * FROM file_claims WHERE path_key = ? AND session_id = ? AND expires_at > ?")
    .get(pathKey(input.filePath), input.session, nowIso()) as ClaimRow | undefined;
  return row ?? null;
}

/** True when `candidate` lives inside `root`. Used to refuse claims outside a project. */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}
