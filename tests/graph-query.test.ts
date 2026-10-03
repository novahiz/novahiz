// Suite de tests du layer de requêtes (src/graph/query.ts) : les six
// opérations MCP sur un workspace réel isolé — graph_find (rangs exact/
// insensible-casse/sous-chaîne, filtres kind et file, limites),
// graph_find_all (occurrences masquées depuis les objets, positions),
// graph_trace (rayon de portée, confiance des arêtes directes, candidats
// en cas d'ambiguïté, sites module-level), graph_file_api (exports, imports
// bruts résolus, définitions triées), graph_repo_map (arbre agrégé coupé à
// la profondeur, préfixe) et graph_freshness (cycle périmé→rebuild, sans
// écriture par défaut, racine invalide).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  graphFileApi,
  graphFind,
  graphFindAll,
  graphFreshness,
  graphRepoMap,
  graphTrace,
} from "../src/graph/query.ts";

const T_PAST = Date.now() - 600_000;

let home: string;
let previousHome: string | undefined;
const workspaces: string[] = [];

before(() => {
  home = mkdtempSync(join(tmpdir(), "novahiz-querytest-"));
  previousHome = process.env.NOVAHIZ_HOME;
  process.env.NOVAHIZ_HOME = home;
});

after(() => {
  if (previousHome === undefined) delete process.env.NOVAHIZ_HOME;
  else process.env.NOVAHIZ_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-queryws-"));
  workspaces.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    utimesSync(abs, new Date(T_PAST), new Date(T_PAST));
  }
  return dir;
}

const MAIN = workspace({
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
  "src/distant.ts": ["export function callPing(): string {", "  return ping();", "}"].join("\n"),
  "src/third.ts": ['export function ping(): string {', '  return "pong";', "}"].join("\n"),
  "src/mod.ts": ['import { run } from "./service.ts";', "", "run();"].join("\n"),
  "src/util.ts": ["export function runner(): void {}", "export function renderer(): void {}"].join("\n"),
  "src/other.ts": ["export class Other {", "  query(y: string): string {", "    return y;", "  }", "}"].join("\n"),
  "README.md": "# Guide\n\nTexte brut.\n",
});

describe("graph/query - graph_find", () => {
  test("rangs : exact avant sous-chaîne, tri par chemin puis ligne", () => {
    const result = graphFind(MAIN, { query: "run" });
    assert.equal(result.total, 2);
    assert.equal(result.hits[0].name, "run");
    assert.equal(result.hits[0].file, "src/service.ts");
    assert.equal(result.hits[1].name, "runner");
    assert.ok(result.hits[0].signature.includes("run"));
    assert.ok(result.hits[0].line > 0);
    assert.equal(typeof result.hits[0].id, "number");
  });

  test("insensible à la casse, filtres kind et file, limite sans toucher au total", () => {
    assert.equal(graphFind(MAIN, { query: "RUN" }).hits[0].name, "run");
    assert.equal(graphFind(MAIN, { query: "run", kind: "class" }).total, 0);
    assert.equal(graphFind(MAIN, { query: "run", kind: "function" }).total, 2);
    assert.equal(graphFind(MAIN, { query: "run", file: "util" }).total, 1);
    const limited = graphFind(MAIN, { query: "run", limit: 1 });
    assert.equal(limited.hits.length, 1);
    assert.equal(limited.total, 2);
  });

  test("requête vide = erreur de paramètre", () => {
    assert.throws(() => graphFind(MAIN, { query: "   " }), /Invalid params/);
  });
});

describe("graph/query - graph_find_all", () => {
  test("occurrences réelles dédupliquées par fichier, lignes triées", () => {
    const result = graphFindAll(MAIN, { query: "openDb" });
    assert.equal(result.files, 2);
    assert.equal(result.unavailable.length, 0);
    assert.ok(result.occurrences >= 3, "déclaration + import + appel");
    const service = result.results.find((r) => r.file === "src/service.ts");
    assert.ok(service);
    assert.ok(service.count >= 2);
    assert.deepEqual(service.lines, [...service.lines].sort((a, b) => a - b));
    assert.equal(service.linesTruncated, false);
  });

  test("un identant qui n'existe que dans une chaîne est masqué : zéro résultat", () => {
    const result = graphFindAll(MAIN, { query: "pong" });
    assert.equal(result.files, 0);
    assert.equal(result.occurrences, 0);
    assert.deepEqual(result.results, []);
  });

  test("filtre file et identant inconnu", () => {
    assert.equal(graphFindAll(MAIN, { query: "openDb", file: "service" }).files, 1);
    assert.equal(graphFindAll(MAIN, { query: "zzzInconnu" }).files, 0);
    assert.throws(() => graphFindAll(MAIN, { query: "" }), /Invalid params/);
  });
});

