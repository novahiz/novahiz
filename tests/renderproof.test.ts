import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeHtml, hasBlockingRenderFinding } from "../src/renderproof.ts";
import { entetesRender } from "../src/commands/render.ts";

/**
 * NX-38 : preuve de rendu textuelle — l'HTML rendu, lu et jugé sans capture.
 */

const pageSaine = `<!doctype html>
<html lang="fr">
<head><title>Accueil — Sejournia</title></head>
<body>
<header><nav><a href="/">Accueil</a></nav></header>
<main>
  <h1>Réserver un séjour</h1>
  <h2>Sélection</h2>
  <img src="a.jpg" alt="Villa">
  <label for="ville">Ville</label>
  <input id="ville" name="ville">
  <button type="button">Chercher</button>
</main>
<footer>Mentions</footer>
</body>
</html>`;

const codes = (html: string): string[] => analyzeHtml(html).findings.map((finding) => finding.code);

test("une page saine ne produit aucun constat", () => {
  const rapport = analyzeHtml(pageSaine);
  assert.deepEqual(rapport.findings, []);
  assert.equal(rapport.title, "Accueil — Sejournia");
  assert.equal(rapport.lang, "fr");
  assert.equal(rapport.h1, "Réserver un séjour");
  assert.equal(rapport.counts.landmarks, 4);
  assert.equal(hasBlockingRenderFinding(rapport), false);
});

test("titre et langue manquants sont bloquants", () => {
  const rapport = analyzeHtml("<html><body><main><h1>x</h1></main></body></html>");
  assert.ok(codes("<html><body><main><h1>x</h1></main></body></html>").includes("title-missing"));
  assert.ok(codes("<html><body><main><h1>x</h1></main></body></html>").includes("lang-missing"));
  assert.equal(hasBlockingRenderFinding(rapport), true);
});

test("une image sans alt est bloquante, alt vide accepté", () => {
  const sans = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><img src="a.jpg"></main></body></html>`;
  assert.ok(codes(sans).includes("img-alt-missing"));

  const decorative = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><img src="a.jpg" alt=""></main></body></html>`;
  assert.ok(!codes(decorative).includes("img-alt-missing"));
});

test("un lien ou un bouton sans nom accessible est bloquant", () => {
  const html = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><a href="/x"><img src="i.png" alt=""></a><button></button></main></body></html>`;
  const trouves = codes(html);
  assert.ok(trouves.includes("link-name-missing"));
  assert.ok(trouves.includes("button-name-missing"));
});

test("un bouton avec aria-label est nommé", () => {
  const html = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><button aria-label="Fermer"></button></main></body></html>`;
  assert.ok(!codes(html).includes("button-name-missing"));
});

test("un champ sans label est signalé, un champ labellisé non", () => {
  const sans = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><input name="q"></main></body></html>`;
  assert.ok(codes(sans).includes("input-label-missing"));

  const avec = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><label for="q">Recherche</label><input id="q"></main></body></html>`;
  assert.ok(!codes(avec).includes("input-label-missing"));
});

test("un identifiant dupliqué est bloquant", () => {
  const html = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><div id="a"></div><div id="a"></div></main></body></html>`;
  const rapport = analyzeHtml(html);
  assert.ok(rapport.findings.some((f) => f.code === "id-duplicate"));
  assert.equal(rapport.counts.duplicateIds, 1);
});

test("tabindex positif et saut de plan de titres sont des avertissements", () => {
  const html = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><h3>saut</h3><button tabindex="3">x</button></main></body></html>`;
  const trouves = codes(html);
  assert.ok(trouves.includes("tabindex-positive"));
  assert.ok(trouves.includes("heading-jump"));
});

test("un style en ligne est signalé en information", () => {
  const html = `<html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><div style="color:red">x</div></main></body></html>`;
  const rapport = analyzeHtml(html);
  assert.equal(rapport.counts.inlineStyles, 1);
  assert.ok(rapport.findings.some((f) => f.code === "inline-styles" && f.severity === "info"));
});

test("sans option, seule l'acceptation HTML est envoyée", () => {
  assert.deepEqual(entetesRender({}), { accept: "text/html" });
});

test("les cookies sont joints en une seule en-tête", () => {
  assert.equal(entetesRender({ cookie: "sb-access-token=abc, sb-refresh-token=def" }).cookie, "sb-access-token=abc; sb-refresh-token=def");
});

test("un cookie sans '=' est ignoré", () => {
  assert.equal(entetesRender({ cookie: "bidon, a=1" }).cookie, "a=1");
});

test("un en-tête porte ses deux-points sans être coupé", () => {
  const entetes = entetesRender({ header: "Authorization: Bearer a:b:c" });
  assert.equal(entetes.authorization, "Bearer a:b:c");
});

test("plusieurs en-têtes se séparent par une barre verticale", () => {
  const entetes = entetesRender({ header: "X-Test: 1|Authorization: Bearer z" });
  assert.equal(entetes["x-test"], "1");
  assert.equal(entetes.authorization, "Bearer z");
});

test("un en-tête mal formé est ignoré", () => {
  assert.deepEqual(entetesRender({ header: "sans-deux-points" }), { accept: "text/html" });
});
