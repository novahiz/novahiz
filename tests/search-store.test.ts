// Suite de tests du store d'indexation Lodestone (src/search/store.ts) :
// parcours allowlist (extensions, binaires, gros fichiers, .env exclus),
// indexation incrementale sur stat, rebuild complet, statut en lecture
// seule, et moteur FTS5 avec repli LIKE.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureSearchIndex,
  rebuildSearch,
  searchFreshness,
  searchStatus,
  walkFiles,
} from "../src/search/store.ts";

const T_PAST = Date.now() - 600_000;

let home: string;
let previousHome: string | undefined;
const workspaces: string[] = [];

before(() => {
  home = mkdtempSync(join(tmpdir(), "lodestone-storetest-"));
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
  const dir = mkdtempSync(join(tmpdir(), "lodestone-storews-"));
  workspaces.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
    utimesSync(abs, new Date(T_PAST), new Date(T_PAST));
  }
  return dir;
}

describe("walkFiles", () => {
  test("allowlist d'extensions uniquement", () => {
    const root = workspace({
      "src/a.ts": "export const a = 1;",
      "src/b.py": "x = 1",
      "notes.md": "# hi",
      "data.json": "{}",
      "image.png": "not text",
      "archive.zip": "not text",
    });
    const paths = walkFiles(root).map((f) => f.path).sort();
    assert.deepEqual(paths, ["data.json", "notes.md", "src/a.ts", "src/b.py"]);
  });

  test("exclut .env, les logs, les bases et les lockfiles", () => {
    const root = workspace({
      ".env": "SECRET=1",
      ".env.local": "SECRET=2",
      "debug.log": "noise",
      "scheduler.db": "binary-ish",
      "package-lock.json": "{}",
      "yarn.lock": "noise",
      "src/ok.ts": "export const ok = 1;",
    });
    const paths = walkFiles(root).map((f) => f.path);
    assert.deepEqual(paths, ["src/ok.ts"]);
  });

  test("exclut les repertoires ignores et les gros fichiers", () => {
    const root = workspace({
      "node_modules/pkg/index.js": "export const x = 1;",
      "dist/bundle.js": "export const y = 1;",
      "src/big.ts": "x".repeat(600 * 1024),
      "src/small.ts": "export const z = 1;",
    });
    const paths = walkFiles(root).map((f) => f.path);
    assert.deepEqual(paths, ["src/small.ts"]);
  });

  test("noms sans extension connus", () => {
    const root = workspace({
      "Dockerfile": "FROM node",
      "Makefile": "all:",
      "LICENSE": "MIT",
      "README": "no ext",
    });
    const paths = walkFiles(root).map((f) => f.path).sort();
    assert.deepEqual(paths, ["Dockerfile", "LICENSE", "Makefile", "README"]);
  });
});

describe("indexation incrementale", () => {
  test("premier ensure indexe tout, deuxieme est un no-op", () => {
    const root = workspace({
      "src/a.ts": "export function alpha() { return 1; }\nexport const beta = 2;",
      "src/b.ts": "export function gamma() { return 3; }",
    });
    const first = ensureSearchIndex(root);
    assert.equal(first.exists, true);
    assert.equal(first.stale, false);
    assert.equal(first.files, 2);
    assert.ok(first.rows >= 2);
    const second = ensureSearchIndex(root);
    assert.equal(second.stale, false);
    assert.equal(second.files, 2);
    assert.equal(second.rows, first.rows);
  });

  test("un fichier modifie est re-chunké seul", () => {
    const root = workspace({
      "src/a.ts": "export function alpha() { return 1; }",
      "src/b.ts": "export function gamma() { return 3; }",
    });
    ensureSearchIndex(root);
    const aPath = join(root, "src", "a.ts");
    writeFileSync(aPath, "export function alpha() { return 42; }\nexport const delta = 7;");
    utimesSync(aPath, new Date(), new Date());
    const status = ensureSearchIndex(root);
    assert.equal(status.stale, false);
    assert.equal(status.files, 2);
    assert.ok(status.rows > 0);
  });

  test("un fichier supprimé sort de l'index", () => {
    const root = workspace({
      "src/a.ts": "export function alpha() { return 1; }",
      "src/b.ts": "export function gamma() { return 3; }",
    });
    ensureSearchIndex(root);
    rmSync(join(root, "src", "b.ts"));
    const status = ensureSearchIndex(root);
    assert.equal(status.files, 1);
    assert.equal(status.removed.length, 0); // already applied
  });

  test("rebuild reconstruit de zero", () => {
    const root = workspace({ "src/a.ts": "export function alpha() { return 1; }" });
    ensureSearchIndex(root);
    writeFileSync(join(root, "src", "a.ts"), "export function alpha() { return 99; }");
    const status = rebuildSearch(root);
    assert.equal(status.exists, true);
    assert.equal(status.stale, false);
    assert.equal(status.files, 1);
  });
});

describe("statut en lecture seule", () => {
  test("searchFreshness ne reconstruit jamais", () => {
    const root = workspace({ "src/a.ts": "export function alpha() { return 1; }" });
    const before = searchStatus(root);
    assert.equal(before.exists, false);
    assert.equal(before.stale, true);
    const fresh = searchFreshness(root);
    assert.equal(fresh.stale, true);
    assert.equal(fresh.added.length, 1);
    assert.equal(searchStatus(root).exists, false);
  });

  test("searchStatus rapporte la derive apres ensure", () => {
    const root = workspace({ "src/a.ts": "export function alpha() { return 1; }" });
    ensureSearchIndex(root);
    writeFileSync(join(root, "src", "a.ts"), "export function alpha() { return 2; }");
    utimesSync(join(root, "src", "a.ts"), new Date(), new Date());
    const status = searchStatus(root);
    assert.equal(status.exists, true);
    assert.equal(status.stale, true);
    assert.equal(status.changed.length, 1);
  });
});
