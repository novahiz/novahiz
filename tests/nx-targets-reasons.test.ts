import assert from "node:assert/strict";
import test from "node:test";

import { hasPlaceholder } from "../src/content.ts";
import { mergeTargetReasons } from "../src/gate.ts";

/**
 * NX-04 : les raisons par cible remontent dans le message court.
 * NX-49 : le spread JavaScript n'est plus lu comme un marqueur de contenu.
 *
 * Les marqueurs sont composés à l'exécution : écrits en clair, ils
 * déclencheraient le gate sur ce fichier de test lui-même.
 */
const POINTS = ".".repeat(3);
const MARQUEUR = "TO" + "DO";

test("mergeTargetReasons conserve les raisons globales", () => {
  const result = mergeTargetReasons([{ path: "a.ts", reasons: [] }], ["global"]);
  assert.deepEqual(result, ["global"]);
});

test("mergeTargetReasons remonte une raison de cible", () => {
  const result = mergeTargetReasons([{ path: "a.ts", reasons: ["manque x"] }], []);
  assert.deepEqual(result, ["manque x"]);
});

test("mergeTargetReasons préfixe par le chemin quand une seule cible est concernée", () => {
  const result = mergeTargetReasons(
    [
      { path: "a.ts", reasons: ["problème"] },
      { path: "b.ts", reasons: [] },
    ],
    [],
  );
  assert.deepEqual(result, ["problème [a.ts]"]);
});

test("mergeTargetReasons ne préfixe pas quand toutes les cibles sont concernées", () => {
  const result = mergeTargetReasons(
    [
      { path: "a.ts", reasons: ["problème"] },
      { path: "b.ts", reasons: ["problème"] },
    ],
    [],
  );
  assert.deepEqual(result, ["problème"]);
});

test("mergeTargetReasons déduplique une raison déjà globale", () => {
  const result = mergeTargetReasons([{ path: "a.ts", reasons: ["déjà là"] }], ["déjà là"]);
  assert.deepEqual(result, ["déjà là"]);
});

test("mergeTargetReasons ignore une cible sans chemin", () => {
  const result = mergeTargetReasons([{ path: "", reasons: ["commande refusée"] }], []);
  assert.deepEqual(result, ["commande refusée"]);
});

test("le spread JavaScript n'est pas un marqueur de contenu", () => {
  const copie = "const c = [" + POINTS + "existing];";
  assert.equal(hasPlaceholder(copie), false);
  assert.equal(hasPlaceholder("const o = { " + POINTS + "existant };"), false);
  assert.equal(hasPlaceholder("const t = [" + POINTS + "a, " + POINTS + "b];"), false);
});

test("un vrai marqueur de contenu reste détecté", () => {
  assert.equal(hasPlaceholder(`// ${POINTS} existing code`), true);
  assert.equal(hasPlaceholder(`// ${POINTS} rest of the file`), true);
  assert.equal(hasPlaceholder(`// ${MARQUEUR}: brancher le service`), true);
});
