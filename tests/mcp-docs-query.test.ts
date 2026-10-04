// S4 : la couche lecture — citation complète dans chaque réponse, classement
// bm25, et le budget de 100 ms mesuré dedans (elapsedMs). Trois échelles de
// mesure : index de fixtures, index synthétique de 2000 passages, et l'index
// réel de la machine quand il existe.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { loadCatalog, type CatalogEntry } from "../mcp/novahiz-docs/src/catalog.ts";
import { splitMarkdown } from "../mcp/novahiz-docs/src/chunk.ts";
import { findLibrary, listLibraries, queryDocs } from "../mcp/novahiz-docs/src/query.ts";
import { countChunks, indexPage, openStore } from "../mcp/novahiz-docs/src/store.ts";

const FIXTURES = join(process.cwd(), "mcp", "novahiz-docs", "tests", "fixtures");
const REAL_DB = join(process.cwd(), "mcp", "novahiz-docs", "data", "index.sqlite");
const BUDGET_MS = 100;

const catalog = loadCatalog();
const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

// Le fixture de test « querykit » n'existe pas dans le bouquet réel : les
// tests qui le résolvent passent un catalogue augmenté, sinon la résolution
// fuzzy part vers une vraie entrée voisine (tanstack-query).
const QUERYKIT: CatalogEntry = {
  id: "querykit",
  name: "QueryKit",
  ecosystem: "npm",
  aliases: ["query-kit"],
  repo: "acme/querykit",
  docsUrl: "https://example.test/querykit",
  llmsTxt: null
};
const testCatalog: readonly CatalogEntry[] = [QUERYKIT, ...catalog];

function seedFixtures(db: DatabaseSync): void {
  indexPage(
    db,
    { library: "react", version: "19.1.0", sourceUrl: "https://example.test/react-state", license: "CC-BY-4.0" },
    splitMarkdown(readFixture("react-state.md"))
  );
  indexPage(
    db,
    { library: "querykit", version: "3.0.0", sourceUrl: "https://example.test/query-client", license: "MIT" },
    splitMarkdown(readFixture("query-client.md"))
  );
}

describe("couche lecture — citation et résolution", () => {
  const workdir = mkdtempSync(join(tmpdir(), "novahiz-docs-query-"));
  const db = openStore(join(workdir, "query.db"));
  seedFixtures(db);

  after(() => {
    db.close();
    rmSync(workdir, { recursive: true, force: true });
  });

  test("réponse : passage cité de bout en bout (origine, licence, horodatage, chemin)", () => {
    const outcome = queryDocs(db, { library: "react", query: "useState setter" });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.resolvedTo, null, "saisie déjà canonique");
    assert.ok(!outcome.suggestions.includes("react"), "le résultat principal n'est pas répété en suggestion");
    assert.ok(outcome.passages.length >= 1, "au moins un passage");
    const top = outcome.passages[0];
    assert.equal(top.libraryName, "React");
    assert.ok(top.headingPath.includes("useState hook"));
    assert.ok(top.text.includes("["), "le texte est l'extrait surligné");
    assert.equal(top.sourceUrl, "https://example.test/react-state");
    assert.equal(top.license, "CC-BY-4.0");
    assert.match(top.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof top.score, "number");
    assert.equal(typeof outcome.elapsedMs, "number");
  });

  test("réponse : bibliothèque inconnue → ok=false, note explicative, rien inventé", () => {
    const outcome = queryDocs(db, { library: "quantum-orm", query: "anything" });
    assert.equal(outcome.ok, false);
    assert.deepEqual(outcome.passages, []);
    assert.ok(outcome.note !== null && outcome.note.includes("quantum-orm"));
  });

  test("réponse : alias résolu et signalé, index vide signalé aussi", () => {
    const outcome = queryDocs(db, { library: "next", query: "anything" });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.resolvedTo, "nextjs", "l'alias converge et le s'annonce");
    assert.deepEqual(outcome.passages, []);
    assert.ok(outcome.note !== null && outcome.note.includes("index"), "le vide est dit, pas masqué");
  });

  test("réponse : autre entrée plausible proposée en suggestion", () => {
    const outcome = queryDocs(db, { library: "type", query: "state" });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.resolvedTo, "typescript");
    assert.ok(outcome.suggestions.length <= 2);
  });

  test("réponse : entrées vides refusées avant tout accès au disque", () => {
    const outcome = queryDocs(db, { library: "  ", query: "x" });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.note !== null);
  });

  test("find_library : résolution + état d'index dans la même réponse", () => {
    const outcome = findLibrary(db, "next", catalog);
    assert.equal(outcome.matches[0].id, "nextjs");
    assert.equal(outcome.matches[0].matchedOn, "alias");
    assert.equal(outcome.matches[0].indexed, false, "nextjs n'est pas dans l'index des fixtures");
    const react = findLibrary(db, "reactjs", catalog);
    assert.equal(react.matches[0].id, "react");
    assert.equal(react.matches[0].indexed, true, "react l'est");
  });

  test("list_libraries : tout le bouquet, avec l'état de remplissage par entrée", () => {
    const libraries = listLibraries(db, catalog);
    assert.equal(libraries.length, catalog.length);
    const react = libraries.find((entry) => entry.id === "react");
    assert.ok(react);
    assert.equal(react.indexed, true);
    assert.ok(react.chunks > 0);
    assert.match(react.fetchedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    const bun = libraries.find((entry) => entry.id === "bun");
    assert.ok(bun);
    assert.equal(bun.indexed, false, "non indexé dit non indexé");
    assert.equal(bun.chunks, 0);
    assert.equal(bun.fetchedAt, null);
  });

  test("classement : la requête remonte d'abord le bon livre", () => {
    const outcome = queryDocs(db, { library: "querykit", query: "cache stale refresh", limit: 5 }, testCatalog);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.resolvedTo, null, "querykit est résolue par son identifiant exact");
    assert.ok(outcome.passages.length >= 1);
    for (const passage of outcome.passages) assert.equal(passage.sourceUrl, "https://example.test/query-client");
  });
});

