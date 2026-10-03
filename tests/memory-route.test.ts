// S4: routage de qualite — mots-outils FR/EN exclus du score, poids IDF du
// corpus actif (ln((N+1)/(df+1))+1), Resume des slots actifs dans le score,
// rankTargetSlot qui expose le score (findTargetSlot = wrapper S0), et
// confidence derivee du routage (bornes 0.5 / 0.25 comme memory_search).
// Le test A/B verifie l'acceptation: 10 ecritures d'un meme sujet -> 0 slot
// parasite.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ROUTE_MIN_SCORE,
  buildRouteIdf,
  createSlot,
  findTargetSlot,
  rankTargetSlot,
  relatedness,
  updateSlot,
  writeEntry
} from "../src/memory.ts";

describe("S4 - routage qualite (stopwords, IDF, Resume, confidence)", () => {
  const roots: string[] = [];

  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-routetest-"));
    roots.push(root);
    return root;
  };

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    }
  });

  describe("mots-outils FR/EN exclus du routage", () => {
    test("chaine faite uniquement de mots-outils -> 0 des deux cotes", () => {
      assert.equal(relatedness("le la les des une que qui", "the and for with that this"), 0);
      assert.equal(relatedness("les des", "the and"), 0);
    });

    test("ecritures jumelles evaluees egales avec et sans mots-outils", () => {
      const withStop = relatedness("release des tests", "release les metriques");
      const without = relatedness("release tests", "release metriques");
      assert.equal(withStop, without);
      assert.equal(withStop, 0.5);
    });
  });

  describe("IDF du corpus actif", () => {
    test("poids optionnel: zebra=2 fait passer le score de 1/2 a 2/3", () => {
      const plain = relatedness("zebra foo", "zebra bar");
      const weighted = relatedness("zebra foo", "zebra bar", new Map([["zebra", 2]]));
      assert.equal(plain, 0.5);
      assert.ok(Math.abs(weighted - 2 / 3) < 1e-12);
      assert.ok(weighted > plain);
    });

    test("sans carte de poids, la formule S0 est inchangee", () => {
      assert.equal(relatedness("alpha", "alpha beta gamma delta"), 0.25);
      assert.equal(relatedness("alpha beta gamma", "alpha beta gamma"), 1);
    });

    test("buildRouteIdf: ln((N+1)/(df+1))+1, df croissant -> idf decroissant", () => {
      const idf = buildRouteIdf(["novahiz ledger", "novahiz release", "novahiz"]);
      // df=3=N -> ln(4/4)+1 = 1 exactement (token universel = neutre).
      assert.ok(Math.abs((idf.get("novahiz") ?? 0) - 1) < 1e-12);
      // df=1 -> ln(4/2)+1.
      const rare = Math.log(4 / 2) + 1;
      assert.ok(Math.abs((idf.get("ledger") ?? 0) - rare) < 1e-12);
      assert.ok((idf.get("ledger") ?? 0) > (idf.get("novahiz") ?? 0));
      assert.ok((idf.get("release") ?? 0) > (idf.get("novahiz") ?? 0));
    });
  });

  describe("Resume des slots actifs dans le score", () => {
    test("Resume reecrit: titre disjoint retrouve le slot (aucun slot parasite)", () => {
      const root = makeRoot();
      const first = writeEntry({ root, title: "alpha beta gamma delta", content: "ligne une" });
      assert.equal(first.slot.id, "slot-001");
      updateSlot({ id: "slot-001", root, mode: "summary", summary: "jardinage rosace serre" });
      const routed = writeEntry({ root, title: "jardinage rosace serre", content: "ligne deux" });
      assert.equal(routed.created, false);
      assert.equal(routed.slot.id, "slot-001");
      assert.equal(routed.index.slots.length, 1);
    });

    test("rankTargetSlot expose le score; findTargetSlot ne garde que le slot", () => {
      const root = makeRoot();
      const made = createSlot(root, { title: "alpha beta gamma delta" });
      const rank = rankTargetSlot(made.index, root, { title: "alpha" });
      assert.ok(rank);
      assert.equal(rank.slot.id, made.meta.id);
      assert.equal(rank.score, 0.25);
      const target = findTargetSlot(made.index, root, { title: "alpha" });
      assert.equal(target?.id, made.meta.id);
    });

    test("slotId explicite: score maximal (correspondance dirigeee)", () => {
      const root = makeRoot();
      const made = createSlot(root, { title: "sujet un" });
      const rank = rankTargetSlot(made.index, root, { title: "totallement disjoint", slotId: made.meta.id });
      assert.ok(rank);
      assert.equal(rank.score, 1);
    });
  });

  describe("confidence derivee du routage", () => {
    test("seuil expose: ROUTE_MIN_SCORE = 0.25 (valeur S0 inchangee)", () => {
      assert.equal(ROUTE_MIN_SCORE, 0.25);
    });

    test("aucun slot assorti -> created true + confidence low", () => {
      const root = makeRoot();
      const first = writeEntry({ root, title: "alpha beta gamma delta", content: "a" });
      assert.equal(first.created, true);
      assert.equal(first.confidence, "low");
    });

    test("titre identique -> score 1 -> confidence high (duplicate compris)", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma delta", content: "a" });
      const second = writeEntry({ root, title: "alpha beta gamma delta", content: "b" });
      assert.equal(second.created, false);
      assert.equal(second.confidence, "high");
      const repeated = writeEntry({ root, title: "alpha beta gamma delta", content: "a" });
      assert.equal(repeated.duplicate, true);
      assert.equal(repeated.confidence, "high");
    });

    test("score 0.4 (dans [0.25, 0.5)) -> confidence medium", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma delta", content: "a" });
      // 2 tokens partages sur 5 -> 2/5 = 0.4: routage reussi, pas high.
      const partial = writeEntry({ root, title: "alpha beta omega phi psi", content: "b" });
      assert.equal(partial.created, false);
      assert.equal(partial.confidence, "medium");
    });

    test("score 0.2 < 0.25 -> non route: created true + confidence low", () => {
      const root = makeRoot();
      writeEntry({ root, title: "alpha beta gamma delta epsilon", content: "a" });
      const weak = writeEntry({ root, title: "alpha", content: "b" });
      assert.equal(weak.created, true);
      assert.equal(weak.confidence, "low");
      assert.equal(weak.index.slots.length, 2);
    });
  });

  describe("A/B: 10 ecritures d'un meme sujet -> 0 slot parasite", () => {
    test("sujet repeté routé vers slot-001, sujet disjoint cree slot-002", () => {
      const root = makeRoot();
      writeEntry({ root, title: "novahiz release ledger", content: "amorce du ledger" });
      for (let i = 1; i <= 10; i += 1) {
        const result = writeEntry({
          root,
          title: `novahiz release ledger mesure ${i}`,
          content: `mesure ${i} du ledger`
        });
        assert.equal(result.created, false, `ecriture ${i} ne doit pas creer de slot`);
        assert.equal(result.slot.id, "slot-001");
        assert.equal(result.index.slots.length, 1);
      }
      const other = writeEntry({ root, title: "jardinage rosace serre", content: "sujet disjoint" });
      assert.equal(other.created, true);
      assert.equal(other.slot.id, "slot-002");
      assert.equal(other.index.slots.length, 2);
    });
  });
});