describe("graph/query - graph_trace", () => {
  test("callees : confiance des arêtes directes et sauts suivants", () => {
    const trace = graphTrace(MAIN, { symbol: "run", direction: "callees", depth: 2 });
    assert.ok(trace.start);
    assert.equal(trace.start.name, "run");
    const names = trace.callees.map((h) => h.name);
    assert.deepEqual([...names].sort(), ["Db", "openDb"]);
    const openDb = trace.callees.find((h) => h.name === "openDb");
    assert.equal(openDb?.hops, 1);
    assert.equal(openDb?.confidence, "import");
    assert.equal(openDb?.uncertain, false);
    const db = trace.callees.find((h) => h.name === "Db");
    assert.equal(db?.hops, 2, "openDb → Db atteint au second saut");
    // db.query n'a PAS d'arête : deux méthodes `query` coexistent dans le
    // workspace et le receiver local n'a pas de type — ambigu et compté.
    assert.equal(trace.callees.some((h) => h.name === "query"), false);
    assert.ok(graphRepoMap(MAIN, {}).stats.ambiguous >= 1, "le site ambigu est compté dans les stats");
  });

  test("callers : remontée sur deux sauts + sites module-level séparés", () => {
    const trace = graphTrace(MAIN, { symbol: "openDb", direction: "callers", depth: 2 });
    assert.equal(trace.callers[0].name, "run");
    assert.equal(trace.callers[0].confidence, "import");

    const run = graphTrace(MAIN, { symbol: "run", direction: "callers", depth: 3 });
    assert.deepEqual(run.callers, [], "un site module-level n'est pas un symbole appelant");
    assert.deepEqual(run.moduleCallers, [{ file: "src/mod.ts", count: 1 }]);

    const ping = graphTrace(MAIN, { symbol: "ping", direction: "callers", depth: 1 });
    assert.equal(ping.callers[0].name, "callPing");
    assert.equal(ping.callers[0].confidence, "unique");
    assert.equal(ping.callers[0].uncertain, true);
  });

  test("direction both, limites, symbole inconnu", () => {
    const both = graphTrace(MAIN, { symbol: "run" });
    assert.ok(both.callers.length >= 1 || both.moduleCallers.length >= 1);
    assert.ok(both.callees.length >= 1);
    assert.equal(both.direction, "both");

    const limited = graphTrace(MAIN, { symbol: "run", direction: "callees", depth: 3, limit: 1 });
    assert.equal(limited.callees.length, 1);

    const missing = graphTrace(MAIN, { symbol: "jamaisVu" });
    assert.equal(missing.start, null);
    assert.equal(missing.matchCount, 0);
    assert.deepEqual(missing.candidates, []);
    assert.throws(() => graphTrace(MAIN, { symbol: " " }), /Invalid params/);
  });

  test("nom ambigu sans fichier : candidats rendus ; fichier : départ déterministe", () => {
    const ambiguous = graphTrace(MAIN, { symbol: "query" });
    assert.equal(ambiguous.start, null);
    assert.equal(ambiguous.matchCount, 2);
    assert.equal(ambiguous.candidates.length, 2);
    assert.deepEqual(
      ambiguous.candidates.map((c) => c.file).sort(),
      ["src/db.ts", "src/other.ts"],
    );

    const scoped = graphTrace(MAIN, { symbol: "query", file: "other" });
    assert.ok(scoped.start);
    assert.equal(scoped.start.file, "src/other.ts");
    assert.equal(scoped.start.kind, "method");
  });
});

describe("graph/query - graph_file_api", () => {
  test("vue signatures : exports, imports bruts résolus, définitions triées", () => {
    const api = graphFileApi(MAIN, { file: "src/service.ts" });
    assert.equal(api.found, true);
    assert.equal(api.detailAvailable, true);
    assert.deepEqual(api.exports, ["run", "boot"]);
    assert.equal(api.file?.symbolCount, 2);
    assert.deepEqual(api.file?.imports, ["src/db.ts"]);
    assert.equal(api.imports.length, 2, "deux déclarations d'import séparées");
    assert.equal(api.imports[0].raw, "./db.ts");
    assert.equal(api.imports[0].resolved, "src/db.ts");
    assert.equal(api.imports[1].bindings[0].imported, "openDb");
    assert.deepEqual(api.definitions.map((d) => d.name), ["run", "boot"]);
    const lines = api.definitions.map((d) => d.line);
    assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
    assert.ok(api.definitions[0].signature.includes("function"));
  });

  test("import par défaut : binding default résolu vers la classe", () => {
    const api = graphFileApi(MAIN, { file: "src/service.ts" });
    assert.equal(api.imports[0].bindings[0].imported, "default");
    assert.equal(api.imports[0].bindings[0].local, "Engine");
  });

  test("chemin flou unique, ambigu, inconnu, et fichier markdown", () => {
    assert.equal(graphFileApi(MAIN, { file: "service" }).found, true);
    const ambiguous = graphFileApi(MAIN, { file: "src" });
    assert.equal(ambiguous.found, false);
    assert.ok(ambiguous.candidates.length >= 5);
    const missing = graphFileApi(MAIN, { file: "zzz.ts" });
    assert.equal(missing.found, false);
    assert.deepEqual(missing.candidates, []);

    const readme = graphFileApi(MAIN, { file: "README.md" });
    assert.equal(readme.found, true);
    assert.equal(readme.file?.kind, "markdown");
    assert.ok(readme.definitions.some((d) => d.kind === "heading"), "le titre devient une définition");
    assert.throws(() => graphFileApi(MAIN, { file: "" }), /Invalid params/);
  });
});

