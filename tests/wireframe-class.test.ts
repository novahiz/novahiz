import assert from "node:assert/strict";
import { test } from "node:test";

import { planSections, resumeApprobation } from "../src/wireframe.ts";

/**
 * NX-35 : la classe d'un écran se déduit du titre ET de l'objectif.
 * Cycle réel du 2026-10-31 : « Admin — Paiements » tombait en `default`
 * alors que l'écran est un registre (lignes, filtres, états vides).
 */

test("un registre de paiements est une liste", () => {
  const plan = planSections("Admin — Paiements", "Voir ce qui est dû et ce qui est encaissé, exporter le registre.");
  assert.equal(plan.screenClass, "list");
  assert.ok(plan.sections.length >= 3);
});

test("un formulaire de paiement reste un formulaire", () => {
  const plan = planSections("Formulaire de paiement", "Saisir la carte et confirmer la commande.");
  assert.equal(plan.screenClass, "form");
});

test("un écran de messages reste une liste", () => {
  assert.equal(planSections("Admin — Messages", "Lire les messages des clients").screenClass, "list");
});

test("des réglages restent des réglages", () => {
  assert.equal(planSections("Réglages du compte", "Changer le mot de passe et les préférences").screenClass, "settings");
});

test("une fiche reste une fiche", () => {
  assert.equal(planSections("Fiche d'un bien", "Lire le détail et agir dessus").screenClass, "detail");
});

test("un titre sans indice reste explicitement non décidé", () => {
  const plan = planSections("Zzz", "Rien de reconnaissable ici.");
  assert.equal(plan.screenClass, "default");
  assert.equal(plan.matchedBy, null);
});

test("l'approbation renvoie ce que la revue a vérifié", () => {
  const review = {
    slug: "admin-paiements",
    title: "Admin — Paiements",
    screenClass: "list",
    sectionCount: 4,
    minimum: 3,
    verdict: "pass",
    gaps: [],
    missingSections: [],
    questions: ["q1", "q2"],
    checkedSections: [
      { id: "01", title: "En-tête et totaux" },
      { id: "02", title: "Filtres" },
    ],
  };
  assert.deepEqual(resumeApprobation(review as never), { verdict: "pass", sections: 2, questions: 2, gaps: 0 });
});