describe("couche lecture — budget de 100 ms", () => {
  test("index synthétique de 2000 passages : la réponse tient dans le budget", () => {
    const db = openStore(":memory:");
    try {
      const filler = "the configuration handshake negotiates protocol versions between client and server. ".repeat(30);
      const entries: CatalogEntry[] = catalog.slice(0, 40);
      for (const entry of entries) {
        const chunks = Array.from({ length: 50 }, (_, ord) => ({
          headingPath: [entry.name, `Section ${ord}`],
          ord,
          body: `${filler} distinctive marker for ${entry.id} in chunk ${ord}.`
        }));
        indexPage(db, { library: entry.id, version: "", sourceUrl: `https://example.test/${entry.id}`, license: "MIT" }, chunks);
      }
      assert.equal(countChunks(db), 2000, "l'échelle de mesure est bien 2000 passages");

      const outcome = queryDocs(db, { library: entries[7].id, query: "handshake negotiates protocol" });
      assert.equal(outcome.ok, true);
      assert.ok(outcome.passages.length >= 1, "la requête trouve sur 2000 passages");
      assert.ok(
        outcome.elapsedMs < BUDGET_MS,
        `réponse en ${outcome.elapsedMs} ms (budget ${BUDGET_MS} ms) sur 2000 passages`
      );
    } finally {
      db.close();
    }
  });

  test(
    "index réel de la machine : mêmes mesures sur les données d'ingestion",
    { skip: existsSync(REAL_DB) ? false : "index réel absent (aucune ingestion sur cette machine)" },
    () => {
      const db = openStore(REAL_DB);
      try {
        const outcome = queryDocs(db, { library: "react", query: "useState" });
        assert.equal(outcome.ok, true);
        assert.ok(outcome.passages.length >= 1, "l'index réel répond");
        assert.ok(
          outcome.elapsedMs < BUDGET_MS,
          `réponse en ${outcome.elapsedMs} ms (budget ${BUDGET_MS} ms) sur l'index réel`
        );
        for (const passage of outcome.passages) {
          assert.ok(passage.sourceUrl.length > 0, "chaque passage porte son origine");
          assert.ok(passage.license.length > 0, "chaque passage porte sa licence");
        }
      } finally {
        db.close();
      }
    }
  );
});
