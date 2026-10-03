// Query layer for the six MCP graph tools. Each function takes an explicit
// workspace root, auto-indexes it (ensureGraph — incremental, stat-first) and
// returns plain JSON-ready data: index.mjs only validates the parameters and
// serializes. Read-only for the workspace; all writes stay in the home store.
//
//   graphFind      symbol declarations by name (exact → case-insensitive → substring)
//   graphFindAll   every masked identifier occurrence, grep-like (from objects)
//   graphTrace     blast radius: callers/callees in N hops, uncertain edges flagged
//   graphFileApi   signatures-only view of one file + exports/imports
//   graphRepoMap   aggregated tree of the workspace
//   graphFreshness drift check (never rebuilds unless explicitly asked)

import { statSync } from "node:fs";

import type { SymbolKind } from "./extract.ts";
import type { CallEdge, Confidence, GraphData } from "./resolve.ts";
import { fileLevelCallersTo, resolveSpecifier, traceFrom } from "./resolve.ts";
import { ensureGraph, graphStatus, readFileIndex } from "./store.ts";
import type { GraphStatus } from "./store.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const MAX_DEPTH = 5;
const MAX_MAP_DEPTH = 6;
const MAX_FINDALL_LINES_PER_FILE = 50;

export interface SymbolRef {
  id: number;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  endLine: number;
  signature: string;
  exported: boolean;
  enclosing: string | null;
}

export interface FindResult {
  query: string;
  total: number;
  hits: SymbolRef[];
}

export interface FindAllResult {
  query: string;
  files: number;
  occurrences: number;
  results: Array<{ file: string; count: number; lines: number[]; linesTruncated: boolean }>;
  unavailable: string[];
}

export interface TraceHitRef extends SymbolRef {
  hops: number;
  confidence?: Confidence;
  uncertain?: boolean;
  count?: number;
}

export interface TraceResult {
  start: SymbolRef | null;
  matchCount: number;
  /** Non-empty only when the name matched several symbols and no file narrowed it. */
  candidates: SymbolRef[];
  direction: "callers" | "callees" | "both";
  depth: number;
  callers: TraceHitRef[];
  callees: TraceHitRef[];
  moduleCallers: Array<{ file: string; count: number }>;
}

export interface FileApiResult {
  found: boolean;
  candidates: string[];
  file: {
    path: string;
    kind: "code" | "markdown";
    lines: number;
    symbolCount: number;
    imports: string[];
    hash: string;
  } | null;
  detailAvailable: boolean;
  exports: string[];
  imports: Array<{
    raw: string;
    resolved: string | null;
    line: number;
    dynamic: boolean;
    bindings: Array<{ local: string; imported: string; typeOnly: boolean }>;
  }>;
  definitions: SymbolRef[];
}

export interface RepoMapResult {
  prefix: string;
  totals: { files: number; symbols: number; lines: number; fileCount: number };
  /** Workspace-level call statistics (not scoped to the prefix). */
  stats: GraphData["stats"];
  tree: RepoMapNode[];
}

export interface RepoMapNode {
  kind: "dir" | "file";
  name: string;
  path: string;
  symbols: number;
  lines: number;
  fileCount?: number;
  children?: RepoMapNode[];
}

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

function ref(graph: GraphData, id: number): SymbolRef {
  const s = graph.symbols[id];
  return {
    id,
    name: s.name,
    kind: s.kind,
    file: graph.files[s.file].path,
    line: s.line,
    endLine: s.endLine,
    signature: s.signature,
    exported: s.exported,
    enclosing: s.enclosing,
  };
}

