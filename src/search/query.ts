// Query layer for Lodestone's full-text search. One function, one contract:
// `searchLines` auto-indexes the workspace (ensureSearchIndex — incremental,
// stat-first), runs the MATCH expression built by tokenize.ts, and returns
// plain JSON-ready hits. Read-only for the workspace; all writes stay in the
// home store under `.search/`.

import { statSync } from "node:fs";

import { buildMatchQuery } from "./tokenize.ts";
import { ensureSearchIndex, openSearchDb } from "./store.ts";
import type { SearchEngine } from "./store.ts";

export interface SearchHit {
  path: string;
  line: number;
  /** The indexed line, whitespace-collapsed and capped. */
  text: string;
  /** bm25 rank (lower is better) — 0 on the LIKE fallback. */
  rank: number;
}

export interface SearchResult {
  query: string;
  engine: SearchEngine;
  /** Total matching rows before the limit. */
  total: number;
  hits: SearchHit[];
  /** True when the result set was cut by the limit. */
  truncated: boolean;
  /** True when the index was (re)built to answer this query. */
  indexed: boolean;
  /** True when the AND query found nothing and the OR fallback ran. */
  fallback: boolean;
}

export interface SearchOptions {
  query: string;
  /** Restrict to paths containing this fragment. */
  file?: string;
  /** Maximum hits (default 20, max 100). */
  limit?: number;
  /** Prefix-match the last term (default false). */
  prefix?: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SNIPPET = 300;

function validRoot(root: string): string {
  const value = String(root ?? "").trim();
  if (value.length === 0) throw new Error("Invalid params: root must be a non-empty string");
  let st;
  try {
    st = statSync(value);
  } catch {
    throw new Error("Invalid params: root not found");
  }
  if (!st.isDirectory()) throw new Error("Invalid params: root is not a directory");
  return value;
}

function clamp(value: unknown, def: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return def;
  return Math.min(Math.max(Math.trunc(Number(value)), min), max);
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_SNIPPET ? `${collapsed.slice(0, MAX_SNIPPET)}…` : collapsed;
}

/**
 * Full-text search over the indexed workspace. AND semantics by default;
 * when an AND query finds nothing and the query has several terms, the OR
 * fallback runs once and the result says so (`fallback: true`).
 */
export function searchLines(root: string, opts: SearchOptions): SearchResult {
  const normalized = validRoot(root);
  const query = String(opts.query ?? "").trim();
  if (query.length === 0) throw new Error("Invalid params: query must be a non-empty string");
  const limit = clamp(opts.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const fileFilter = opts.file ? String(opts.file).replace(/\\/g, "/").toLowerCase() : null;

  const status = ensureSearchIndex(normalized);
  const { db, engine } = openSearchDb(normalized);
  try {
    const built = buildMatchQuery(query, { prefix: opts.prefix === true });
    if (built === null) throw new Error("Invalid params: query must contain letters or digits");

    if (engine === "fts5") {
      const where = fileFilter
        ? "WHERE chunks MATCH ? AND path LIKE ? ESCAPE '\\'"
        : "WHERE chunks MATCH ?";
      const params: Array<string | number> = fileFilter
        ? [built.expr, `%${likeEscape(fileFilter)}%`]
        : [built.expr];
      const total = (
        db.prepare(`SELECT count(*) AS c FROM chunks ${where}`).get(...params) as { c: number }
      ).c;
      const rows = db
        .prepare(
          `SELECT path, line, text, bm25(chunks, 5.0, 0.0, 1.0, 0.75) AS rank
           FROM chunks ${where} ORDER BY rank LIMIT ?`
        )
        .all(...params, limit + 1) as Array<{ path: string; line: number; text: string; rank: number }>;

      let hits = rows.slice(0, limit).map((row) => ({
        path: row.path,
        line: row.line,
        text: snippet(row.text),
        rank: Math.round(row.rank * 1000) / 1000,
      }));
      let fallback = false;
      if (hits.length === 0 && built.terms.length > 1) {
        const orQuery = buildMatchQuery(query, { prefix: opts.prefix === true, op: "OR" });
        if (orQuery !== null) {
          const orParams: Array<string | number> = fileFilter
            ? [orQuery.expr, `%${likeEscape(fileFilter)}%`]
            : [orQuery.expr];
          const orRows = db
            .prepare(
              `SELECT path, line, text, bm25(chunks, 5.0, 0.0, 1.0, 0.75) AS rank
               FROM chunks ${where} ORDER BY rank LIMIT ?`
            )
            .all(...orParams, limit) as Array<{ path: string; line: number; text: string; rank: number }>;
          hits = orRows.map((row) => ({
            path: row.path,
            line: row.line,
            text: snippet(row.text),
            rank: Math.round(row.rank * 1000) / 1000,
          }));
          fallback = true;
        }
      }
      return {
        query,
        engine,
        total,
        hits,
        truncated: rows.length > limit,
        indexed: status.indexed,
        fallback,
      };
    }

    // LIKE fallback: same columns, no ranking. AND of per-term LIKEs.
    const terms = built.terms;
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    for (const term of terms) {
      const pattern = `%${likeEscape(term)}%`;
      clauses.push("(text LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR sub LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern, pattern);
    }
    if (fileFilter) {
      clauses.push("path LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(fileFilter)}%`);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = db
      .prepare(`SELECT path, line, text FROM chunks ${where} ORDER BY path, line LIMIT ?`)
      .all(...params, limit + 1) as Array<{ path: string; line: number; text: string }>;
    const hits = rows.slice(0, limit).map((row) => ({
      path: row.path,
      line: row.line,
      text: snippet(row.text),
      rank: 0,
    }));
    return {
      query,
      engine,
      total: hits.length,
      hits,
      truncated: rows.length > limit,
      indexed: status.indexed,
      fallback: false,
    };
  } finally {
    db.close();
  }
}
