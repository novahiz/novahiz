// Suite de tests du store de graphe (src/graph/store.ts) : construction
// initiale, fraîcheur par stat, rebuild incrémental (preuve de réutilisation
// d'objet par implantation d'un sentinel), dédup par contenu, GC des objets
// orphelins, auto-réparation (objet perdu, graph.json corrompu), exclusions
// du walk, statut, et cloisonnement d'un magasin par racine. Le tout isolé
// dans un NOVAHIZ_HOME temporaire — le workspace indexé ne doit jamais être
// pollué.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

import type { FileIndex } from "../src/graph/extract.ts";
import {
  diffFreshness,
  ensureGraph,
  graphStatus,
  graphStoreDir,
  walkWorkspace,
} from "../src/graph/store.ts";

const T_PAST = Date.now() - 600_000;

const APP_V1 = [
  "export function run(): number {",
  "  return compute(1);",
  "}",
  "function compute(n: number): number {",
  "  return n;",
  "}",
].join("\n");
const APP_V2 = "export function renamed(): number {\n  return 7;\n}\n";
const STABLE = "export function stableFn(): void {}\n";
const TWIN = "export const twin = 1;\n";
const KEEP = "export function keeper(): void {}\n";
const OTHER = "export function otherFn(): void {}\n";
const README = "# Guide\n\nTexte brut.\n";

let home: string;
let previousHome: string | undefined;
const workspaces: string[] = [];

before(() => {
  home = mkdtempSync(join(tmpdir(), "novahiz-graphtest-"));
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
  const dir = mkdtempSync(join(tmpdir(), "novahiz-graphws-"));
  workspaces.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    utimesSync(abs, new Date(T_PAST), new Date(T_PAST));
  }
  return dir;
}

function touch(abs: string, content: string): void {
  writeFileSync(abs, content);
}

function readManifestFiles(dir: string): Record<string, { sha256: string; size: number; mtimeMs: number }> {
  const raw = readFileSync(join(graphStoreDir(dir), "manifest.json"), "utf8");
  return (JSON.parse(raw) as { files: Record<string, { sha256: string; size: number; mtimeMs: number }> }).files;
}

function listObjects(dir: string): string[] {
  const shardsDir = join(graphStoreDir(dir), "files");
  const out: string[] = [];
  let shards: string[];
  try {
    shards = readdirSync(shardsDir);
  } catch {
    return out;
  }
  for (const shard of shards) {
    for (const object of readdirSync(join(shardsDir, shard))) out.push(`${shard}/${object}`);
  }
  return out.sort();
}

function storeSnapshot(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (base: string, prefix: string): void => {
    const entries = readdirSync(base, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const abs = join(base, entry.name);
      if (entry.isDirectory()) walk(abs, `${prefix}${entry.name}/`);
      else out[`${prefix}${entry.name}`] = statSync(abs).mtimeMs;
    }
  };
  walk(graphStoreDir(dir), "");
  return out;
}

function listAll(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => p.replace(/\\/g, "/"))
    .sort();
}

describe("graph/store - construction initiale", () => {
  test("le premier ensure construit le store sans rien écrire dans le workspace", () => {
    const dir = workspace({ "src/app.ts": APP_V1, "README.md": README });
    const before = listAll(dir);

    const graph = ensureGraph(dir);

    assert.deepEqual(listAll(dir), before, "le workspace ne doit pas être pollué");
    assert.equal(existsSync(join(dir, ".graph")), false, "le store ne vit pas dans le workspace");

    const storeDir = graphStoreDir(dir);
    assert.equal(storeDir.startsWith(join(home, ".graph")), true);
    assert.match(storeDir.slice(join(home, ".graph").length + 1), /^[0-9a-f]{12}$/);
    assert.ok((graph.byName["run"] ?? []).length >= 1, "symbole run indexé");
    const readme = graph.files.find((f) => f.path === "README.md");
    assert.ok(readme);
    assert.equal(readme.kind, "markdown");
    assert.deepEqual(graph.files.map((f) => f.path), ["README.md", "src/app.ts"]);

    // Atomicité : ni fichier temporaire résiduel ni écriture à moitié.
    assert.deepEqual(listAll(storeDir).filter((p) => p.includes(".tmp-")), []);
  });

  test("un second ensure ne réécrit rien (stat fraîches, graphe identique)", () => {
    const dir = workspace({ "src/app.ts": APP_V1, "src/service.ts": "export const s = 1;\n" });
    const first = ensureGraph(dir);

    // Figer les mtimes du store : toute réécriture devient détectable.
    const freeze = (base: string): void => {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        const abs = join(base, entry.name);
        if (entry.isDirectory()) freeze(abs);
        else utimesSync(abs, new Date(T_PAST), new Date(T_PAST));
      }
    };
    freeze(graphStoreDir(dir));
    const snapshot = storeSnapshot(dir);

    const second = ensureGraph(dir);

    assert.deepEqual(second, first, "le graphe relu doit être identique à celui reconstruit en mémoire");
    assert.deepEqual(storeSnapshot(dir), snapshot, "aucun fichier du store n'a été réécrit");
    assert.equal(diffFreshness(dir).stale, false);
  });
});

