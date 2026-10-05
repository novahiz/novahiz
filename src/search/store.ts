// Full-text index store for Lodestone. One SQLite database per indexed
// workspace under `<NovahizHome>/.search/<sha12(root)>/index.db` — never
// inside the workspace itself.
//
//   files(path, size, mtimeMs)          stat manifest, drives incrementality
//   chunks(path, line, text, sub)       FTS5 rows, one per non-blank line
//   meta(key, value)                    built_at and friends
//
// Freshness is decided on stat alone (size + mtime), the same contract as
// the graph store: a search walks, diffs against `files`, re-chunks only the
// files that appear, change or disappear. The allowlist of extensions is the
// security boundary — logs, databases, lockfiles and `.env` are simply not
// walkable, so nothing indexed here can leak through a search hit.
// FTS5 is probed at every open: when the build lacks it, the same table is
// created as a plain table and queries degrade to LIKE (engine "like").

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { extname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { NovahizHome } from "../spec.ts";
import { expandLine } from "./tokenize.ts";

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage",
  ".git", ".next", ".nuxt", ".turbo", ".cache",
  // The default NovahizHome IS the novahiz repo: never index our own stores.
  ".graph", ".snap", ".search",
]);

/** Allowlist of indexable text/code extensions, lowercase with dot. */
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc",
  ".md", ".mdx", ".css", ".scss", ".less", ".html", ".htm", ".svg",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".dart",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".php", ".sh", ".ps1",
  ".yaml", ".yml", ".toml", ".xml", ".sql", ".graphql", ".gql",
  ".vue", ".svelte", ".astro", ".lua", ".r", ".pl", ".ex", ".exs",
  ".txt", ".ini", ".cfg", ".conf", ".csv",
]);

/** Exact basenames worth indexing despite having no extension. */
const TEXT_NAMES = new Set([
  "dockerfile", "makefile", "gemfile", "rakefile", "procfile",
  "license", "readme", "changelog", ".gitignore", ".gitattributes",
  ".editorconfig", ".prettierrc", ".eslintrc",
]);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_LINE_CHARS = 1000;
const BINARY_SNIFF_BYTES = 4096;

export type SearchEngine = "fts5" | "like";

export interface WalkedFile {
  /** Workspace-relative posix path (the key used everywhere). */
  path: string;
  /** Absolute native path (reading only). */
  abs: string;
  size: number;
  mtimeMs: number;
}

export interface SearchFreshness {
  stale: boolean;
  added: string[];
  changed: string[];
  removed: string[];
}

export interface SearchStatus {
  root: string;
  storePath: string;
  exists: boolean;
  stale: boolean;
  engine: SearchEngine;
  /** Number of files in the manifest. */
  files: number;
  /** Number of indexed lines. */
  rows: number;
  added: string[];
  changed: string[];
  removed: string[];
  /** ISO mtime of the database — when the index was last built. */
  builtAt: string | null;
}

const sha256 = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

/** Canonical root: forward slashes, no trailing slash (case preserved). */
function normalizeRoot(root: string): string {
  let p = String(root ?? "").replace(/\\/g, "/");
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function rootHash(root: string): string {
  const canonical = normalizeRoot(root);
  return sha256(process.platform === "win32" ? canonical.toLowerCase() : canonical).slice(0, 12);
}

/** `<NovahizHome>/.search/<sha12(root)>/index.db` — one index per workspace. */
export function searchStorePath(root: string): string {
  return join(NovahizHome(), ".search", rootHash(root), "index.db");
}

/** Lockfiles and generated manifests: noise, not signal. */
const SKIP_BASENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "cargo.lock", "composer.lock", "poetry.lock", "gemfile.lock",
  "npm-shrinkwrap.json", "deno.lock",
]);

function isIndexable(name: string): boolean {
  const base = name.toLowerCase();
  if (SKIP_BASENAMES.has(base)) return false;
  if (TEXT_NAMES.has(base)) return true;
  return TEXT_EXTS.has(extname(base));
}

