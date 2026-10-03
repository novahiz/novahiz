// S2: recherche ciblee — searchSlots (fold + IDF via rankSlots) + contrats
// de score/confidence/snippet. Le corpus de 10 entrees verifie l'acceptation:
// UN appel de recherche trouve le bon slot.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureMemoryRoot, readIndex, searchSlots, writeEntry, writeIndex } from "../src/memory.ts";
import { rankSlots } from "../src/relevance.ts";

const CORPUS_TITLES = [
  "index json corruption reparation",
  "transport serveur mcp stdio",
  "enforcement gate skills",
  "rotation slots memoire compactage",
  "sondes sante doctor",
  "workflow git commits tags",
  "hooks plugin opencode session",
  "base sqlite ledger revisions",
  "graphe code analyse symboles",
  "publication npm versionnage"
];

describe("memory.ts - S2 recherche (searchSlots)", () => {
  const roots: string[] = [];

  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-s2-"));
    roots.push(root);
    return root;
  };

  const makeCorpus = (root: string): void => {
    CORPUS_TITLES.forEach((title, index) => {
      writeEntry({ root, title, content: `Notes ${index} sur ${title}` });
    });
  };

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    }
  });

  test("1 appel trouve le bon slot sur 10 entrees (acceptation S2)", () => {
    const root = makeRoot();
    makeCorpus(root);
    const result = searchSlots(root, "corruption index json", { limit: 5 });
    assert.equal(result.searched, 10);
    assert.ok(result.hits.length >= 1);
    assert.equal(result.hits[0].meta.id, "slot-001");
    assert.equal(result.hits[0].confidence, "high");
    assert.ok(result.hits[0].score >= 0.5);
    assert.deepEqual([...result.hits[0].matched].sort(), ["corruption", "index", "json"]);
    assert.ok(result.hits[0].snippet.length > 0);
    assert.ok(result.hits[0].snippet.length <= 163);
  });

  test("scores bornes dans (0,1] et tris decroissants", () => {
    const root = makeRoot();
    makeCorpus(root);
    const result = searchSlots(root, "memoire rotation slots", { limit: 10 });
    assert.ok(result.hits.length >= 1);
    let previous = 1;
    for (const hit of result.hits) {
      assert.ok(hit.score > 0 && hit.score <= 1, `score hors borne: ${hit.score}`);
      assert.ok(hit.score <= previous, "scores non tris decroissants");
      previous = hit.score;
      assert.ok(["high", "medium", "low"].includes(hit.confidence));
    }
    assert.equal(result.hits[0].meta.id, "slot-004");
  });

  test("match rare et complet > match partiel sur termes courants", () => {
    const docs = [
      { id: "a", title: "index json corruption", description: "", tags: [], text: "corruption index json" },
      { id: "b", title: "b", description: "", tags: [], text: "rien" },
      { id: "c", title: "c", description: "", tags: [], text: "index" }
    ];
    const full = rankSlots(docs, "corruption index json", 3);
    const partial = rankSlots(docs, "index", 3);
    assert.equal(full[0]?.id, "a");
    assert.ok((full[0]?.score ?? 0) > 0);
    assert.ok((full[0]?.score ?? 0) >= (partial[0]?.score ?? 1));
  });

  test("slots archives exclus par defaut, inclus avec includeArchived", () => {
    const root = makeRoot();
    makeCorpus(root);
    const index = readIndex(root);
    writeIndex(root, {
      ...index,
      slots: index.slots.map((slot) =>
        slot.id === "slot-010" ? { ...slot, status: "archived" as const } : slot
      )
    });
    const sans = searchSlots(root, "publication npm versionnage", { limit: 5 });
    assert.equal(sans.hits.length, 0);
    const avec = searchSlots(root, "publication npm versionnage", {
      limit: 5,
      includeArchived: true
    });
    assert.equal(avec.hits[0]?.meta.id, "slot-010");
    assert.equal(avec.hits[0]?.meta.status, "archived");
  });

  test("limit borne le nombre de resultats", () => {
    const root = makeRoot();
    makeCorpus(root);
    const result = searchSlots(root, "index json memoire slots git", { limit: 2 });
    assert.ok(result.hits.length <= 2);
  });

  test("requete vide ou sans token -> aucun hit, sans erreur", () => {
    const root = makeRoot();
    makeCorpus(root);
    assert.equal(searchSlots(root, "").hits.length, 0);
    assert.equal(searchSlots(root, "   ").hits.length, 0);
    assert.equal(searchSlots(root, "zzzz qqqq").hits.length, 0);
  });

  test("slot fantome (fichier absent) saute sans faire echouer la recherche", () => {
    const root = makeRoot();
    makeCorpus(root);
    const index = readIndex(root);
    writeIndex(root, {
      ...index,
      slots: [
        ...index.slots,
        {
          id: "slot-099",
          title: "fantome absence totale",
          description: "",
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          chars: 1,
          lines: 1,
          limit_chars: 8000,
          limit_lines: 200,
          status: "active",
          tags: [],
          file: "slots/ghost-absent.md"
        }
      ]
    });
    const ghost = searchSlots(root, "fantome absence totale", { limit: 5 });
    assert.equal(ghost.hits.length, 0);
    const normal = searchSlots(root, "corruption index json", { limit: 5 });
    assert.equal(normal.hits[0]?.meta.id, "slot-001");
  });

  test("racine vierge: heal silencieux et recherche vide", () => {
    const root = makeRoot();
    const result = searchSlots(root, "nimporte quoi", { limit: 5 });
    assert.equal(result.searched, 0);
    assert.equal(result.hits.length, 0);
    assert.equal(ensureMemoryRoot(root).slots.length, 0);
  });
});