describe("graph/store - fraîcheur et rebuild incrémental", () => {
  test("une modification déclenche stale, puis un rebuild incrémental", () => {
    const dir = workspace({ "src/app.ts": APP_V1, "src/keep.ts": STABLE });
    ensureGraph(dir);

    touch(join(dir, "src", "app.ts"), APP_V2);

    const diff = diffFreshness(dir);
    assert.equal(diff.stale, true);
    assert.deepEqual(diff.changed, ["src/app.ts"]);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);

    const graph = ensureGraph(dir);
    assert.ok((graph.byName["renamed"] ?? []).length >= 1, "le nouveau symbole est indexé");
    assert.equal((graph.byName["run"] ?? []).length, 0, "l'ancien symbole a disparu");
    assert.equal(diffFreshness(dir).stale, false);
  });

  test("preuve de réutilisation : un fichier inchangé est lu par son objet, pas ré-extrait", () => {
    const dir = workspace({ "src/stable.ts": STABLE });
    ensureGraph(dir);

    // On implante un sentinel dans l'objet de stable.ts (stat inchangées) :
    // si le rebuild ré-extrait depuis le disque, le sentinel disparaît.
    const sha = readManifestFiles(dir)["src/stable.ts"].sha256;
    const sentinel: FileIndex = {
      path: "src/stable.ts",
      kind: "code",
      lines: 1,
      symbols: [{
        name: "SentinelReused",
        kind: "function",
        line: 1,
        endLine: 1,
        signature: "function SentinelReused()",
        exported: true,
        enclosing: null,
        modifiers: [],
        heritage: [],
      }],
      imports: [],
      exports: ["SentinelReused"],
      calls: [],
      identNames: [],
      idents: [],
    };
    const objectAbs = join(graphStoreDir(dir), "files", sha.slice(0, 2), `${sha}.json.gz`);
    writeFileSync(objectAbs, gzipSync(Buffer.from(JSON.stringify(sentinel))));

    touch(join(dir, "src", "new.ts"), OTHER); // déclenche le rebuild
    const graph = ensureGraph(dir);

    assert.ok((graph.byName["SentinelReused"] ?? []).length >= 1, "l'objet du fichier inchangé a été réutilisé");
    assert.equal((graph.byName["stableFn"] ?? []).length, 0, "aucune ré-extraction du fichier inchangé");
    assert.ok((graph.byName["otherFn"] ?? []).length >= 1, "le fichier modifié est bien indexé");
  });

  test("ajout puis suppression : listes fraîcheur correctes et GC de l'objet orphelin", () => {
    const dir = workspace({ "src/keep.ts": KEEP });
    ensureGraph(dir);

    touch(join(dir, "src", "temp.ts"), OTHER);
    let diff = diffFreshness(dir);
    assert.deepEqual(diff.added, ["src/temp.ts"]);
    let graph = ensureGraph(dir);
    assert.ok((graph.byName["otherFn"] ?? []).length >= 1);
    const shaTemp = readManifestFiles(dir)["src/temp.ts"].sha256;

    rmSync(join(dir, "src", "temp.ts"));
    diff = diffFreshness(dir);
    assert.equal(diff.stale, true);
    assert.deepEqual(diff.removed, ["src/temp.ts"]);

    graph = ensureGraph(dir);
    assert.equal((graph.byName["otherFn"] ?? []).length, 0, "le symbole supprimé a disparu du graphe");
    assert.equal(graph.files.some((f) => f.path === "src/temp.ts"), false);
    assert.equal(listObjects(dir).includes(`${shaTemp.slice(0, 2)}/${shaTemp}.json.gz`), false, "objet orphelin GCé");
  });

  test("objet perdu malgré des stats fraîches : auto-réparation par ré-extraction", () => {
    const dir = workspace({ "src/stable.ts": STABLE, "src/other.ts": OTHER });
    ensureGraph(dir);
    const sha = readManifestFiles(dir)["src/stable.ts"].sha256;
    const objectAbs = join(graphStoreDir(dir), "files", sha.slice(0, 2), `${sha}.json.gz`);
    rmSync(objectAbs);

    // Tant que les stats sont fraîches, on sert le graph.json complet —
    // l'objet manquant n'est sensible qu'au prochain rebuild.
    assert.equal(diffFreshness(dir).stale, false);
    assert.ok((ensureGraph(dir).byName["stableFn"] ?? []).length >= 1, "service intact sans rebuild");

    touch(join(dir, "src", "other.ts"), `${OTHER}// touché\n`);
    const graph = ensureGraph(dir);
    assert.ok((graph.byName["stableFn"] ?? []).length >= 1, "ré-extrait au rebuild, le graphe reste complet");
    assert.equal(listObjects(dir).includes(`${sha.slice(0, 2)}/${sha}.json.gz`), true, "objet restauré");
  });

  test("graph.json corrompu : ensureGraph rebâtit tout et laisse un store propre", () => {
    const dir = workspace({ "src/app.ts": APP_V1 });
    ensureGraph(dir);
    const storeDir = graphStoreDir(dir);
    writeFileSync(join(storeDir, "graph.json"), "{corrompu");

    const graph = ensureGraph(dir);
    assert.ok((graph.byName["run"] ?? []).length >= 1);
    assert.deepEqual(listAll(storeDir).filter((p) => p.includes(".tmp-")), []);
    assert.equal(diffFreshness(dir).stale, false);
  });
});

