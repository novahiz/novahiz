import type { ComplexityTier } from "./complexity.ts";
import type { DatabaseSync } from "./db.ts";

/**
 * Persisted classification of the last non-trivial task of a session.
 *
 * Before this module existed the plugin kept the categories in memory only:
 * after a restart, or on a trivial follow-up such as "continue" / "ok", the
 * session fell back to `general/trivial` and the gate allowed every edit with
 * `missing: []`. The row is the same source of truth the CLI gate reads when
 * the plugin has no in-memory categories left.
 */
export type SessionClassification = {
  session: string;
  categories: string[];
  requiredSkills: string[];
  tier: ComplexityTier;
  prompt: string;
  updatedAt: string;
};

/** Same validation as `session-load` / `session-state`. */
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * A trivial prompt only continues the previous task while that task is still
 * warm. Without a bound, an "ok" typed days later would resurrect a finished
 * audit roadmap; past the window the prompt is classified on its own.
 */
export const CONTINUATION_TTL_MS = 6 * 60 * 60 * 1000;

export function isValidSessionId(session: string): boolean {
  return SESSION_ID_PATTERN.test(session);
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function parseTier(value: unknown): ComplexityTier {
  return value === "lite" || value === "full" ? value : "trivial";
}

export function readSessionClassification(db: DatabaseSync, session: string): SessionClassification | null {
  const row = db
    .prepare("SELECT categories, required_skills, prompt, tier, updated_at FROM sessions WHERE id = ?")
    .get(session) as
    | { categories?: string; required_skills?: string; prompt?: string | null; tier?: string | null; updated_at?: string }
    | undefined;
  if (!row) return null;
  const categories = parseStringArray(row.categories);
  if (categories.length === 0) return null;
  return {
    session,
    categories,
    requiredSkills: parseStringArray(row.required_skills),
    tier: parseTier(row.tier),
    prompt: typeof row.prompt === "string" ? row.prompt : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : ""
  };
}

export function writeSessionClassification(
  db: DatabaseSync,
  state: Omit<SessionClassification, "updatedAt">
): void {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, categories, required_skills, updated_at, prompt, tier)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       categories = excluded.categories,
       required_skills = excluded.required_skills,
       updated_at = excluded.updated_at,
       prompt = excluded.prompt,
       tier = excluded.tier`
  ).run(
    state.session,
    JSON.stringify(state.categories),
    JSON.stringify(state.requiredSkills),
    updatedAt,
    state.prompt,
    state.tier
  );
}

/** True when a fresh trivial prompt should inherit `state`'s classification. */
export function isContinuation(state: SessionClassification, now: number = Date.now()): boolean {
  if (state.tier === "trivial" || state.prompt.trim().length === 0) return false;
  const updated = Date.parse(state.updatedAt);
  if (!Number.isFinite(updated)) return false;
  return now - updated <= CONTINUATION_TTL_MS;
}
