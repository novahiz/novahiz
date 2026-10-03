// Resolution and graph materialization for `novahiz graph`.
//
// A call site becomes an edge only when one of these rules identifies its
// target (documented in docs/GRAPH.md, in evaluation order):
//
//   bare / this.-qualified      dotted chain (non-this)
//   ─────────────────────       ─────────────────────────────────────
//   1. local   (same file)      1. import (first segment is a binding)
//   2. import  (name binding)   2. local  (same file, member-like)
//   3. unique  (1 in workspace) 3. method (exactly 1 member in workspace)
//                               4. unique (1 symbol in workspace)
//
// Ambiguous sites (>1 candidate where the receiver is unknown) become NO
// edge — they are counted in `stats.ambiguous`; sites with no candidate at
// all (external calls included) land in `stats.unresolved`. Edges born from
// name-only evidence (rules "unique"/"method") carry `uncertain: true` so
// consumers can present them with a caveat.
//
// Everything here is pure and deterministic: same input, byte-identical
// GraphData (no timestamps).

import type { FileIndex, SymbolKind } from "./extract.ts";

export type Confidence = "local" | "import" | "unique" | "method";

export interface GraphFile {
  path: string;
  dir: string;
  kind: "code" | "markdown";
  hash: string;
  size: number;
  lines: number;
  symbolCount: number;
  /** Resolved internal import targets (workspace files only). */
  imports: string[];
}

export interface GraphSymbolNode {
  name: string;
  kind: SymbolKind;
  file: number;
  line: number;
  endLine: number;
  signature: string;
  exported: boolean;
  enclosing: string | null;
  modifiers: string[];
  heritage: string[];
}

export interface CallEdge {
  /** Originating symbol id, or -1 for module-level call sites. */
  caller: number;
  callee: number;
  /** Origin file (the caller's file, or the module-level site's file). */
  file: number;
  count: number;
  confidence: Confidence;
  /** True when the edge rests on name-only evidence (unique/method). */
  uncertain: boolean;
  /** True when every aggregated site is a `new` expression. */
  viaNew: boolean;
}

export interface GraphStats {
  sites: number;
  resolved: number;
  local: number;
  import: number;
  unique: number;
  method: number;
  ambiguous: number;
  unresolved: number;
}

export interface GraphData {
  version: 1;
  root: string;
  files: GraphFile[];
  symbols: GraphSymbolNode[];
  /** Symbol name → symbol ids (file order, then declaration order). */
  byName: Record<string, number[]>;
  /** Identifier name → file indices containing it (for find_all). */
  inverted: Record<string, number[]>;
  calls: CallEdge[];
  stats: GraphStats;
}

export interface WorkspaceFile {
  index: FileIndex;
  hash: string;
  size: number;
}

