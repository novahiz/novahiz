import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { collectClaims, findClaims } from "../src/docverify.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("docs: une affirmation porte la commande qui la prouve", () => {
  test("une affirmation en fin de ligne est reconnue", () => {
    const claims = findClaims("PRODUCT.md", "- Le projet compile. <!-- verify: typecheck -->\n");
    assert.equal(claims.length, 1);
    assert.equal(claims[0].verify, "typecheck");
    assert.equal(claims[0].text, "Le projet compile.");
    assert.equal(claims[0].line, 1);
  });

  test("un marqueur seul annote la ligne suivante", () => {
    const claims = findClaims("DESIGN.md", "<!-- verify: build -->\nLe thème sombre est actif.\n");
    assert.equal(claims.length, 1);
    assert.equal(claims[0].text, "Le thème sombre est actif.");
  });

  test("expect est conservé", () => {
    const claims = findClaims("SOURCES.md", "- 42 biens. <!-- verify: catalogue expect=\"42 biens\" -->\n");
    assert.equal(claims[0].expect, "42 biens");
  });

  test("plusieurs affirmations sur des lignes différentes", () => {
    const raw = "a <!-- verify: one -->\nb\nc <!-- verify: two -->\n";
    const claims = findClaims("README.md", raw);
    assert.deepEqual(claims.map((claim) => claim.verify), ["one", "two"]);
  });

  test("un nom de commande invalide n'est pas reconnu", () => {
    const claims = findClaims("README.md", "<!-- verify: rm -rf / -->\n");
    assert.deepEqual(claims, []);
  });

  test("collectClaims lit le jeu par défaut et novahiz-docs", () => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-docverify-"));
    made.push(root);
    writeFileSync(join(root, "PRODUCT.md"), "- compile. <!-- verify: typecheck -->\n", "utf8");
    mkdirSync(join(root, "novahiz-docs"), { recursive: true });
    writeFileSync(join(root, "novahiz-docs", "ARCHITECTURE.md"), "- build ok. <!-- verify: build -->\n", "utf8");

    const claims = collectClaims(root);
    assert.deepEqual(claims.map((claim) => claim.file).sort(), ["PRODUCT.md", "novahiz-docs/ARCHITECTURE.md"]);
  });

  test("un fichier demandé explicitement est lu, même hors du jeu par défaut", () => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-docverify-"));
    made.push(root);
    writeFileSync(join(root, "NOTES.md"), "- ok. <!-- verify: tests -->\n", "utf8");
    const claims = collectClaims(root, ["NOTES.md"]);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].file, "NOTES.md");
  });
});
