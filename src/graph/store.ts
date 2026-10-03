// Content-addressed index store for `novahiz graph`. Everything lives under
// `<NovahizHome>/.graph/<sha12(root)>/` — never inside the indexed workspace:
//
//   manifest.json                  path → { sha256, size, mtimeMs }
//   graph.json                     materialized GraphData (atomic tmp→rename)
//   files/<aa>/<sha256>.json.gz    deduplicated FileIndex objects (gzip)
//
// Freshness is decided on stat alone (size + mtime). A stale store triggers
// an incremental rebuild: unchanged files reuse their object, changed and new
// files are re-extracted, deleted files drop out, and objects nobody
// references anymore are garbage-collected. `ensureGraph` = load, stat-check,
// rebuild only when needed — that is the auto-index at the first stale query.
// If an object listed in the manifest is lost, the file is re-extracted
// (self-healing); a corrupt graph.json falls back to a full rebuild.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { NovahizHome } from "../spec.ts";
import { extractFile, extractMarkdown } from "./extract.ts";
import type { FileIndex } from "./extract.ts";
import { buildGraph } from "./resolve.ts";
import type { GraphData, WorkspaceFile } from "./resolve.ts";

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage",
  ".git", ".next", ".nuxt", ".turbo", ".cache",
  // The default NovahizHome IS the novahiz repo — never index our own stores.
  ".graph", ".snap",
]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const MD_EXT = ".md";

export interface ManifestEntry {
  sha256: string;
  size: number;
  mtimeMs: number;
}

export interface GraphManifest {
  version: 1;
  root: string;
  /** Indexing-relative posix path → content record. Insertion order is the sorted walk order. */
  files: Record<string, ManifestEntry>;
}

export interface WalkedFile {
  /** Workspace-relative posix path (the key used everywhere). */
  path: string;
  /** Absolute native path (reading only). */
  abs: string;
  size: number;
  mtimeMs: number;
}

export interface FreshnessDiff {
  stale: boolean;
  added: string[];
  changed: string[];
  removed: string[];
}

export interface GraphStatus {
  storeDir: string;
  exists: boolean;
  stale: boolean;
  total: number;
  added: string[];
  changed: string[];
  removed: string[];
  /** ISO mtime of graph.json — when the store was last built. */
  builtAt: string | null;
}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

