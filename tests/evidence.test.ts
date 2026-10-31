import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import { listEvidence, loadVerifyConfig, runVerification } from "../src/evidence.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(commands: Record<string, string> | null): { root: string; db: ReturnType<typeof openDb> } {
  const root = mkdtempSync(join(tmpdir(), "novahiz-evidence-"));
  made.push(root);
  if (commands) {
    mkdirSync(join(root, ".novahiz"), { recursive: true });
    writeFileSync(join(root, ".novahiz", "verify.json"), JSON.stringify({ commands }), "utf8");
  }
  return { root, db: openDb(join(root, "ledger.sqlite")) };
}

describe("verify: une preuve est exécutée, pas déclarée", () => {
  test("une commande qui réussit produit une preuve ok avec hash et fichier", () => {
    const { root, db } = project({ pass: "node -p 1" });
    const outcome = runVerification(db, { projectRoot: root, name: "pass", session: "ses_test" });

    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.hash, /^[a-f0-9]{32}$/);
    assert.ok(outcome.evidenceId.startsWith("ev_"));
    assert.ok(outcome.evidenceFile, "un fichier de preuve doit être écrit");
    assert.match(outcome.outputTail, /1/);

    const rows = listEvidence(db, { limit: 5 });
    db.close();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "pass");
    assert.equal(rows[0].ok, 1);
    assert.equal(rows[0].hash, outcome.hash);
  });

  test("une commande qui échoue est enregistrée comme échec, avec son code de sortie", () => {
    const { root, db } = project({ fail: 'node -e "process.exit(3)"' });
    const outcome = runVerification(db, { projectRoot: root, name: "fail" });
    const rows = listEvidence(db, { limit: 5 });
    db.close();

    assert.equal(outcome.ok, false);
    assert.equal(outcome.exitCode, 3);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, 0);
    assert.equal(rows[0].exit_code, 3);
  });

  test("expect rend la preuve négative quand la sortie ne contient pas le texte", () => {
    const { root, db } = project({ echo: "node -p 2" });
    const outcome = runVerification(db, { projectRoot: root, name: "echo", expect: "absent" });
    db.close();

    assert.equal(outcome.ok, false);
    assert.equal(outcome.exitCode, 0);
    assert.match(String(outcome.error), /expected output to contain/);
  });

  test("un nom non déclaré est refusé en listant les commandes disponibles", () => {
    const { root, db } = project({ tests: "node -p 1" });
    const outcome = runVerification(db, { projectRoot: root, name: "rm-rf" });
    db.close();

    assert.equal(outcome.ok, false);
    assert.ok(String(outcome.error).includes("unknown verification"));
    assert.ok(String(outcome.error).includes("Declared: tests"));
  });

  test("sans fichier de configuration, la vérification explique quoi déclarer", () => {
    const { root, db } = project(null);
    const outcome = runVerification(db, { projectRoot: root, name: "tests" });
    db.close();

    assert.equal(outcome.ok, false);
    assert.ok(String(outcome.error).includes("no verify config at .novahiz/verify.json"));
  });

  test("la config refuse une commande vide et un nom invalide", () => {
    const { root, db } = project({ "not a name": "node -p 1", empty: "   " });
    db.close();
    const config = loadVerifyConfig(root);
    assert.ok("error" in config);
  });
});
