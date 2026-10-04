// P4 — index SQLite hybride de la memoire (table `memory` + FTS5): retrieval
// via l'index avec scores 0..1 preserves, fraicheur prouvee par une ecriture
// post-synchro, repli fichiers sur base indisponible, regeneration par
// memory_rebuild, parite archive/active, et correction du cache mtime.
// La DB vit dans le repertoire temporaire des tests (jamais la ledger reelle).
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { archiveSlot, rebuildFts, searchSlots, updateSlot, writeEntry } from "../src/memory.ts";

let root: string;
let dbPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "novahiz-fts-"));
  dbPath = join(root, "ledger-test.sqlite");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("P4 - index SQLite hybride (FTS5)", () => {
  test("recherche via index: engine fts, bon hit, score 0..1", () => {
    const a = writeEntry({
      root,
      title: "verrou concurrence",
      content: "le verrou root protege les ecritures simultanees",
      tags: ["p1"]
    });
    const b = writeEntry({
      root,
      title: "budget de tokens",
      content: "linjection auto-read plafonne a 1500 tokens",
      tags: ["p3"]
    });
    assert.notEqual(a.slot.id, b.slot.id);
    const res = searchSlots(root, "budget tokens plafonne", { fts: { dbPath } });
    assert.equal(res.engine, "fts");
    assert.equal(res.hits[0]?.meta.id, b.slot.id);
    assert.ok(res.hits[0].score > 0 && res.hits[0].score <= 1);
    assert.ok(["high", "medium", "low"].includes(res.hits[0].confidence));
  });

  test("sans option fts: engine files et meme hit (parite)", () => {
    writeEntry({ root, title: "verrou concurrence", content: "le verrou root protege les ecritures simultanees" });
    const b = writeEntry({ root, title: "budget de tokens", content: "linjection auto-read plafonne a 1500 tokens" });
    const res = searchSlots(root, "budget tokens plafonne", {});
    assert.equal(res.engine, "files");
    assert.equal(res.hits[0]?.meta.id, b.slot.id);
  });

  test("fraicheur: une ecriture post-synchro est retrouvee sans re-synchro manuelle", () => {
    searchSlots(root, "premiere passe", { fts: { dbPath } }); // synchro initiale
    const c = writeEntry({
      root,
      title: "retention des archives",
      content: "les archives plus vieilles que la fenetre partent en retention"
    });
    const res = searchSlots(root, "retention archives fenetre", { fts: { dbPath } });
    assert.equal(res.engine, "fts");
    assert.equal(res.hits[0]?.meta.id, c.slot.id);
  });

  test("base indisponible (repertoire absent) -> repli fichiers sans erreur", () => {
    writeEntry({ root, title: "budget de tokens", content: "linjection auto-read plafonne a 1500 tokens" });
    const bad = join(root, "repertoire-inexistant", "x.sqlite");
    const res = searchSlots(root, "budget tokens", { fts: { dbPath: bad } });
    assert.equal(res.engine, "files");
    assert.ok(res.hits.length >= 1);
  });

  test("rebuildFts re-synchrone depuis le markdown et compte les slots", () => {
    writeEntry({ root, title: "verrou concurrence", content: "le verrou root protege les ecritures" });
    writeEntry({ root, title: "budget de tokens", content: "linjection plafonne a 1500 tokens" });
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as {
      slots: { file: string; id: string }[];
    };
    const sync = rebuildFts(dbPath, root);
    assert.ok(sync);
    assert.equal(sync.slots, index.slots.length);
    assert.equal(sync.synced, true);
  });

  test("slot declare mais fichier absent: synchro reussit a corps vide (P1)", () => {
    const a = writeEntry({ root, title: "verrou concurrence", content: "le verrou root protege les ecritures" });
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as {
      slots: { file: string; id: string }[];
    };
    assert.equal(index.slots[0].id, a.slot.id);
    rmSync(join(root, index.slots[0].file));
    const sync = rebuildFts(dbPath, root);
    // Fichier absent indexe a vide: la synchro n'echoue jamais (P1).
    assert.ok(sync);
    assert.equal(sync.slots, index.slots.length);
    // Recherche utilisable malgre tout: slot illisible = exclu du scan,
    // aucun hit plutot qu'une exception.
    const res = searchSlots(root, "verrou concurrence", { fts: { dbPath } });
    assert.equal(res.hits.length, 0);
  });

  test("archive exclue par defaut, incluse avec includeArchived", () => {
    const a = writeEntry({ root, title: "retention des archives", content: "la fenetre de retention est de 90 jours" });
    archiveSlot(a.slot.id, root);
    const hidden = searchSlots(root, "retention fenetre", { fts: { dbPath } });
    assert.equal(hidden.hits.some((hit) => hit.meta.id === a.slot.id), false);
    const shown = searchSlots(root, "retention fenetre", { fts: { dbPath }, includeArchived: true });
    assert.equal(shown.engine, "fts");
    assert.equal(shown.hits.some((hit) => hit.meta.id === a.slot.id), true);
  });

  test("cache mtime: corps relu apres ecriture (invalidation par taille/mtime)", () => {
    const a = writeEntry({ root, title: "nettoyage clean", content: "avant: verrou mort detecte" });
    searchSlots(root, "clean verrou", { fts: { dbPath } });
    searchSlots(root, "clean verrou", { fts: { dbPath } }); // passe avec cache chaud
    updateSlot({ id: a.slot.id, root, mode: "append", content: "apres: retention des archives active" });
    const res = searchSlots(root, "retention archives", { fts: { dbPath } });
    assert.equal(res.hits[0]?.meta.id, a.slot.id);
  });
});

describe("P4 - MCP one-shot: engine + memory_rebuild", () => {
  const MCP = join(process.cwd(), "mcp", "novahiz-tools", "index.mjs");
  const cwd = mkdtempSync(join(tmpdir(), "novahiz-fts-mcp-"));
  // Isole la DB des tests: la ledger reelle ne recoit aucune ligne.
  const env = { ...process.env, NOVAHIZ_DB: join(cwd, "fts.sqlite") };

  after(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const call = (tool: string, input: string) =>
    spawnSync(process.execPath, [MCP, "--call", tool], { encoding: "utf8", input, cwd, env, timeout: 60_000 });

  const payloadOf = (res: { status: number | null; stdout: string; stderr: string }): Record<string, unknown> => {
    assert.equal(res.status, 0, res.stderr);
    const envelope = JSON.parse(res.stdout.trim()) as {
      result: { content: { type: string; text: string }[] };
    };
    return JSON.parse(envelope.result.content[0].text) as Record<string, unknown>;
  };

  test("memory_search renvoie engine=fts, memory_rebuild regenere l'index derive", () => {
    const write = call(
      "memory_write",
      JSON.stringify({
        title: "index hybride memoire",
        content: "la memoire indexe en fts5 avec repli sur les fichiers markdown"
      })
    );
    assert.equal(write.status, 0, write.stderr);

    const search = payloadOf(call("memory_search", JSON.stringify({ query: "index hybride fts5", limit: 5 })));
    assert.equal(search.engine, "fts");
    const results = search.results as { id: string; score: number }[];
    assert.ok(results.length >= 1);
    assert.ok(results[0].score > 0 && results[0].score <= 1);

    const rebuild = payloadOf(call("memory_rebuild", JSON.stringify({})));
    const fts = rebuild.fts as { synced: boolean; slots?: number };
    assert.equal(fts.synced, true);
    assert.ok((fts.slots ?? 0) >= 1);
    assert.ok((rebuild.count as number) >= 1);
  });
});
