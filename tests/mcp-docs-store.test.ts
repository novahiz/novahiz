// S1 : le couple chunker + index FTS5, prouve hors-ligne sur des fixtures
// locales. Aucun réseau n'est implique (verification statique incluse), la
// requete FTS5 retourne le passage attendu, et chaque passage porte sa
// citation complete : library, version, source_url, license, fetched_at,
// heading_path.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { splitMarkdown } from "../mcp/novahiz-docs/src/chunk.ts";
import { countChunks, indexPage, listIndexed, openStore, search, toMatchQuery } from "../mcp/novahiz-docs/src/store.ts";

const FIXTURES = join(process.cwd(), "mcp", "novahiz-docs", "tests", "fixtures");
const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

describe("chunker structurel", () => {
  test("sections H1/H2 : chemin de sections, corps commence par le titre, ord contigus", () => {
    const chunks = splitMarkdown(readFixture("react-state.md"));
    assert.ok(chunks.length >= 3, "la page decoupe en plusieurs passages");
    assert.deepEqual(chunks[0].headingPath, ["React State Guide"]);
    const useStateChunk = chunks.find((chunk) => chunk.body.startsWith("## useState hook"));
    assert.ok(useStateChunk, "le passage useState existe");
    assert.deepEqual(useStateChunk.headingPath, ["React State Guide", "useState hook"]);
    chunks.forEach((chunk, index) => assert.equal(chunk.ord, index, "ord sequentiel depuis 0"));
  });

  test("bloc de code : la fence voyage entiere dans son passage", () => {
    const chunks = splitMarkdown(readFixture("react-state.md"));
    const withCode = chunks.find((chunk) => chunk.body.includes("```js"));
    assert.ok(withCode, "le passage de code existe");
    assert.ok(withCode.body.includes("setCount(count + 1);"), "corps du code present");
    const fences = (withCode.body.match(/```/g) ?? []).length;
    assert.equal(fences, 2, "une fence ouverte est fermee, sans eclatement");
  });

  test("un titre ecrit DANS une fence n'est pas une frontiere de section", () => {
    const source = ["# T", "", "```md", "## fake heading", "```", "", "## real heading", "", "content"].join("\n");
    const parts = splitMarkdown(source);
    assert.equal(parts.length, 2, "seul le titre hors fence coupe");
    assert.ok(parts[0].body.includes("## fake heading"), "le faux titre reste dans le corps");
    assert.deepEqual(parts[1].headingPath, ["T", "real heading"]);
  });

  test("paragraphe plus grand que la limite : coupe aux espaces, aucun mot perdu", () => {
    const words = Array.from({ length: 60 }, (_, index) => `mot${index}`);
    const parts = splitMarkdown(["# Long", "", words.join(" ")].join("\n"), { maxChars: 100 });
    assert.ok(parts.length > 1, "le long paragraphe est en plusieurs passages");
    for (const part of parts) assert.ok(part.body.length <= 100, `passage de ${part.body.length} caracteres`);
    const rebuilt = parts
      .map((part) => part.body)
      .join(" ")
      .split(/\s+/);
    for (const word of words) assert.ok(rebuilt.includes(word), `mot perdu : ${word}`);
  });

  test("fence plus grande que la limite : chaque morceau reste referme, aucune ligne perdue", () => {
    const codeLines = Array.from({ length: 40 }, (_, index) => `line${index}`);
    const source = ["# C", "", "```js", ...codeLines, "```"].join("\n");
    const parts = splitMarkdown(source, { maxChars: 100 });
    const codeChunks = parts.filter((part) => part.body.startsWith("```js"));
    assert.ok(codeChunks.length >= 2, "le code est reparti sur plusieurs passages");
    for (const chunk of codeChunks) {
      assert.ok(chunk.body.endsWith("```"), "chaque morceau se termine par une fermeture");
    }
    const rebuilt = codeChunks
      .map((chunk) => chunk.body.split("\n").slice(1, -1).join("\n"))
      .join("\n");
    assert.deepEqual(rebuilt.split("\n"), codeLines, "les lignes de code sortent dans l'ordre, sans perte");
  });

  test("une limite inferieure a 64 caracteres est refusee", () => {
    assert.throws(() => splitMarkdown("# T", { maxChars: 10 }), /64/);
  });
});

describe("index FTS5 local", () => {
  const workdir = mkdtempSync(join(tmpdir(), "novahiz-docs-store-"));
  let db: DatabaseSync | null = null;

  const ensureDb = (): DatabaseSync => {
    if (db === null) db = openStore(join(workdir, "index.db"));
    return db;
  };

  const seed = (): DatabaseSync => {
    const store = ensureDb();
    if (countChunks(store) > 0) return store;
    indexPage(
      store,
      { library: "react", version: "19.1.0", sourceUrl: "https://example.test/react-state", license: "CC-BY-4.0" },
      splitMarkdown(readFixture("react-state.md"))
    );
    indexPage(
      store,
      { library: "querykit", version: "3.0.0", sourceUrl: "https://example.test/query-client", license: "MIT" },
      splitMarkdown(readFixture("query-client.md"))
    );
    return store;
  };

  after(() => {
    db?.close();
    rmSync(workdir, { recursive: true, force: true });
  });

  test("recherche : passage attendu avec citation complete", () => {
    const store = seed();
    const hits = search(store, "useState setter");
    assert.ok(hits.length >= 1, "au moins un passage trouvable");
    const top = hits[0];
    assert.equal(top.library, "react");
    assert.equal(top.version, "19.1.0");
    assert.equal(top.sourceUrl, "https://example.test/react-state");
    assert.equal(top.license, "CC-BY-4.0");
    assert.match(top.fetchedAt, /^\d{4}-\d{2}-\d{2}T/, "fetched_at est un horodatage ISO");
    assert.ok(top.headingPath.includes("useState hook"), "heading_path rattache le passage a sa section");
    assert.equal(typeof top.ord, "number");
    assert.ok(top.snippet.includes("["), "le snippet surligne la correspondance");
    assert.equal(typeof top.score, "number", "score BM25 present");
  });

  test("requete naturelle : tous les mots doivent tenir dans le meme passage", () => {
    const store = seed();
    const hits = search(store, "cached fresh shared");
    assert.ok(hits.length >= 1, "la page querykit contient ces mots cote a cote");
    assert.equal(hits[0].library, "querykit");
    assert.equal(search(store, "cached fresh absentmot")[0]?.library, undefined, "AND strict : un mot absent vide tout");
  });

  test("requete trop courte pour le trigramme : liste vide, jamais d'exception", () => {
    const store = seed();
    assert.deepEqual(search(store, "go"), []);
    assert.deepEqual(search(store, "   "), []);
  });

  test("filtre library : seules les pages demandees reviennent", () => {
    const store = seed();
    const both = search(store, "component", { limit: 20 });
    const libraries = new Set(both.map((hit) => hit.library));
    assert.ok(libraries.size >= 2, "le mot commun aux deux livres apparaît des deux cotes");
    const reactOnly = search(store, "component", { library: "react", limit: 20 });
    assert.ok(reactOnly.length >= 1);
    for (const hit of reactOnly) assert.equal(hit.library, "react");
  });

  test("re-indexation d'une meme page : remplacement, jamais de doublon", () => {
    const store = seed();
    const before = countChunks(store, "react");
    indexPage(
      store,
      { library: "react", version: "19.1.0", sourceUrl: "https://example.test/react-state", license: "CC-BY-4.0" },
      splitMarkdown(readFixture("react-state.md"))
    );
    assert.equal(countChunks(store, "react"), before, "le stock de chunks est stable");
    const pages = listIndexed(store).filter((page) => page.library === "react");
    assert.equal(pages.length, 1, "une seule entree par page");
    assert.equal(pages[0].chunks, before);
    assert.equal(pages[0].sourceUrl, "https://example.test/react-state");
  });

  test("toMatchQuery : phrases entre guillemets jointes par AND", () => {
    assert.equal(toMatchQuery("useState"), '"useState"');
    assert.equal(toMatchQuery("react router"), '"react" AND "router"');
    assert.equal(toMatchQuery("go to"), null, "mots de moins de 3 caracteres : injouable");
    assert.equal(toMatchQuery('never "quoted'), '"never" AND "quoted"', "aucun guillemet brut ne subsiste");
  });

  test("hors-ligne : ni fetch ni module reseau dans la couche locale", () => {
    for (const file of ["chunk.ts", "store.ts", "proto.ts"]) {
      const source = readFileSync(join(process.cwd(), "mcp", "novahiz-docs", "src", file), "utf8");
      assert.ok(!/\bfetch\s*\(/.test(source), `${file} : pas d'appel fetch`);
      assert.ok(!/from "node:(?:http|https|net|dns)"/.test(source), `${file} : pas de module reseau`);
    }
  });
});
