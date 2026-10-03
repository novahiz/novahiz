// Suite de tests de la résolution et du graphe (src/graph/resolve.ts).
// Elle verrouille les règles de précision du jalon 3 : local > import >
// unique > méthode, arêtes ambigues supprimées (comptées), imports externes
// ignorés, sites module-level, déterminisme entre deux builds, et rayon de
// portée en N sauts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractFile } from "../src/graph/extract.ts";
import {
  buildGraph,
  fileLevelCallersTo,
  normalizePosix,
  resolveSpecifier,
  traceFrom,
} from "../src/graph/resolve.ts";
import type { GraphData, WorkspaceFile } from "../src/graph/resolve.ts";

const SOURCES: Record<string, string> = {
  "src/db.ts": [
    "export function openDb(): Db {",
    "  return new Db();",
    "}",
    "export class Db {",
    "  query(sql: string): string {",
    "    return sql;",
    "  }",
    "}",
    "export default class Engine {",
    "  start(): void {}",
    "}",
  ].join("\n"),
  "src/service.ts": [
    'import Engine from "./db.ts";',
    'import { openDb } from "./db.ts";',
    "",
    "export function run(): string {",
    "  const db = openDb();",
    '  return db.query("x");',
    "}",
    "",
    "export function boot(): void {",
    "  const e = new Engine();",
    "  e.start();",
    "}",
  ].join("\n"),
  "src/chain.ts": [
    "function level3(): number {",
    "  return 3;",
    "}",
    "function level2(): number {",
    "  return level3();",
    "}",
    "export function level1(): number {",
    "  return level2();",
    "}",
  ].join("\n"),
  "src/top.ts": [
    'import { level1 } from "./chain.ts";',
    "",
    "export function top(): number {",
    "  return level1();",
    "}",
  ].join("\n"),
  "src/third.ts": ['export function ping(): string {', '  return "pong";', "}"].join("\n"),
  "src/distant.ts": ["export function callPing(): string {", "  return ping();", "}"].join("\n"),
  "src/m1.ts": ["export class Alpha {", "  transform(v: number): number {", "    return v;", "  }", "}"].join("\n"),
  "src/m2.ts": ["export class Beta {", "  transform(v: number): number {", "    return v;", "  }", "}"].join("\n"),
  "src/use.ts": ["export function apply(a: Alpha, v: number): number {", "  return a.transform(v);", "}"].join("\n"),
  "src/ext.ts": [
    'import { fmt } from "left-pad";',
    "",
    "export function callExternal(): void {",
    "  fetchIt();",
    '  fmt("x");',
    "}",
  ].join("\n"),
  "src/mod.ts": ['import { run } from "./service.ts";', "", "run();"].join("\n"),
};

const ENTRIES: WorkspaceFile[] = Object.entries(SOURCES).map(([path, src], i) => ({
  index: extractFile(path, src),
  hash: `hash-${i}`,
  size: src.length,
}));

const g: GraphData = buildGraph("W:/repo", ENTRIES);

const fid = (path: string): number => {
  const idx = g.files.findIndex((f) => f.path === path);
  assert.notEqual(idx, -1, `fichier absent du graphe: ${path}`);
  return idx;
};

const sid = (name: string, path?: string): number => {
  const ids = g.byName[name] ?? [];
  assert.ok(ids.length > 0, `symbole absent: ${name}`);
  if (path === undefined) return ids[0];
  const file = fid(path);
  const found = ids.find((id) => g.symbols[id].file === file);
  if (found === undefined) throw new Error(`symbole ${name} absent de ${path}`);
  return found;
};

const edge = (caller: string | null, callee: string) =>
  g.calls.find((e) =>
    (caller === null ? e.caller === -1 : e.caller !== -1 && g.symbols[e.caller].name === caller) &&
    g.symbols[e.callee].name === callee);

describe("graph/resolve - résolution des appels", () => {
  test("un appel intra-fichier résout en local, vers le bon symbole", () => {
    const e = edge("run", "openDb");
    assert.ok(e);
    assert.equal(e.confidence, "import");
    const e2 = edge("level2", "level3");
    assert.ok(e2);
    assert.equal(e2.confidence, "local");
    assert.equal(e2.uncertain, false);
  });

  test("un nom lié par import résout vers le symbole exporté cible", () => {
    const e = edge("top", "level1");
    assert.ok(e);
    assert.equal(e.confidence, "import");
    assert.equal(g.symbols[e.callee].file, fid("src/chain.ts"));
    assert.equal(e.uncertain, false);
  });

  test("un import par défaut (classe) résout via findDefault", () => {
    const e = edge("boot", "Engine");
    assert.ok(e);
    assert.equal(e.confidence, "import");
    assert.equal(g.symbols[e.callee].file, fid("src/db.ts"));
    assert.equal(e.viaNew, true);
  });

  test("une méthode unique dans le workspace résout en method, flaguée uncertain", () => {
    const e = edge("run", "query");
    assert.ok(e);
    assert.equal(e.confidence, "method");
    assert.equal(e.uncertain, true);
    assert.equal(g.symbols[e.callee].file, fid("src/db.ts"));
  });

  test("un symbole unique sans import ni local résout en unique, flaggué uncertain", () => {
    const e = edge("callPing", "ping");
    assert.ok(e);
    assert.equal(e.confidence, "unique");
    assert.equal(e.uncertain, true);
  });

  test("un receiver inconnu sur méthode partagée = ambigu, aucune arête créée", () => {
    assert.equal(edge("apply", "transform"), undefined);
    assert.ok(g.stats.ambiguous >= 1);
  });

  test("appels vers l'extérieur et symbole inexistant = unresolved, pas d'arête", () => {
    assert.equal(g.calls.some((e) => g.symbols[e.callee].name === "fetchIt"), false);
    assert.equal(g.calls.some((e) => g.symbols[e.callee].name === "fmt"), false);
    assert.ok(g.stats.unresolved >= 2);
  });

  test("un appel de niveau module a pour caller -1 et reste traçable", () => {
    const e = edge(null, "run");
    assert.ok(e);
    assert.equal(e.caller, -1);
    assert.equal(g.files[e.file].path, "src/mod.ts");
    assert.equal(e.confidence, "import");
    const sites = fileLevelCallersTo(g, sid("run", "src/service.ts"));
    assert.deepEqual(sites, [{ file: fid("src/mod.ts"), count: 1 }]);
  });

  test("les appels agrégés portent le compteur et la meilleure confiance", () => {
    assert.equal(g.stats.sites, 13);
    assert.equal(g.stats.sites, g.stats.resolved + g.stats.ambiguous + g.stats.unresolved);
    assert.equal(g.stats.resolved, 10);
    assert.equal(g.stats.local + g.stats.import + g.stats.unique + g.stats.method, g.stats.resolved);
    assert.equal(g.stats.local, 3);
    assert.equal(g.stats.import, 4);
    assert.equal(g.stats.unique, 1);
    assert.equal(g.stats.method, 2);
  });
});