describe("graph/query - graph_repo_map", () => {
  test("arbre complet : enfants triés, totaux, stats globales", () => {
    const map = graphRepoMap(MAIN, {});
    assert.equal(map.totals.files, 8);
    assert.ok(map.totals.symbols >= 12);
    assert.ok(map.totals.lines > 0);
    assert.ok(map.stats.sites > 0);
    assert.equal(map.stats.sites, map.stats.resolved + map.stats.ambiguous + map.stats.unresolved);

    const names = map.tree.map((n) => n.name);
    assert.deepEqual(names, ["README.md", "src"]);
    const src = map.tree.find((n) => n.name === "src");
    assert.equal(src?.kind, "dir");
    assert.equal(src?.fileCount, 7);
    assert.deepEqual(
      (src?.children ?? []).map((c) => c.name),
      ["db.ts", "distant.ts", "mod.ts", "other.ts", "service.ts", "third.ts", "util.ts"],
    );
  });

  test("profondeur 1 : agrégats complets mais enfants coupés", () => {
    const map = graphRepoMap(MAIN, { depth: 1 });
    const src = map.tree.find((n) => n.name === "src");
    assert.equal(src?.children, undefined);
    assert.equal(src?.fileCount, 7, "les fichiers restent comptés dans l'agrégat");
    assert.ok((src?.symbols ?? 0) >= 11);
    assert.equal(map.tree.find((n) => n.name === "README.md")?.kind, "file");
  });

  test("préfixe : le sous-arbre src seul, readme exclu", () => {
    const map = graphRepoMap(MAIN, { path: "src/" });
    assert.equal(map.prefix, "src/");
    assert.equal(map.totals.files, 7);
    assert.equal(map.tree.length, 1);
    assert.equal(map.tree[0].name, "src");
    assert.ok(map.stats.sites > 0, "les stats d'appels restent globales");
  });
});

describe("graph/query - graph_freshness", () => {
  test("cycle complet : absent → présent → périmé → rafraîchi, sans écriture par défaut", () => {
    const dir = workspace({ "a.ts": "export const alpha = 1;\n" });

    const absent = graphFreshness(dir);
    assert.equal(absent.exists, false);
    assert.equal(absent.stale, true);
    assert.equal(absent.total, 1);
    assert.equal(absent.builtAt, null);

    const built = graphFreshness(dir, { rebuild: true });
    assert.equal(built.exists, true);
    assert.equal(built.stale, false);
    assert.match(built.builtAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

    writeFileSync(join(dir, "a.ts"), "export const alpha = 2;\n");
    utimesSync(join(dir, "a.ts"), new Date(), new Date());
    const drifted = graphFreshness(dir); // sans rebuild : rapporte sans écrire
    assert.equal(drifted.stale, true);
    assert.deepEqual(drifted.changed, ["a.ts"]);

    const repaired = graphFreshness(dir, { rebuild: true });
    assert.equal(repaired.stale, false);
  });

  test("racine absente ou fichier = erreur de paramètre", () => {
    assert.throws(() => graphFind(join(tmpdir(), "novahiz-racine-inexistante-zzz"), { query: "x" }), /Invalid params/);
    assert.throws(() => graphFreshness(join(tmpdir(), "novahiz-racine-inexistante-zzz")), /Invalid params/);
  });
});

describe("graph/query - noms de prototypes", () => {
  test("constructor/toString/valueOf ne cassent ni l'indexation ni les requêtes", () => {
    // Régression : les records du graphe sont des {} — un nom tel que
    // `constructor` ou `valueOf` tombait sur Object.prototype (une fonction)
    // et plantait le build (bucket.push) ou la résolution (candidates.filter),
    // bug réel attrapé sur le corpus novahiz par le smoke test MCP.
    const dir = workspace({
      "proto.ts": [
        "export class Box {",
        "  constructor(readonly id: number) {}",
        "  clone(): Box {",
        "    return new this.constructor(this.id);",
        "  }",
        "  tag(): string {",
        "    return this.valueOf().toString();",
        "  }",
        "}",
        "export function toString(): string {",
        '  return "s";',
        "}",
      ].join("\n"),
    });

    const found = graphFind(dir, { query: "constructor" });
    assert.equal(found.total, 1);
    assert.equal(found.hits[0].kind, "constructor");
    assert.equal(graphFind(dir, { query: "toString" }).total, 1);
    assert.ok(graphFindAll(dir, { query: "toString" }).files >= 1);
    assert.equal(graphTrace(dir, { symbol: "toString" }).start?.name, "toString");
    assert.equal(graphTrace(dir, { symbol: "valueOf" }).matchCount, 0);
  });
});
