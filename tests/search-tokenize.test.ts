// Suite de tests du tokenizeur Lodestone (src/search/tokenize.ts) : decoupage
// camelCase/snake_case/chiffres, colonne d'ombre (expandLine) et construction
// d'expressions MATCH surs — les guillemets protegent la syntaxe FTS5, les
// termes vides ou sans alphanumeriques sont rejetes.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildMatchQuery, expandLine, splitIdentifier } from "../src/search/tokenize.ts";

describe("splitIdentifier", () => {
  test("camelCase et PascalCase", () => {
    assert.deepEqual(splitIdentifier("getUserById"), ["get", "User", "By", "Id"]);
    assert.deepEqual(splitIdentifier("HTTPServer"), ["HTTP", "Server"]);
  });

  test("separateurs et frontieres lettre/chiffre", () => {
    assert.deepEqual(splitIdentifier("get_user_by_id"), ["get", "user", "by", "id"]);
    assert.deepEqual(splitIdentifier("utf8Decoder"), ["utf", "8", "Decoder"]);
    assert.deepEqual(splitIdentifier("src/graph/store.ts"), ["src", "graph", "store", "ts"]);
  });

  test("mots simples inchanges", () => {
    assert.deepEqual(splitIdentifier("function"), ["function"]);
  });
});

describe("expandLine", () => {
  test("ajoute les sous-tokens invisibles au tokenizer", () => {
    const expanded = expandLine("const userId = getUserById(x);").toLowerCase();
    for (const piece of ["get", "user", "by", "id"]) {
      assert.ok(expanded.includes(piece), `missing ${piece} in ${expanded}`);
    }
  });

  test("ne duplique pas les mots deja separés", () => {
    assert.equal(expandLine("get user by id"), "");
  });

  test("ignore les lignes sans identifiant compose", () => {
    assert.equal(expandLine("return null;"), "");
  });
});

describe("buildMatchQuery", () => {
  test("terme simple entre guillemets", () => {
    const built = buildMatchQuery("memory");
    assert.equal(built?.expr, '"memory"');
    assert.equal(built?.op, "AND");
  });

  test("terme camelCase : branche entiere OU branche sous-tokens", () => {
    const built = buildMatchQuery("getUserById");
    assert.equal(built?.expr, '("getUserById" OR ("get" AND "User" AND "By" AND "Id"))');
  });

  test("plusieurs termes en AND par defaut, OR sur demande", () => {
    assert.equal(buildMatchQuery("memory slot")?.expr, '"memory" AND "slot"');
    assert.equal(buildMatchQuery("memory slot", { op: "OR" })?.expr, '"memory" OR "slot"');
  });

  test("prefixe sur le dernier terme seulement", () => {
    assert.equal(buildMatchQuery("memory slot", { prefix: true })?.expr, '"memory" AND "slot"*');
  });

  test("rejette les requetes sans lettre ni chiffre", () => {
    assert.equal(buildMatchQuery("   "), null);
    assert.equal(buildMatchQuery("--- ***"), null);
  });

  test("les guillemets ne peuvent pas casser le quoting", () => {
    const built = buildMatchQuery('say "hi" now');
    assert.ok(built !== null);
    assert.ok(!built.expr.includes('""hi""'), "quotes must be dropped, not escaped");
    assert.ok(built.expr.includes('"say"'));
    assert.ok(built.expr.includes('"now"'));
  });

  test("borne le nombre de termes et leur longueur", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(" ");
    const built = buildMatchQuery(many);
    assert.equal(built?.terms.length, 12);
    const long = buildMatchQuery("x".repeat(200));
    assert.ok(long !== null);
    assert.ok(long.expr.length < 200);
  });
});
