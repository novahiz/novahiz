// S2 : le bouquet curé et la résolution locale. Deux promesses vérifiées —
// resolve() rend le bon identifiant catalogue pour un nom, un alias ou une
// faute de frappe, et chaque entrée du bouquet est complète et unique.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadCatalog, getEntry } from "../mcp/novahiz-docs/src/catalog.ts";
import { resolve, similarity } from "../mcp/novahiz-docs/src/resolve.ts";

const catalog = loadCatalog();

describe("bouquet curé", () => {
  test("taille cible : ~50 bibliotheques", () => {
    assert.ok(catalog.length >= 45, `catalogue trop mince : ${catalog.length}`);
    assert.ok(catalog.length <= 60, `catalogue trop gros : ${catalog.length}`);
  });

  test("chaque entree est complete : id unique, depot, docs, llmsTxt net", () => {
    const ids = new Set<string>();
    for (const entry of catalog) {
      assert.ok(entry.id.length > 0, "id non vide");
      assert.ok(!ids.has(entry.id), `id duplique : ${entry.id}`);
      ids.add(entry.id);
      assert.ok(entry.name.length > 0, `nom absent pour ${entry.id}`);
      assert.match(entry.repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, `depot invalide pour ${entry.id}`);
      assert.ok(entry.docsUrl.startsWith("https://"), `docsUrl invalide pour ${entry.id}`);
      assert.ok(entry.llmsTxt === null || entry.llmsTxt.startsWith("https://"), `llmsTxt invalide pour ${entry.id}`);
      assert.ok(Array.isArray(entry.aliases), `aliases absent pour ${entry.id}`);
    }
  });

  test("couverture multi-ecosystemes (le bouquet n'est pas qu'un monorepo JS)", () => {
    const ecosystems = new Set(catalog.map((entry) => entry.ecosystem));
    for (const expected of ["npm", "pypi", "dart", "go", "crates"]) {
      assert.ok(ecosystems.has(expected), `ecosysteme absent : ${expected}`);
    }
  });

  test("le plateau llms.txt reflete les mesures : null quand non mesure", () => {
    const react = getEntry("react");
    assert.ok(react);
    assert.equal(react.llmsTxt, "https://react.dev/llms.txt", "llms.txt mesure en 200 le 04/10/2026");
    const dart = getEntry("dart");
    assert.ok(dart);
    assert.equal(dart.llmsTxt, null, "dart.dev ne sert pas de llms.txt (mesure 404)");
  });
});

describe("résolution locale", () => {
  test("nom canonique : nextjs -> nextjs, score maximal", () => {
    const hits = resolve("nextjs", catalog);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].entry.id, "nextjs");
    assert.equal(hits[0].score, 100);
    assert.equal(hits[0].matchedOn, "id");
  });

  test("alias : next / next.js / Next.js convergent vers nextjs", () => {
    for (const alias of ["next", "next.js", "Next.js"]) {
      const hits = resolve(alias, catalog);
      assert.equal(hits[0]?.entry.id, "nextjs", `alias ${alias} non resolu`);
      assert.equal(hits[0]?.matchedOn, "alias");
    }
  });

  test("alias d'un autre registre : reactjs -> react, golang -> go", () => {
    assert.equal(resolve("reactjs", catalog)[0]?.entry.id, "react");
    assert.equal(resolve("golang", catalog)[0]?.entry.id, "go");
    assert.equal(resolve("react query", catalog)[0]?.entry.id, "tanstack-query");
  });

  test("prefixe et sous-chaîne : type -> typescript, router -> reactrouter", () => {
    const prefix = resolve("type", catalog);
    assert.equal(prefix[0]?.entry.id, "typescript");
    assert.equal(prefix[0]?.matchedOn, "prefix");
    const substring = resolve("router", catalog);
    assert.equal(substring[0]?.entry.id, "reactrouter");
    assert.equal(substring[0]?.matchedOn, "substring");
  });

  test("faute de frappe : le dice trigramme remonte la bonne bibliotheque", () => {
    const hits = resolve("reacr", catalog);
    assert.equal(hits[0]?.entry.id, "react", `top obtenu : ${hits[0]?.entry.id}`);
    assert.equal(hits[0]?.matchedOn, "fuzzy");
    assert.ok(hits[0].score >= 40);
  });

  test("requete vide ou injouable : aucune proposition, sans exception", () => {
    assert.deepEqual(resolve("", catalog), []);
    assert.deepEqual(resolve("   ", catalog), []);
    assert.deepEqual(resolve("zzzzzzqqq", catalog), []);
  });

  test("determinisme : deux appels identiques, meme liste dans le meme ordre", () => {
    const first = resolve("re", catalog, { limit: 8 }).map((hit) => `${hit.entry.id}:${hit.score}`);
    const second = resolve("re", catalog, { limit: 8 }).map((hit) => `${hit.entry.id}:${hit.score}`);
    assert.deepEqual(first, second);
  });

  test("limit borne le nombre de propositions", () => {
    const hits = resolve("e", catalog, { limit: 3 });
    assert.ok(hits.length <= 3);
  });

  test("similarity : 1 sur textes identiques, 0 sur textes disjoints", () => {
    assert.equal(similarity("react", "react"), 1);
    assert.equal(similarity("react", "zzzzzz"), 0);
  });
});
