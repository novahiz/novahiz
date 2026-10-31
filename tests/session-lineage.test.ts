import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { claimPaths } from "../src/claims.ts";
import { openDb } from "../src/db.ts";
import { enforceLedgerChecks } from "../src/gate.ts";
import { parentOf, recordSessionLink, sessionFamily } from "../src/lineage.ts";
import { recordProjectSession } from "../src/sessions.ts";
import { loadSpec } from "../src/spec.ts";

/**
 * NX-43 : un sous-agent ouvre sa propre session dans le même arbre.
 * La lignée fait de l'enfant un héritier des claims du parent, pas un inconnu.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);
const made: string[] = [];

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function base(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-lineage-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

function projet(): { root: string; fichier: string } {
  const root = mkdtempSync(join(tmpdir(), "novahiz-lineage-proj-"));
  made.push(root);
  writeFileSync(join(root, "package.json"), "{\"name\":\"probe\"}\n", "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  return { root, fichier: join(root, "src", "a.ts") };
}

function entree(path: string) {
  return {
    path,
    allow: true,
    ignored: false,
    fileClass: "code" as const,
    tier: "lite" as const,
    roadmap: "general",
    requiredSkills: [],
    missingSkills: [],
    unmatchedRequired: [],
    presentButMissingOnDisk: [],
    matchedRules: [],
    indexMissing: false,
    placeholder: false,
    reasons: [] as string[],
  };
}

test("un lien parent → enfant est enregistré et relu", () => {
  const db = base();
  assert.deepEqual(recordSessionLink(db, { child: "ses_enfant", parent: "ses_parent" }), { recorded: true });
  assert.equal(parentOf(db, "ses_enfant"), "ses_parent");
  assert.equal(parentOf(db, "ses_parent"), null);
  db.close();
});

test("un lien vide ou réflexif est refusé", () => {
  const db = base();
  assert.equal(recordSessionLink(db, { child: "", parent: "ses_parent" }).recorded, false);
  assert.equal(recordSessionLink(db, { child: "ses_x", parent: "" }).recorded, false);
  assert.equal(recordSessionLink(db, { child: "ses_x", parent: "ses_x" }).recorded, false);
  db.close();
});

test("la famille remonte et descend la chaîne", () => {
  const db = base();
  recordSessionLink(db, { child: "ses_enfant", parent: "ses_parent" });
  recordSessionLink(db, { child: "ses_petit", parent: "ses_enfant" });

  assert.deepEqual([...sessionFamily(db, "ses_parent")].sort(), ["ses_enfant", "ses_parent", "ses_petit"]);
  assert.deepEqual([...sessionFamily(db, "ses_enfant")].sort(), ["ses_enfant", "ses_parent", "ses_petit"]);
  assert.deepEqual([...sessionFamily(db, "ses_petit")].sort(), ["ses_enfant", "ses_parent", "ses_petit"]);
  db.close();
});

test("un cycle ne boucle pas", () => {
  const db = base();
  recordSessionLink(db, { child: "ses_a", parent: "ses_b" });
  recordSessionLink(db, { child: "ses_b", parent: "ses_a" });

  const famille = sessionFamily(db, "ses_a");
  assert.deepEqual([...famille].sort(), ["ses_a", "ses_b"]);
  db.close();
});

test("un enfant hérite du claim de son parent", () => {
  const { root, fichier } = projet();
  const db = base();
  recordProjectSession(db, root, "ses_tiers");
  recordSessionLink(db, { child: "ses_enfant", parent: "ses_parent" });
  claimPaths(db, { session: "ses_parent", paths: [fichier], projectRoot: root });

  const entry = entree(fichier);
  enforceLedgerChecks(db, {
    session: "ses_enfant",
    tool: "edit",
    paths: [fichier],
    categories: ["general"],
    results: [entry],
    spec,
    gateConfig: { ...spec.config.gate, claims: { required: true } },
  });

  assert.equal(entry.allow, true);
  assert.deepEqual(entry.reasons, []);
  db.close();
});

test("un claim détenu par une session étrangère bloque toujours l'enfant", () => {
  const { root, fichier } = projet();
  const db = base();
  recordSessionLink(db, { child: "ses_enfant", parent: "ses_parent" });
  claimPaths(db, { session: "ses_tiers", paths: [fichier], projectRoot: root });

  const entry = entree(fichier);
  enforceLedgerChecks(db, {
    session: "ses_enfant",
    tool: "edit",
    paths: [fichier],
    categories: ["general"],
    results: [entry],
    spec,
    gateConfig: spec.config.gate,
  });

  assert.equal(entry.allow, false);
  assert.ok(entry.reasons.some((reason) => reason.includes("path claimed by session ses_tiers")));
  db.close();
});

test("le parent n'est pas compté comme une autre session pour son enfant", () => {
  const { root, fichier } = projet();
  const db = base();
  recordProjectSession(db, root, "ses_parent");
  recordSessionLink(db, { child: "ses_enfant", parent: "ses_parent" });

  const entry = entree(fichier);
  enforceLedgerChecks(db, {
    session: "ses_enfant",
    tool: "edit",
    paths: [fichier],
    categories: ["general"],
    results: [entry],
    spec,
    gateConfig: { ...spec.config.gate, claims: { required: true } },
  });

  // Sans la lignée, le parent vivant déclencherait « path not claimed ».
  assert.equal(entry.allow, true);
  assert.deepEqual(entry.reasons, []);
  db.close();
});