describe("graph/resolve - imports résolus", () => {
  test("les imports relatifs pointent vers des fichiers du workspace", () => {
    assert.deepEqual(g.files[fid("src/service.ts")].imports, ["src/db.ts"]);
    assert.deepEqual(g.files[fid("src/top.ts")].imports, ["src/chain.ts"]);
    assert.deepEqual(g.files[fid("src/mod.ts")].imports, ["src/service.ts"]);
  });

  test("les spécificateurs bare (node:, npm) sont ignorés", () => {
    assert.deepEqual(g.files[fid("src/ext.ts")].imports, []);
  });

  test("resolveSpecifier: extension absente, exacte, index, hors workspace", () => {
    const known = new Set(["src/db.ts", "src/pkg/index.ts", "a.ts"]);
    assert.equal(resolveSpecifier("src/service.ts", "./db.ts", known), "src/db.ts");
    assert.equal(resolveSpecifier("src/service.ts", "./db", known), "src/db.ts");
    assert.equal(resolveSpecifier("src/pkg/deep/x.ts", "../index", known), "src/pkg/index.ts");
    assert.equal(resolveSpecifier("a.ts", "./src/db", known), "src/db.ts");
    assert.equal(resolveSpecifier("src/service.ts", "react", known), null);
    assert.equal(resolveSpecifier("src/service.ts", "./nope.ts", known), null);
  });

  test("normalizePosix résout . et .. sans remonter au-dessus de la racine", () => {
    assert.equal(normalizePosix("src/./a/../b.ts"), "src/b.ts");
    assert.equal(normalizePosix("a//b"), "a/b");
    assert.equal(normalizePosix("../../etc/passwd"), "etc/passwd");
  });
});

describe("graph/resolve - déterminisme", () => {
  test("deux builds du même contenu produisent un graphe identique", () => {
    const again = buildGraph("W:/repo", ENTRIES);
    assert.deepEqual(again, g);
  });

  test("les fichiers sont triés par chemin et les symboles indexés par nom", () => {
    const paths = g.files.map((f) => f.path);
    assert.deepEqual(paths, [...paths].sort());
    const ids = g.byName["transform"] ?? [];
    assert.equal(ids.length, 2);
    assert.deepEqual(ids.map((id) => g.symbols[id].file), [fid("src/m1.ts"), fid("src/m2.ts")]);
  });

  test("inverted pointe vers tous les fichiers contenant l'identant", () => {
    assert.deepEqual(g.inverted["transform"] ?? [], [fid("src/m1.ts"), fid("src/m2.ts"), fid("src/use.ts")]);
    assert.ok((g.inverted["ping"] ?? []).includes(fid("src/third.ts")));
  });
});

describe("graph/resolve - rayon de portée", () => {
  const top = () => sid("top", "src/top.ts");
  const level3 = () => sid("level3", "src/chain.ts");

  test("callees: N sauts depuis top suivent la chaîne import -> local -> local", () => {
    const l1 = sid("level1", "src/chain.ts");
    const l2 = sid("level2", "src/chain.ts");
    assert.deepEqual(traceFrom(g, top(), "callees", 1), [{ symbol: l1, hops: 1 }]);
    assert.deepEqual(traceFrom(g, top(), "callees", 2), [
      { symbol: l1, hops: 1 },
      { symbol: l2, hops: 2 },
    ]);
    const l3 = level3();
    assert.deepEqual(traceFrom(g, top(), "callees", 3), [
      { symbol: l1, hops: 1 },
      { symbol: l2, hops: 2 },
      { symbol: l3, hops: 3 },
    ]);
  });

  test("callers: le blast radius remonte jusqu'au module importateur", () => {
    const l2 = sid("level2", "src/chain.ts");
    const l1 = sid("level1", "src/chain.ts");
    assert.deepEqual(traceFrom(g, level3(), "callers", 2), [
      { symbol: l2, hops: 1 },
      { symbol: l1, hops: 2 },
    ]);
    const hits = traceFrom(g, level3(), "callers", 3);
    assert.deepEqual(hits[hits.length - 1], { symbol: top(), hops: 3 });
  });

  test("profondeur 0 = rien, le symbole de départ n'est jamais dans les résultats", () => {
    assert.deepEqual(traceFrom(g, top(), "callees", 0), []);
    assert.equal(traceFrom(g, top(), "callees", 5).some((h) => h.symbol === top()), false);
  });
});