describe("graph/store - dédup et cloisonnement des magasins", () => {
  test("deux fichiers au contenu identique partagent un objet, avec retag de chemin", () => {
    const dir = workspace({ "src/a.ts": TWIN, "src/b.ts": TWIN });
    ensureGraph(dir);

    const manifest = readManifestFiles(dir);
    assert.equal(manifest["src/a.ts"].sha256, manifest["src/b.ts"].sha256, "même contenu → même sha");
    assert.equal(listObjects(dir).length, 1, "un seul objet pour le contenu dupliqué");

    // Rebuild (un fichier tiers apparaît) : b.ts réutilise l'objet de a.ts,
    // le retag doit lui redonner son propre chemin dans le graphe.
    touch(join(dir, "src", "c.ts"), OTHER);
    const graph = ensureGraph(dir);
    assert.deepEqual(graph.files.map((f) => f.path), ["src/a.ts", "src/b.ts", "src/c.ts"]);
    assert.equal(graph.files.filter((f) => f.path !== "src/c.ts").every((f) => f.symbolCount === 1), true);
  });

  test("racines distinctes → magasins distincts, canonisation des séparateurs et de la casse", () => {
    const dirA = workspace({ "src/a.ts": TWIN });
    const dirB = workspace({ "src/b.ts": OTHER });
    assert.notEqual(graphStoreDir(dirA), graphStoreDir(dirB));
    assert.match(graphStoreDir(dirA).split(/[\\/]/).pop() ?? "", /^[0-9a-f]{12}$/);

    if (process.platform === "win32") {
      const withBackslash = `${dirA}\\`;
      assert.equal(graphStoreDir(withBackslash), graphStoreDir(dirA.toLowerCase()));
    }
  });
});

describe("graph/store - walk et statut", () => {
  test("le walk indexe code et markdown, ignore les dossiers de build et les autres extensions", () => {
    const dir = workspace({
      "src/app.ts": APP_V1,
      "docs/guide.md": README,
      "script.mjs": "export const m = 1;\n",
      "notes.txt": "pas indexé",
      "data.json": "{}",
      "node_modules/pkg/dep.ts": "export const dep = 1;\n",
      "dist/bundle.js": "var b = 1;",
      ".git/hooks.ts": "export const g = 1;",
    });
    assert.deepEqual(walkWorkspace(dir).map((w) => w.path), [
      "docs/guide.md",
      "script.mjs",
      "src/app.ts",
    ]);
  });

  test("graphStatus décrit le cycle de vie : absent → présent → périmé → rafraîchi", () => {
    const dir = workspace({ "src/app.ts": APP_V1 });

    let status = graphStatus(dir);
    assert.equal(status.exists, false);
    assert.equal(status.stale, true, "pas de graphe = périmé");
    assert.equal(status.total, 1);
    assert.equal(status.builtAt, null);

    ensureGraph(dir);
    status = graphStatus(dir);
    assert.equal(status.exists, true);
    assert.equal(status.stale, false);
    assert.match(status.builtAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual([status.added, status.changed, status.removed], [[], [], []]);

    touch(join(dir, "src", "app.ts"), APP_V2);
    status = graphStatus(dir);
    assert.equal(status.stale, true);
    assert.deepEqual(status.changed, ["src/app.ts"]);
  });
});