/** Canonical root: forward slashes, no trailing slash (case preserved). */
export function normalizeRoot(root: string): string {
  let p = root.replace(/\\/g, "/");
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function rootHash(root: string): string {
  const canonical = normalizeRoot(root);
  return sha256(process.platform === "win32" ? canonical.toLowerCase() : canonical).slice(0, 12);
}

/** `<NovahizHome>/.graph/<sha12(root)>` — one store per indexed workspace. */
export function graphStoreDir(root: string): string {
  return join(NovahizHome(), ".graph", rootHash(root));
}

function objectPath(storeDir: string, sha: string): string {
  return join(storeDir, "files", sha.slice(0, 2), `${sha}.json.gz`);
}

function atomicWrite(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** Sorted, deterministic walk of the indexable workspace files. */
export function walkWorkspace(root: string): WalkedFile[] {
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
      const ext = extname(entry.name).toLowerCase();
      if (!CODE_EXTS.has(ext) && ext !== MD_EXT) continue;
      try {
        const st = statSync(abs);
        out.push({ path: relative(root, abs).replace(/\\/g, "/"), abs, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        continue; // vanished mid-walk
      }
    }
  };
  walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

function readManifest(storeDir: string): GraphManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(join(storeDir, "manifest.json"), "utf8")) as GraphManifest;
    if (parsed.version !== 1 || typeof parsed.files !== "object" || parsed.files === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The materialized graph, or null when absent/corrupt (triggers a rebuild). */
export function readGraph(root: string): GraphData | null {
  try {
    const parsed = JSON.parse(readFileSync(join(graphStoreDir(root), "graph.json"), "utf8")) as GraphData;
    if (parsed.version !== 1 || !Array.isArray(parsed.files) || !Array.isArray(parsed.symbols)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Detail loader for one workspace path: its FileIndex straight from the
 * content-addressed object store (raw imports, exports, identifier
 * occurrences with positions). Returns null when the manifest has no entry —
 * callers keep working off graph.json in that case.
 */
export function readFileIndex(root: string, path: string): FileIndex | null {
  const storeDir = graphStoreDir(normalizeRoot(root));
  const manifest = readManifest(storeDir);
  const entry = manifest?.files[path];
  if (!entry) return null;
  return readObject(storeDir, entry.sha256, path);
}

function readObject(storeDir: string, sha: string, path: string): FileIndex | null {
  try {
    const idx = JSON.parse(gunzipSync(readFileSync(objectPath(storeDir, sha))).toString("utf8")) as FileIndex;
    // Dedup: identical content shared by two paths carries the first path it
    // was extracted with — retag on load, the structure is content-derived.
    idx.path = path;
    return idx;
  } catch {
    return null;
  }
}

function writeObject(storeDir: string, sha: string, idx: FileIndex): void {
  const target = objectPath(storeDir, sha);
  if (existsSync(target)) return; // content already stored (dedup)
  mkdirSync(dirname(target), { recursive: true });
  atomicWrite(target, gzipSync(Buffer.from(JSON.stringify(idx), "utf8")));
}

function gcObjects(storeDir: string, keep: Record<string, ManifestEntry>): void {
  const referenced = new Set(Object.values(keep).map((e) => e.sha256));
  const shardsDir = join(storeDir, "files");
  let shards: string[];
  try {
    shards = readdirSync(shardsDir);
  } catch {
    return;
  }
  for (const shard of shards) {
    let objects: string[];
    try {
      objects = readdirSync(join(shardsDir, shard));
    } catch {
      continue;
    }
    for (const object of objects) {
      const sha = object.replace(/\.json\.gz$/, "");
      if (!referenced.has(sha)) rmSync(join(shardsDir, shard, object), { force: true });
    }
  }
}

/** Stat-only freshness check: did any file appear, change or disappear? */
export function diffFreshness(root: string, walk?: WalkedFile[]): FreshnessDiff {
  const files = walk ?? walkWorkspace(root);
  const manifest = readManifest(graphStoreDir(root));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const w of files) {
    seen.add(w.path);
    const prior = manifest?.files[w.path];
    if (!prior) added.push(w.path);
    else if (prior.size !== w.size || prior.mtimeMs !== w.mtimeMs) changed.push(w.path);
  }
  if (manifest) {
    for (const path of Object.keys(manifest.files)) {
      if (!seen.has(path)) removed.push(path);
    }
  }
  const stale = added.length > 0 || changed.length > 0 || removed.length > 0 || readGraph(root) === null;
  return { stale, added, changed, removed };
}

export function graphStatus(root: string): GraphStatus {
  const normalized = normalizeRoot(root);
  const storeDir = graphStoreDir(normalized);
  const walk = walkWorkspace(normalized);
  const diff = diffFreshness(normalized, walk);
  let builtAt: string | null = null;
  try {
    builtAt = new Date(statSync(join(storeDir, "graph.json")).mtimeMs).toISOString();
  } catch {
    builtAt = null;
  }
  return {
    storeDir,
    exists: builtAt !== null,
    stale: diff.stale,
    total: walk.length,
    added: diff.added,
    changed: diff.changed,
    removed: diff.removed,
    builtAt,
  };
}

/**
 * Incremental (or first) build of the store. Unchanged files — by stat — are
 * reloaded from their object, everything else is re-extracted from content.
 * Writes manifest.json and graph.json atomically, then GCs orphan objects.
 */
export function rebuildGraph(root: string, walk?: WalkedFile[]): GraphData {
  const normalized = normalizeRoot(root);
  const storeDir = graphStoreDir(normalized);
  const files = walk ?? walkWorkspace(normalized);
  const manifest = readManifest(storeDir);

  const entries: WorkspaceFile[] = [];
  const nextFiles: Record<string, ManifestEntry> = {};

  for (const w of files) {
    const prior = manifest?.files[w.path];
    if (prior && prior.size === w.size && prior.mtimeMs === w.mtimeMs) {
      const reused = readObject(storeDir, prior.sha256, w.path);
      if (reused) {
        entries.push({ index: reused, hash: prior.sha256, size: prior.size });
        nextFiles[w.path] = prior;
        continue;
      }
      // Object lost (or corrupt): fall through and re-extract — self-healing.
    }
    let content: Buffer;
    try {
      content = readFileSync(w.abs);
    } catch {
      continue; // vanished between walk and read
    }
    const hash = sha256(content);
    const source = content.toString("utf8");
    const idx = extname(w.path).toLowerCase() === MD_EXT
      ? extractMarkdown(w.path, source)
      : extractFile(w.path, source);
    writeObject(storeDir, hash, idx);
    entries.push({ index: idx, hash, size: content.length });
    nextFiles[w.path] = { sha256: hash, size: content.length, mtimeMs: w.mtimeMs };
  }

  const graph = buildGraph(normalized, entries);
  gcObjects(storeDir, nextFiles);
  atomicWrite(join(storeDir, "manifest.json"), JSON.stringify({ version: 1, root: normalized, files: nextFiles }));
  atomicWrite(join(storeDir, "graph.json"), JSON.stringify(graph));
  return graph;
}

/**
 * The query entry point: return the stored graph when every stat still
 * matches, rebuild incrementally otherwise (missing store included).
 */
export function ensureGraph(root: string): GraphData {
  const normalized = normalizeRoot(root);
  const existing = readGraph(normalized);
  const walk = walkWorkspace(normalized);
  const diff = diffFreshness(normalized, walk);
  if (existing !== null && !diff.stale) return existing;
  return rebuildGraph(normalized, walk);
}