/** Name-only symbol pick: unique hit, first-by-line when a file narrowed it. */
function resolveStart(graph: GraphData, name: string, file?: string): { id: number; matchCount: number; candidates: number[] } {
  // hasOwn guard: `constructor`/`toString` must not read Object.prototype.
  const ids = Object.hasOwn(graph.byName, name) ? graph.byName[name] : [];
  if (file !== undefined && file.length > 0) {
    const wanted = file.replace(/\\/g, "/").toLowerCase();
    const scoped = ids
      .filter((id) => graph.files[graph.symbols[id].file].path.toLowerCase().includes(wanted))
      .sort((a, b) => graph.symbols[a].line - graph.symbols[b].line);
    if (scoped.length > 0) return { id: scoped[0], matchCount: scoped.length, candidates: [] };
    return { id: -1, matchCount: 0, candidates: [] };
  }
  if (ids.length === 1) return { id: ids[0], matchCount: 1, candidates: [] };
  if (ids.length === 0) return { id: -1, matchCount: 0, candidates: [] };
  return { id: -1, matchCount: ids.length, candidates: ids };
}

export interface FindOptions {
  query: string;
  kind?: string;
  file?: string;
  limit?: number;
}

export function graphFind(root: string, opts: FindOptions): FindResult {
  const graph = ensureGraph(validRoot(root));
  const query = String(opts.query ?? "").trim();
  if (query.length === 0) throw new Error("Invalid params: query must be a non-empty string");
  const limit = clamp(opts.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const lowered = query.toLowerCase();
  const kinds = opts.kind
    ? new Set(opts.kind.split(",").map((k) => k.trim()).filter((k) => k.length > 0))
    : null;
  const fileFilter = opts.file ? String(opts.file).replace(/\\/g, "/").toLowerCase() : null;

  const scored: Array<{ id: number; rank: number }> = [];
  for (const [name, ids] of Object.entries(graph.byName)) {
    const folded = name.toLowerCase();
    const rank = name === query ? 0 : folded === lowered ? 1 : folded.includes(lowered) ? 2 : -1;
    if (rank < 0) continue;
    for (const id of ids) {
      const s = graph.symbols[id];
      if (kinds !== null && !kinds.has(s.kind)) continue;
      if (fileFilter !== null && !graph.files[s.file].path.toLowerCase().includes(fileFilter)) continue;
      scored.push({ id, rank });
    }
  }
  const pathOf = (id: number): string => graph.files[graph.symbols[id].file].path;
  scored.sort((a, b) =>
    a.rank - b.rank ||
    (pathOf(a.id) < pathOf(b.id) ? -1 : pathOf(a.id) > pathOf(b.id) ? 1 : 0) ||
    graph.symbols[a.id].line - graph.symbols[b.id].line);
  return {
    query,
    total: scored.length,
    hits: scored.slice(0, limit).map((entry) => ref(graph, entry.id)),
  };
}

export interface FindAllOptions {
  query: string;
  file?: string;
}

export function graphFindAll(root: string, opts: FindAllOptions): FindAllResult {
  const graph = ensureGraph(validRoot(root));
  const query = String(opts.query ?? "").trim();
  if (query.length === 0) throw new Error("Invalid params: query must be a non-empty string");
  const fileFilter = opts.file ? String(opts.file).replace(/\\/g, "/").toLowerCase() : null;

  const occurrenceIdx = Object.hasOwn(graph.inverted, query) ? graph.inverted[query] : [];
  const files = occurrenceIdx
    .map((idx) => graph.files[idx])
    .filter((f) => fileFilter === null || f.path.toLowerCase().includes(fileFilter));

  const results: FindAllResult["results"] = [];
  const unavailable: string[] = [];
  let occurrences = 0;
  for (const file of files) {
    const index = readFileIndex(graph.root, file.path);
    if (!index) {
      unavailable.push(file.path);
      continue;
    }
    const nameIdx = index.identNames.indexOf(query);
    if (nameIdx < 0) continue;
    const lines = new Set<number>();
    let count = 0;
    for (const [ni, line] of index.idents) {
      if (ni !== nameIdx) continue;
      count++;
      lines.add(line);
    }
    if (count === 0) continue;
    occurrences += count;
    const sorted = [...lines].sort((a, b) => a - b);
    results.push({
      file: file.path,
      count,
      lines: sorted.slice(0, MAX_FINDALL_LINES_PER_FILE),
      linesTruncated: sorted.length > MAX_FINDALL_LINES_PER_FILE,
    });
  }
  return { query, files: results.length, occurrences, results, unavailable };
}

export interface TraceOptions {
  symbol: string;
  file?: string;
  direction?: "callers" | "callees" | "both";
  depth?: number;
  limit?: number;
}

export function graphTrace(root: string, opts: TraceOptions): TraceResult {
  const graph = ensureGraph(validRoot(root));
  const name = String(opts.symbol ?? "").trim();
  if (name.length === 0) throw new Error("Invalid params: symbol must be a non-empty string");
  const direction = opts.direction === "callers" || opts.direction === "callees" ? opts.direction : "both";
  const depth = clamp(opts.depth, 1, 0, MAX_DEPTH);
  const limit = clamp(opts.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const start = resolveStart(graph, name, opts.file);
  const base: TraceResult = {
    start: start.id >= 0 ? ref(graph, start.id) : null,
    matchCount: start.matchCount,
    candidates: start.candidates.map((id) => ref(graph, id)),
    direction,
    depth,
    callers: [],
    callees: [],
    moduleCallers: [],
  };
  if (start.id < 0) return base;

  // Direct-edge confidence is attached to first-hop hits only; deeper hops
  // stay hop-counts (the edge that reached them belongs to their own step).
  const directCallees = new Map<number, CallEdge>();
  const directCallers = new Map<number, CallEdge>();
  for (const edge of graph.calls) {
    if (edge.caller === start.id) directCallees.set(edge.callee, edge);
    else if (edge.callee === start.id && edge.caller >= 0) {
      const prior = directCallers.get(edge.caller);
      if (!prior || edge.confidence !== prior.confidence && rankConf(edge.confidence) < rankConf(prior.confidence)) {
        directCallers.set(edge.caller, edge);
      }
    }
  }

  const decorate = (hits: ReturnType<typeof traceFrom>, by: Map<number, CallEdge>): TraceHitRef[] =>
    hits.slice(0, limit).map((hit) => {
      const out: TraceHitRef = { ...ref(graph, hit.symbol), hops: hit.hops };
      if (hit.hops === 1) {
        const edge = by.get(hit.symbol);
        if (edge) {
          out.confidence = edge.confidence;
          out.uncertain = edge.uncertain;
          out.count = edge.count;
        }
      }
      return out;
    });

  if (direction === "callers" || direction === "both") {
    base.callers = decorate(traceFrom(graph, start.id, "callers", depth), directCallers);
    base.moduleCallers = fileLevelCallersTo(graph, start.id).map((site) => ({
      file: graph.files[site.file].path,
      count: site.count,
    }));
  }
  if (direction === "callees" || direction === "both") {
    base.callees = decorate(traceFrom(graph, start.id, "callees", depth), directCallees);
  }
  return base;
}

function rankConf(confidence: Confidence): number {
  return confidence === "local" ? 0 : confidence === "import" ? 1 : confidence === "unique" ? 2 : 3;
}

export interface FileApiOptions {
  file: string;
}

export function graphFileApi(root: string, opts: FileApiOptions): FileApiResult {
  const graph = ensureGraph(validRoot(root));
  const wanted = String(opts.file ?? "").trim();
  if (wanted.length === 0) throw new Error("Invalid params: file must be a non-empty string");
  const folded = wanted.replace(/\\/g, "/").toLowerCase();

  const matches = graph.files.filter((f) => f.path.toLowerCase() === folded);
  const fallback = matches.length > 0
    ? matches
    : graph.files.filter((f) => f.path.toLowerCase().includes(folded));
  if (fallback.length !== 1) {
    return {
      found: false,
      candidates: fallback.slice(0, 20).map((f) => f.path),
      file: null,
      detailAvailable: false,
      exports: [],
      imports: [],
      definitions: [],
    };
  }

  const file = fallback[0];
  const known = new Set(graph.files.map((f) => f.path));
  const index = readFileIndex(graph.root, file.path);
  const definitions = graph.symbols
    .map((_, id) => id)
    .filter((id) => graph.symbols[id].file === graph.files.indexOf(file))
    .map((id) => ref(graph, id))
    .sort((a, b) => a.line - b.line);

  return {
    found: true,
    candidates: [],
    file: {
      path: file.path,
      kind: file.kind,
      lines: file.lines,
      symbolCount: file.symbolCount,
      imports: file.imports,
      hash: file.hash,
    },
    detailAvailable: index !== null,
    exports: index?.exports ?? [],
    imports: (index?.imports ?? []).map((imp) => ({
      raw: imp.raw,
      resolved: resolveSpecifier(file.path, imp.raw, known),
      line: imp.line,
      dynamic: imp.dynamic,
      bindings: imp.bindings.map((b) => ({ local: b.local, imported: b.imported, typeOnly: b.typeOnly })),
    })),
    definitions,
  };
}

export interface RepoMapOptions {
  path?: string;
  depth?: number;
}

interface RawDir {
  name: string;
  dirs: Map<string, RawDir>;
  files: Array<{ name: string; path: string; symbols: number; lines: number }>;
  symbols: number;
  lines: number;
  fileCount: number;
}

export function graphRepoMap(root: string, opts: RepoMapOptions): RepoMapResult {
  const graph = ensureGraph(validRoot(root));
  const maxDepth = clamp(opts.depth, 3, 1, MAX_MAP_DEPTH);
  const prefixRaw = String(opts.path ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  const prefix = prefixRaw.length > 0 ? `${prefixRaw}/` : "";

  const selected = graph.files.filter((f) => prefix.length === 0 || f.path.startsWith(prefix));

  const top: RawDir = { name: "", dirs: new Map(), files: [], symbols: 0, lines: 0, fileCount: 0 };
  for (const file of selected) {
    top.symbols += file.symbolCount;
    top.lines += file.lines;
    top.fileCount++;
    const parts = file.path.split("/");
    let current = top;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = current.dirs.get(parts[i]);
      if (!next) {
        next = { name: parts[i], dirs: new Map(), files: [], symbols: 0, lines: 0, fileCount: 0 };
        current.dirs.set(parts[i], next);
      }
      next.symbols += file.symbolCount;
      next.lines += file.lines;
      next.fileCount++;
      current = next;
    }
    current.files.push({
      name: parts[parts.length - 1],
      path: file.path,
      symbols: file.symbolCount,
      lines: file.lines,
    });
  }

  const byName = (a: { name: string }, b: { name: string }): number =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

  const serialize = (dir: RawDir, level: number, parentPath: string): RepoMapNode => {
    const path = dir.name === "" ? "" : parentPath === "" ? dir.name : `${parentPath}/${dir.name}`;
    const node: RepoMapNode = {
      kind: "dir",
      name: dir.name === "" ? "." : dir.name,
      path,
      symbols: dir.symbols,
      lines: dir.lines,
      fileCount: dir.fileCount,
    };
    if (level < maxDepth) {
      const children: RepoMapNode[] = [...dir.dirs.values()]
        .sort(byName)
        .map((child) => serialize(child, level + 1, path));
      for (const file of [...dir.files].sort(byName)) {
        children.push({ kind: "file", name: file.name, path: file.path, symbols: file.symbols, lines: file.lines });
      }
      children.sort(byName);
      node.children = children;
    }
    return node;
  };

  return {
    prefix,
    totals: { files: selected.length, symbols: top.symbols, lines: top.lines, fileCount: top.fileCount },
    stats: graph.stats,
    tree: serialize(top, 0, "").children ?? [],
  };
}

export interface FreshnessOptions {
  rebuild?: boolean;
}

/**
 * Drift check. By default it never writes: it reports what a stat-only walk
 * sees versus the manifest, so it can honestly answer "is the index stale?".
 * `rebuild: true` opts into the incremental reindex and returns the status
 * afterwards.
 */
export function graphFreshness(root: string, opts: FreshnessOptions = {}): GraphStatus {
  const normalized = validRoot(root);
  if (opts.rebuild === true) ensureGraph(normalized);
  return graphStatus(normalized);
}
