import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { claimPaths, claimedBy } from "../src/claims.ts";
import { openDb } from "../src/db.ts";
import { enforceLedgerChecks } from "../src/gate.ts";
import { recordProjectSession } from "../src/sessions.ts";
import { loadSpec } from "../src/spec.ts";

/**
 * NX-41 : le claim devient obligatoire quand `gate.claims.required` est vrai.
 * Par défaut il reste facultatif : une session seule ne paie pas l'étape.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);
const made: string[] = [];

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function projet(): { root: string; fichier: string } {
  const root = mkdtempSync(join(tmpdir(), "novahiz-claims-"));
  made.push(root);
  writeFileSync(join(root, "package.json"), "{\"name\":\"probe\"}\n", "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  return { root, fichier: join(root, "src", "a.ts") };
}

function resultat(path: string) {
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

function base(root: string) {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-claims-db-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

test("claimedBy ne renvoie rien sans claim", () => {
  const { fichier } = projet();
  const db = base(fichier);
  assert.equal(claimedBy(db, { session: "ses_me", filePath: fichier }), null);
  db.close();
});

test("claimedBy renvoie le claim du détenteur et rien pour un autre", () => {
  const { root, fichier } = projet();
  const db = base(root);
  claimPaths(db, { session: "ses_me", paths: [fichier], projectRoot: root });

  assert.equal(claimedBy(db, { session: "ses_me", filePath: fichier })?.session_id, "ses_me");
  assert.equal(claimedBy(db, { session: "ses_autre", filePath: fichier }), null);
  db.close();
});

test("claims requis : un chemin non réclamé est refusé si une autre session vit sur le projet", () => {
  const { root, fichier } = projet();
  const db = base(root);
  recordProjectSession(db, root, "ses_autre");

  const gateConfig = { ...spec.config.gate, claims: { required: true } };
  const entry = resultat(fichier);
  enforceLedgerChecks(db, {
    session: "ses_me",
    tool: "edit",
    paths: [fichier],
    categories: ["general"],
    results: [entry],
    spec,
    gateConfig,
  });

  assert.equal(entry.allow, false);
  assert.ok(entry.reasons.some((reason) => reason.includes("path not claimed")));
  db.close();
});

test("claims requis : un chemin réclamé par la session passe", () => {
  const { root, fichier } = projet();
  const db = base(root);
  recordProjectSession(db, root, "ses_autre");
  claimPaths(db, { session: "ses_me", paths: [fichier], projectRoot: root });

  const gateConfig = { ...spec.config.gate, claims: { required: true } };
  const entry = resultat(fichier);
  enforceLedgerChecks(db, {
    session: "ses_me",
    tool: "edit",
    paths: [fichier],
    categories: ["general"],
    results: [entry],
    spec,
    gateConfig,
  });

  assert.equal(entry.allow, true);
  assert.deepEqual(entry.reasons, []);
  db.close();
});

test("claims facultatifs par défaut : aucune autre session, aucun refus", () => {
  const { root, fichier } = projet();
  const db = base(root);

  const entry = resultat(fichier);
  enforceLedgerChecks(db, {
    session: "ses_me",
    tool: "edit",
    paths: [fichier],
    categories: ["general"],
    results: [entry],
    spec,
    gateConfig: spec.config.gate,
  });

  assert.equal(spec.config.gate.claims.required, false);
  assert.equal(entry.allow, true);
  db.close();
});
