// Suite de tests de la CLI `novahiz graph` (src/commands/graph.ts), exécutée
// réellement en sous-processus : codes de sortie, sous-commandes par préfixe,
// sorties --json / --format json, messages d'erreur sur stderr, et le cycle
// complet du store (absent → construit → périmé → rafraîchi) dans un
// NOVAHIZ_HOME temporaire. Le workspace de test est aussi le cwd : la racine
// par défaut (process.cwd()) est couverte implicitement.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const T_PAST = Date.now() - 600_000;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let home: string;
let ws: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "novahiz-clitest-"));
  ws = mkdtempSync(join(tmpdir(), "novahiz-cliws-"));
  const files: Record<string, string> = {
    "src/app.ts": [
      "export function alpha(): number {",
      "  return 1;",
      "}",
      "export function beta(): number {",
      "  return alpha();",
      "}",
    ].join("\n"),
    "src/util.ts": "export const gamma = 2;\n",
    "README.md": "# Doc\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(ws, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    utimesSync(abs, new Date(T_PAST), new Date(T_PAST));
  }
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

function graph(args: string[]): Run {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", CLI, "graph", ...args],
    { encoding: "utf8", cwd: ws, env: { ...process.env, NOVAHIZ_HOME: home }, timeout: 60_000 },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asJson = (run: Run): any => JSON.parse(run.stdout);

describe("graph CLI - statut et construction du store", () => {
  test("status avant toute construction : absent et périmé, sans écrire", () => {
    const run = graph(["status", "--json"]);
    assert.equal(run.status, 0);
    const status = asJson(run);
    assert.equal(status.exists, false);
    assert.equal(status.stale, true);
    assert.equal(status.total, 3);
    assert.equal(status.builtAt, null);
    assert.equal(status.storeDir.includes(join(home, ".graph")), true);
  });

  test("build construit, puis status rapporte présent et à jour", () => {
    const built = graph(["build", "--json"]);
    assert.equal(built.status, 0);
    const value = asJson(built);
    assert.equal(value.files, 3);
    assert.ok(value.symbols >= 4);
    assert.equal(value.stats.sites, 1, "un seul appel : beta → alpha");
    assert.ok(Number.isFinite(value.durationMs));

    const status = asJson(graph(["status", "--json"]));
    assert.equal(status.exists, true);
    assert.equal(status.stale, false);
    assert.match(status.builtAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual([status.added, status.changed, status.removed], [[], [], []]);
  });

  test("fresh détecte la dérive sans écrire, --rebuild la répare", () => {
    const app = join(ws, "src", "app.ts");
    writeFileSync(
      app,
      [
        "export function alpha(): number {",
        "  return 42;",
        "}",
        "export function beta(): number {",
        "  return alpha();",
        "}",
        "export function delta(): number {",
        "  return 2;",
        "}",
        "",
      ].join("\n"),
    );
    utimesSync(app, new Date(), new Date());

    const drifted = asJson(graph(["fresh", "--json"]));
    assert.equal(drifted.stale, true);
    assert.deepEqual(drifted.changed, ["src/app.ts"]);

    const repaired = asJson(graph(["fresh", "--rebuild", "--json"]));
    assert.equal(repaired.stale, false);
    assert.equal(asJson(graph(["find", "delta", "--json"])).total, 1, "le nouveau symbole est indexé");
  });
});

describe("graph CLI - aide et erreurs d'arguments", () => {
  test("help et commande vide affichent l'aide", () => {
    const help = graph(["help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /novahiz graph/);
    assert.match(help.stdout, /--json/);
    assert.match(help.stdout, /prefix/i);

    const bare = graph([]);
    assert.equal(bare.status, 0);
    assert.match(bare.stdout, /novahiz graph/);
  });

  test("sous-commande inconnue, préfixe ambigu, arguments manquants", () => {
    const unknown = graph(["zzz"]);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /sous-commande inconnue/);

    const ambiguous = graph(["f", "alpha"]);
    assert.equal(ambiguous.status, 1);
    assert.match(ambiguous.stderr, /préfixe ambigu/);
    assert.match(ambiguous.stderr, /fresh, find/);

    const missing = graph(["find"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /requête manquant/);

    const badDirection = graph(["trace", "alpha", "--direction", "sideways"]);
    assert.equal(badDirection.status, 1);
    assert.match(badDirection.stderr, /--direction/);
  });
});

describe("graph CLI - find et all", () => {
  test("find en humain, en JSON, par préfixe, et code 1 sans correspondance", () => {
    const human = graph(["find", "alpha"]);
    assert.equal(human.status, 0);
    assert.match(human.stdout, /src\/app\.ts:\d+/);
    assert.match(human.stdout, /alpha/);

    const json = asJson(graph(["find", "alpha", "--json"]));
    assert.equal(json.query, "alpha");
    assert.equal(json.hits[0].name, "alpha");
    assert.equal(json.hits[0].file, "src/app.ts");

    const prefixed = asJson(graph(["fi", "alpha", "--json"]));
    assert.equal(prefixed.total, json.total);

    const formatFlag = asJson(graph(["find", "alpha", "--format", "json"]));
    assert.equal(formatFlag.query, "alpha");

    const none = graph(["find", "zzzq", "--json"]);
    assert.equal(none.status, 1, "grep-like : rien trouvé = code 1");
    assert.equal(asJson(none).total, 0);
  });

  test("all liste les occurrences par fichier, lignes triées", () => {
    const result = asJson(graph(["all", "alpha", "--json"]));
    assert.equal(result.files, 1);
    assert.equal(result.occurrences, 2, "déclaration + appel depuis beta");
    assert.deepEqual(result.results[0].lines, [1, 5]);
    assert.equal(result.unavailable.length, 0);
  });
});

describe("graph CLI - trace, api et map", () => {
  test("trace montre l'appelant direct avec sa confiance, code 1 si inconnu", () => {
    const trace = asJson(graph(["trace", "alpha", "--json"]));
    assert.equal(trace.start.name, "alpha");
    assert.equal(trace.callers[0].name, "beta");
    assert.equal(trace.callers[0].confidence, "local");
    assert.equal(trace.callees.length, 0);

    const human = graph(["trace", "alpha"]);
    assert.match(human.stdout, /appelants :/);
    assert.match(human.stdout, /\[local\]/);

    const unknown = graph(["trace", "jamaisVu", "--json"]);
    assert.equal(unknown.status, 1);
    assert.equal(asJson(unknown).start, null);
  });

  test("api rend exports, imports et définitions du fichier", () => {
    const api = asJson(graph(["api", "src/app.ts", "--json"]));
    assert.equal(api.found, true);
    assert.deepEqual([...api.exports].sort(), ["alpha", "beta", "delta"]);
    assert.equal(api.definitions.length, 3);
    assert.equal(api.detailAvailable, true);

    const missing = graph(["api", "nope.ts", "--json"]);
    assert.equal(missing.status, 1);
    assert.equal(asJson(missing).found, false);
  });

  test("map agrège les totaux, l'arbre et les stats d'appels", () => {
    const map = asJson(graph(["map", "--json"]));
    assert.equal(map.totals.files, 3);
    assert.ok(map.totals.symbols >= 4);
    assert.deepEqual(map.tree.map((n: { name: string }) => n.name), ["README.md", "src"]);
    assert.ok(map.stats.sites >= 1);
    assert.equal(
      map.stats.sites,
      map.stats.resolved + map.stats.ambiguous + map.stats.unresolved,
    );

    const human = graph(["map", "--path", "src", "--depth", "1"]);
    assert.equal(human.status, 0);
    assert.match(human.stdout, /appels \d+ :/);
  });
});