export interface TraceHit {
  symbol: number;
  hops: number;
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const MEMBER_KINDS = new Set<SymbolKind>(["method", "constructor", "getter", "setter"]);
const CONFIDENCE_RANK: Record<Confidence, number> = { local: 0, import: 1, unique: 2, method: 3 };

/** Normalize a posix path: drop `.` segments, resolve `..` (never above root). */
export function normalizePosix(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Resolve a relative specifier against a known workspace file set.
 * Returns the workspace path, or null for bare specifiers (node:, react…)
 * and for files outside the index.
 */
export function resolveSpecifier(fromPath: string, raw: string, known: Set<string>): string | null {
  if (!raw.startsWith("./") && !raw.startsWith("../")) return null;
  const slash = fromPath.lastIndexOf("/");
  const base = slash >= 0 ? fromPath.slice(0, slash) : "";
  const target = normalizePosix(base === "" ? raw : `${base}/${raw}`);
  const candidates = [target];
  for (const ext of EXTENSIONS) candidates.push(target + ext);
  for (const ext of EXTENSIONS) candidates.push(`${target}/index${ext}`);
  for (const c of candidates) if (known.has(c)) return c;
  return null;
}

interface Resolved {
  id: number;
  confidence: Confidence;
}

/**
 * Build the materialized graph from extracted file indexes. `entries` may be
 * in any order — they are sorted by path first, so the output is
 * deterministic.
 */
export function buildGraph(root: string, entries: WorkspaceFile[]): GraphData {
  const sorted = [...entries].sort((a, b) =>
    a.index.path < b.index.path ? -1 : a.index.path > b.index.path ? 1 : 0);
  const known = new Set(sorted.map((e) => e.index.path));

  const files: GraphFile[] = [];
  const symbols: GraphSymbolNode[] = [];
  const byName: Record<string, number[]> = {};
  const fileSymbols: number[][] = [];

  sorted.forEach((entry, fileIdx) => {
    const idx = entry.index;
    const slash = idx.path.lastIndexOf("/");
    const dir = slash >= 0 ? idx.path.slice(0, slash) : "";
    const imports: string[] = [];
    const seen = new Set<string>();
    for (const imp of idx.imports) {
      const target = resolveSpecifier(idx.path, imp.raw, known);
      if (target !== null && !seen.has(target)) {
        seen.add(target);
        imports.push(target);
      }
    }
    files.push({
      path: idx.path,
      dir,
      kind: idx.kind,
      hash: entry.hash,
      size: entry.size,
      lines: idx.lines,
      symbolCount: idx.symbols.length,
      imports,
    });
    const own: number[] = [];
    fileSymbols.push(own);
    for (const s of idx.symbols) {
      const id = symbols.length;
      symbols.push({
        name: s.name,
        kind: s.kind,
        file: fileIdx,
        line: s.line,
        endLine: s.endLine,
        signature: s.signature,
        exported: s.exported,
        enclosing: s.enclosing,
        modifiers: s.modifiers,
        heritage: s.heritage,
      });
      own.push(id);
      // hasOwn guard: a symbol named `constructor`/`toString` must not read
      // Object.prototype — the bucket would be a function, not an array.
      const bucket = Object.hasOwn(byName, s.name) ? byName[s.name] : undefined;
      if (bucket) bucket.push(id);
      else byName[s.name] = [id];
    }
  });

  const pathToIdx = new Map<string, number>();
  files.forEach((f, i) => pathToIdx.set(f.path, i));

  // Import bindings per file: local name → target file + imported name.
  const importBindings: Array<Map<string, { file: number; imported: string }>> = [];
  sorted.forEach((entry, fileIdx) => {
    const map = new Map<string, { file: number; imported: string }>();
    for (const imp of entry.index.imports) {
      const target = resolveSpecifier(entry.index.path, imp.raw, known);
      if (target === null) continue;
      const tIdx = pathToIdx.get(target);
      if (tIdx === undefined) continue;
      for (const b of imp.bindings) {
        if (!map.has(b.local)) map.set(b.local, { file: tIdx, imported: b.imported });
      }
    }
    importBindings.push(map);
  });

  const findByNameInFile = (fileIdx: number, name: string): number | null => {
    for (const id of fileSymbols[fileIdx]) {
      if (symbols[id].name === name) return id;
    }
    return null;
  };

  const findDefault = (fileIdx: number): number | null => {
    for (const id of fileSymbols[fileIdx]) {
      if (symbols[id].modifiers.includes("default") || symbols[id].name === "default") return id;
    }
    return null;
  };

  const stats: GraphStats = {
    sites: 0, resolved: 0, local: 0, import: 0, unique: 0, method: 0, ambiguous: 0, unresolved: 0,
  };
  const edgeMap = new Map<string, CallEdge>();

  sorted.forEach((entry, fileIdx) => {
    const idx = entry.index;
    for (const site of idx.calls) {
      stats.sites++;

      // Caller: the nearest named enclosing scope that is a symbol of this file.
      let caller = -1;
      if (site.enclosing !== null) {
        caller = findByNameInFile(fileIdx, site.enclosing) ?? -1;
      }

      // Normalize the chain: `this.foo` is always local, a dotted chain
      // carries the receiver's first segment for import resolution.
      let chain: string | null = site.chain;
      let viaThis = false;
      if (chain !== null && chain.startsWith("this.")) {
        viaThis = true;
        chain = chain.slice(5);
      }
      const dotted = chain !== null && chain.includes(".");
      const firstSegment = chain !== null ? chain.split(".")[0] : null;
      const name = site.name;

      let resolved: Resolved | "ambiguous" | null = null;

      if (dotted && !viaThis) {
        // 1. the receiver is an import binding → its file holds the member.
        const binding = firstSegment !== null ? importBindings[fileIdx].get(firstSegment) : undefined;
        if (binding) {
          const t = findByNameInFile(binding.file, name);
          if (t !== null) resolved = { id: t, confidence: "import" };
        }
        // 2. same-file member (receiver typed locally — no type info, best effort).
        if (resolved === null) {
          const t = findByNameInFile(fileIdx, name);
          if (t !== null) resolved = { id: t, confidence: "local" };
        }
        // 3. exactly one member with that name in the workspace → method.
        if (resolved === null) {
          const candidates = Object.hasOwn(byName, name) ? byName[name] : [];
          const members = candidates.filter((id) => MEMBER_KINDS.has(symbols[id].kind));
          if (members.length === 1) resolved = { id: members[0], confidence: "method" };
          else if (members.length > 1) resolved = "ambiguous";
          else if (candidates.length === 1) resolved = { id: candidates[0], confidence: "unique" };
          else if (candidates.length > 1) resolved = "ambiguous";
        }
      } else {
        // 1. local (also covers `this.` and unqualified same-file methods).
        const t = findByNameInFile(fileIdx, name);
        if (t !== null) resolved = { id: t, confidence: "local" };
        // 2. import binding (default / named / namespace).
        if (resolved === null && !viaThis) {
          const binding = importBindings[fileIdx].get(name);
          if (binding) {
            const target = binding.imported === "default"
              ? findDefault(binding.file)
              : findByNameInFile(binding.file, binding.imported === "*" ? name : binding.imported);
            if (target !== null) resolved = { id: target, confidence: "import" };
          }
        }
        // 3. exactly one symbol with that name in the workspace → unique.
        if (resolved === null) {
          const candidates = Object.hasOwn(byName, name) ? byName[name] : [];
          if (candidates.length === 1) resolved = { id: candidates[0], confidence: "unique" };
          else if (candidates.length > 1) resolved = "ambiguous";
        }
      }

      if (resolved === null) {
        stats.unresolved++;
        continue;
      }
      if (resolved === "ambiguous") {
        stats.ambiguous++;
        continue;
      }

      stats.resolved++;
      stats[resolved.confidence]++;
      const key = `${caller}:${resolved.id}:${fileIdx}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.count++;
        if (CONFIDENCE_RANK[resolved.confidence] < CONFIDENCE_RANK[existing.confidence]) {
          existing.confidence = resolved.confidence;
          existing.uncertain = resolved.confidence === "unique" || resolved.confidence === "method";
        }
        existing.viaNew = existing.viaNew && site.newCall;
      } else {
        edgeMap.set(key, {
          caller,
          callee: resolved.id,
          file: fileIdx,
          count: 1,
          confidence: resolved.confidence,
          uncertain: resolved.confidence === "unique" || resolved.confidence === "method",
          viaNew: site.newCall,
        });
      }
    }
  });

  const calls = [...edgeMap.values()].sort((a, b) =>
    a.caller - b.caller || a.file - b.file || a.callee - b.callee);

  const inverted: Record<string, number[]> = {};
  sorted.forEach((entry, fileIdx) => {
    for (const n of entry.index.identNames) {
      const bucket = Object.hasOwn(inverted, n) ? inverted[n] : undefined;
      if (bucket) bucket.push(fileIdx);
      else inverted[n] = [fileIdx];
    }
  });

  return { version: 1, root, files, symbols, byName, inverted, calls, stats };
}

function pushAdj(map: Map<number, number[]>, from: number, to: number): void {
  const bucket = map.get(from);
  if (bucket) bucket.push(to);
  else map.set(from, [to]);
}

/**
 * Blast radius: walk the call graph from `start` up to `depth` hops.
 * direction "callees" = what it calls; "callers" = who calls it.
 * Module-level sites (caller -1) are not expandable and are surfaced
 * separately by `fileLevelCallersTo`. Hits exclude `start`, sorted by hops.
 */
export function traceFrom(
  graph: GraphData,
  start: number,
  direction: "callers" | "callees",
  depth: number,
): TraceHit[] {
  const adjacency = new Map<number, number[]>();
  for (const e of graph.calls) {
    if (e.caller < 0) continue;
    if (direction === "callees") pushAdj(adjacency, e.caller, e.callee);
    else pushAdj(adjacency, e.callee, e.caller);
  }
  const visited = new Map<number, number>([[start, 0]]);
  const queue: number[] = [start];
  const hits: TraceHit[] = [];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const hops = visited.get(cur)!;
    if (hops >= depth) continue;
    for (const next of adjacency.get(cur) ?? []) {
      if (visited.has(next)) continue;
      visited.set(next, hops + 1);
      queue.push(next);
      hits.push({ symbol: next, hops: hops + 1 });
    }
  }
  return hits.sort((a, b) => a.hops - b.hops || a.symbol - b.symbol);
}

/** Module-level call sites that target `symbolId`, grouped by file. */
export function fileLevelCallersTo(graph: GraphData, symbolId: number): Array<{ file: number; count: number }> {
  const out = new Map<number, number>();
  for (const e of graph.calls) {
    if (e.caller === -1 && e.callee === symbolId) out.set(e.file, (out.get(e.file) ?? 0) + e.count);
  }
  return [...out.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => a.file - b.file);
}
