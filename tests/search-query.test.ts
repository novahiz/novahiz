// Suite de tests de la couche de requete (src/search/query.ts) : recherche
// plein texte sur un workspace reel — correspondance exacte, sous-tokens
// camelCase, filtre de chemin, limites, repli OR quand AND ne trouve rien,
// et honnetete du flag `indexed`.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { searchLines } from "../src/search/query.ts";

const T_PAST = Date.now() - 600_000;

let home: string;
let previousHome: string | undefined;
const workspaces: string[] = [];

before(() => {
  home = mkdtempSync(join(tmpdir(), "lodestone-querytest-"));
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
  const dir = mkdtempSync(join(tmpdir(), "lodestone-queryws-"));
  workspaces.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
    utimesSync(abs, new Date(T_PAST), new Date(T_PAST));
  }
  return dir;
}

const CODE = {
  "src/user.ts": [
    "export function getUserById(id: string): User {",
    "  return store.find(u => u.id === id);",
    "}",
    "export function saveUser(user: User): void {",
    "  store.save(user);",
    "}",
  ].join("\n"),
  "src/store.ts": [
    "export const store = {",
    "  find: (fn: (u: User) => boolean) => null,",
    "  save: (u: User) => undefined,",
    "};",
  ].join("\n"),
  "README.md": "# Notes\n\nUse getUserById to fetch a user.\n",
};

describe("searchLines", () => {
  test("trouve un symbole exact", () => {
    const root = workspace(CODE);
    const result = searchLines(root, { query: "getUserById" });
    assert.equal(result.engine, "fts5");
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.some((hit) => hit.path === "src/user.ts" && hit.line === 1));
  });

  test("trouve par sous-token camelCase", () => {
    const root = workspace(CODE);
    const result = searchLines(root, { query: "userById" });
    assert.ok(result.hits.length > 0, "subtoken branch should match");
  });

  test("filtre de chemin", () => {
    const root = workspace(CODE);
    const result = searchLines(root, { query: "store", file: "user" });
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.every((hit) => hit.path.includes("user")));
  });

  test("limite et troncature honnete", () => {
    const root = workspace(CODE);
    const result = searchLines(root, { query: "user", limit: 2 });
    assert.ok(result.hits.length <= 2);
    assert.equal(result.truncated, result.total > 2);
  });

  test("repli OR quand AND ne trouve rien", () => {
    const root = workspace(CODE);
    const result = searchLines(root, { query: "getUserById nonexistentword" });
    assert.equal(result.fallback, true);
    assert.ok(result.hits.length > 0);
  });

  test("prefixe sur le dernier terme", () => {
    const root = workspace(CODE);
    const result = searchLines(root, { query: "getUserBy", prefix: true });
    assert.ok(result.hits.length > 0);
  });

  test("requete vide ou sans alphanumerique", () => {
    const root = workspace(CODE);
    assert.throws(() => searchLines(root, { query: "" }), /Invalid params/);
    assert.throws(() => searchLines(root, { query: "---" }), /Invalid params/);
  });

  test("racine invalide", () => {
    assert.throws(() => searchLines("/no/such/dir/lodestone", { query: "x" }), /Invalid params/);
  });

  test("flag indexed vrai seulement a la premiere recherche", () => {
    const root = workspace(CODE);
    const first = searchLines(root, { query: "getUserById" });
    assert.equal(first.indexed, true);
    const second = searchLines(root, { query: "getUserById" });
    assert.equal(second.indexed, false);
  });
});