/** Sorted, deterministic walk of indexable files. Allowlist only. */
export function walkFiles(root: string): WalkedFile[] {
  const out: WalkedFile[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isIndexable(entry.name)) continue;
      try {
        const st = statSync(abs);
        if (st.size > MAX_FILE_BYTES) continue;
        out.push({
          path: relative(root, abs).replace(/\\/g, "/"),
          abs,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        continue; // vanished mid-walk
      }
    }
  };
  walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/**
 * Open (and create when missing) the index database. Returns the engine the
 * build actually supports: FTS5 when the virtual table took, "like" when the
 * SQLite in this Node build lacks the module.
 */
function openDb(dbPath: string): { db: DatabaseSync; engine: SearchEngine } {
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      mtimeMs REAL NOT NULL
    )
  `);
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  let engine: SearchEngine = "fts5";
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
        path, line UNINDEXED, text, sub,
        tokenize = 'unicode61 remove_diacritics 1'
      )
    `);
  } catch {
    engine = "like";
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        path TEXT NOT NULL,
        line INTEGER NOT NULL,
        text TEXT NOT NULL,
        sub TEXT NOT NULL
      )
    `);
  }
  return { db, engine };
}

function detectEngine(db: DatabaseSync): SearchEngine {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'chunks'")
    .get() as { sql?: string } | undefined;
  return row?.sql !== undefined && /fts5/i.test(row.sql) ? "fts5" : "like";
}

function readManifest(db: DatabaseSync): Map<string, { size: number; mtimeMs: number }> {
  const rows = db.prepare("SELECT path, size, mtimeMs FROM files").all() as Array<{
    path: string;
    size: number;
    mtimeMs: number;
  }>;
  return new Map(rows.map((row) => [row.path, { size: row.size, mtimeMs: row.mtimeMs }]));
}

/** Stat-only freshness check: did any walkable file appear, change, disappear? */
export function searchFreshness(root: string): SearchFreshness {
  const dbPath = searchStorePath(root);
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  if (!existsSync(dbPath)) {
    return { stale: true, added: walkFiles(root).map((f) => f.path), changed, removed };
  }
  const { db } = openDb(dbPath);
  try {
    const manifest = readManifest(db);
    const seen = new Set<string>();
    for (const file of walkFiles(root)) {
      seen.add(file.path);
      const prior = manifest.get(file.path);
      if (!prior) added.push(file.path);
      else if (prior.size !== file.size || prior.mtimeMs !== file.mtimeMs) changed.push(file.path);
    }
    for (const path of manifest.keys()) {
      if (!seen.has(path)) removed.push(path);
    }
    return {
      stale: added.length > 0 || changed.length > 0 || removed.length > 0,
      added,
      changed,
      removed,
    };
  } finally {
    db.close();
  }
}

/** Drop and re-chunk every walkable file: the honest full rebuild. */
export function rebuildSearch(root: string): SearchStatus {
  const dbPath = searchStorePath(root);
  const { db, engine } = openDb(dbPath);
  try {
    const files = walkFiles(root);
    db.exec("BEGIN");
    try {
      db.exec("DELETE FROM chunks");
      db.exec("DELETE FROM files");
      for (const file of files) indexFile(db, file);
      stampBuiltAt(db);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
  return searchStatus(root, engine);
}

/**
 * The query entry point: build the index when it is missing or stale,
 * chunking only the files whose stat moved. Returns the status afterwards
 * plus `indexed` — whether this call actually (re)built anything.
 */
export function ensureSearchIndex(root: string): SearchStatus & { indexed: boolean } {
  const dbPath = searchStorePath(root);
  const { db, engine } = openDb(dbPath);
  try {
    const manifest = readManifest(db);
    const files = walkFiles(root);
    const seen = new Set<string>();
    const pending: WalkedFile[] = [];
    for (const file of files) {
      seen.add(file.path);
      const prior = manifest.get(file.path);
      if (!prior || prior.size !== file.size || prior.mtimeMs !== file.mtimeMs) {
        pending.push(file);
      }
    }
    const gone = [...manifest.keys()].filter((path) => !seen.has(path));
    if (pending.length === 0 && gone.length === 0 && manifest.size > 0) {
      return { ...searchStatus(root, engine), indexed: false };
    }
    db.exec("BEGIN");
    try {
      const drop = db.prepare("DELETE FROM chunks WHERE path = ?");
      const dropFile = db.prepare("DELETE FROM files WHERE path = ?");
      for (const path of gone) {
        drop.run(path);
        dropFile.run(path);
      }
      for (const file of pending) {
        drop.run(file.path);
        dropFile.run(file.path);
        indexFile(db, file);
      }
      stampBuiltAt(db);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ...searchStatus(root, engine), indexed: true };
  } finally {
    db.close();
  }
}

/** Chunk one file into per-line rows. Blank lines are not worth a row. */
function indexFile(db: DatabaseSync, file: WalkedFile): void {
  let content: Buffer;
  try {
    content = readFileSync(file.abs);
  } catch {
    return; // vanished between walk and read
  }
  if (content.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return; // binary
  const source = content.toString("utf8");
  const insert = db.prepare("INSERT INTO chunks (path, line, text, sub) VALUES (?, ?, ?, ?)");
  const record = db.prepare("INSERT INTO files (path, size, mtimeMs) VALUES (?, ?, ?)");
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    const text = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
    insert.run(file.path, i + 1, text, expandLine(text));
  }
  record.run(file.path, file.size, file.mtimeMs);
}

function stampBuiltAt(db: DatabaseSync): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('built_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(new Date().toISOString());
}

/** Read-only status: never rebuilds, reports drift from a stat-only walk. */
export function searchStatus(root: string, knownEngine?: SearchEngine): SearchStatus {
  const dbPath = searchStorePath(root);
  const base: SearchStatus = {
    root: normalizeRoot(root),
    storePath: dbPath,
    exists: false,
    stale: false,
    engine: knownEngine ?? "fts5",
    files: 0,
    rows: 0,
    added: [],
    changed: [],
    removed: [],
    builtAt: null,
  };
  if (!existsSync(dbPath)) {
    const walk = walkFiles(root);
    return { ...base, stale: true, added: walk.map((f) => f.path) };
  }
  const { db, engine } = openDb(dbPath);
  try {
    const freshness = searchFreshnessOn(db, root);
    const files = (db.prepare("SELECT count(*) AS c FROM files").get() as { c: number }).c;
    const rows = (db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number }).c;
    const built = db.prepare("SELECT value FROM meta WHERE key = 'built_at'").get() as
      | { value: string }
      | undefined;
    return {
      ...base,
      exists: true,
      engine: knownEngine ?? engine,
      stale: freshness.stale,
      files,
      rows,
      added: freshness.added,
      changed: freshness.changed,
      removed: freshness.removed,
      builtAt: built?.value ?? null,
    };
  } finally {
    db.close();
  }
}

/** Same diff as `searchFreshness`, reusing an already-open database. */
function searchFreshnessOn(db: DatabaseSync, root: string): SearchFreshness {
  const manifest = readManifest(db);
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const file of walkFiles(root)) {
    seen.add(file.path);
    const prior = manifest.get(file.path);
    if (!prior) added.push(file.path);
    else if (prior.size !== file.size || prior.mtimeMs !== file.mtimeMs) changed.push(file.path);
  }
  for (const path of manifest.keys()) {
    if (!seen.has(path)) removed.push(path);
  }
  return { stale: added.length > 0 || changed.length > 0 || removed.length > 0, added, changed, removed };
}

/** Open handle for the search layer (query.ts): caller closes it. */
export function openSearchDb(root: string): { db: DatabaseSync; engine: SearchEngine } {
  return openDb(searchStorePath(root));
}
