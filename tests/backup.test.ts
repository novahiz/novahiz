import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import {
  backupHealth,
  createBackup,
  listBackups,
  readManifest,
  restoreBackup,
  verifyBackup,
} from "../src/backup.ts";
import { hashText } from "../src/fingerprint.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A minimal home: two system files, one package.json, plus noise that must stay out. */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "novahiz-backup-"));
  made.push(home);
  mkdirSync(join(home, "src"), { recursive: true });
  mkdirSync(join(home, "catalog"), { recursive: true });
  mkdirSync(join(home, "tmp"), { recursive: true });
  mkdirSync(join(home, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(home, "src", "gate.ts"), "export const gate = 1;\n", "utf8");
  writeFileSync(join(home, "catalog", "rules.json"), "[]\n", "utf8");
  writeFileSync(join(home, "package.json"), JSON.stringify({ name: "novahiz", version: "9.9.9" }), "utf8");
  writeFileSync(join(home, "tmp", "dev.log"), "noise\n", "utf8");
  writeFileSync(join(home, "node_modules", "left-pad", "index.js"), "noise\n", "utf8");
  return home;
}

const t0 = new Date("2026-01-01T10:00:00Z");
const at = (seconds: number): Date => new Date(t0.getTime() + seconds * 1000);

describe("backup: un instantane qui se prouve", () => {
  test("create copie les fichiers systeme et ignore le bruit", () => {
    const home = makeHome();
    const meta = createBackup(home, { kind: "native", now: t0 });

    assert.equal(meta.kind, "native");
    assert.equal(meta.version, "9.9.9");
    assert.equal(meta.fileCount, 3, "src/gate.ts, catalog/rules.json, package.json");
    assert.deepEqual(Object.keys(readManifest(home, meta.id)!.files).sort(), [
      "catalog/rules.json",
      "package.json",
      "src/gate.ts",
    ]);
    assert.equal(verifyBackup(home, meta.id).ok, true);
  });

  test("node_modules, tmp et les fichiers hors liste blanche ne sont pas sauvegardes", () => {
    const home = makeHome();
    writeFileSync(join(home, "notes-perso.txt"), "hors liste\n", "utf8");
    const meta = createBackup(home, { kind: "native", now: t0 });
    const files = Object.keys(readManifest(home, meta.id)!.files);
    assert.equal(files.some((rel) => rel.includes("node_modules")), false);
    assert.equal(files.some((rel) => rel.startsWith("tmp/")), false);
    assert.equal(files.includes("notes-perso.txt"), false);
  });

  test("verify detecte un fichier altere dans l'instantane", () => {
    const home = makeHome();
    const meta = createBackup(home, { kind: "native", now: t0 });
    writeFileSync(join(home, "backups", meta.id, "files", "src", "gate.ts"), "tampered\n", "utf8");

    const result = verifyBackup(home, meta.id);
    assert.equal(result.ok, false);
    assert.equal(result.mismatches.length, 1);
    assert.equal(result.mismatches[0].path, "src/gate.ts");
  });

  test("verify detecte un fichier ajoute hors manifeste", () => {
    const home = makeHome();
    const meta = createBackup(home, { kind: "native", now: t0 });
    writeFileSync(join(home, "backups", meta.id, "files", "src", "extra.ts"), "intrus\n", "utf8");

    const result = verifyBackup(home, meta.id);
    assert.equal(result.ok, false);
    assert.deepEqual(result.extra, ["src/extra.ts"]);
  });

  test("auto-improve garde 2 versions, native n'est jamais purge", () => {
    const home = makeHome();
    createBackup(home, { kind: "auto-improve", now: at(1) });
    createBackup(home, { kind: "auto-improve", now: at(2) });
    createBackup(home, { kind: "auto-improve", now: at(3) });
    const improves = listBackups(home).filter((meta) => meta.kind === "auto-improve");
    assert.equal(improves.length, 2);

    for (let index = 0; index < 3; index += 1) createBackup(home, { kind: "native", now: at(10 + index) });
    assert.equal(listBackups(home).filter((meta) => meta.kind === "native").length, 3);
  });

  test("restore remet le contenu d'origine et sauvegarde l'etat avant", () => {
    const home = makeHome();
    const meta = createBackup(home, { kind: "native", now: t0 });
    writeFileSync(join(home, "src", "gate.ts"), "broken\n", "utf8");

    const result = restoreBackup(home, meta.id, { now: at(60) });
    assert.equal(result.ok, true);
    assert.deepEqual(result.written, ["src/gate.ts"]);
    assert.equal(result.unchanged, 2);
    assert.equal(readFileSync(join(home, "src", "gate.ts"), "utf8"), "export const gate = 1;\n");
    assert.ok(result.preRestore);
    assert.equal(result.preRestore!.kind, "pre-restore");
    // L'etat casse reste retrouvable : c'est ce qui rend la restauration reversible.
    const saved = readManifest(home, result.preRestore!.id)!.files["src/gate.ts"];
    assert.equal(saved.sha256, hashText("broken\n"));
  });

  test("restore refuse un instantane corrompu et n'ecrit rien", () => {
    const home = makeHome();
    const meta = createBackup(home, { kind: "native", now: t0 });
    writeFileSync(join(home, "backups", meta.id, "files", "src", "gate.ts"), "tampered\n", "utf8");
    writeFileSync(join(home, "src", "gate.ts"), "current\n", "utf8");

    const result = restoreBackup(home, meta.id);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /failed verification/);
    assert.deepEqual(result.written, []);
    assert.equal(readFileSync(join(home, "src", "gate.ts"), "utf8"), "current\n");
  });

  test("dry-run annonce les changements sans ecrire", () => {
    const home = makeHome();
    const meta = createBackup(home, { kind: "native", now: t0 });
    writeFileSync(join(home, "src", "gate.ts"), "changed\n", "utf8");

    const result = restoreBackup(home, meta.id, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.written, ["src/gate.ts"]);
    assert.equal(result.preRestore, null);
    assert.equal(readFileSync(join(home, "src", "gate.ts"), "utf8"), "changed\n");
  });

  test("prune supprime un fichier systeme absent de l'instantane, et seulement sur demande", () => {
    const home = makeHome();
    const meta = createBackup(home, { kind: "native", now: t0 });
    writeFileSync(join(home, "src", "learned.ts"), "appris\n", "utf8");

    const withoutPrune = restoreBackup(home, meta.id, { now: at(30) });
    assert.equal(withoutPrune.ok, true);
    assert.deepEqual(withoutPrune.pruned, []);
    assert.equal(readFileSync(join(home, "src", "learned.ts"), "utf8"), "appris\n");

    writeFileSync(join(home, "src", "learned.ts"), "appris\n", "utf8");
    const withPrune = restoreBackup(home, meta.id, { prune: true, now: at(60) });
    assert.deepEqual(withPrune.pruned, ["src/learned.ts"]);
    assert.throws(() => readFileSync(join(home, "src", "learned.ts"), "utf8"));
  });

  test("health: rouge sans baseline, vert avec un instantane verifie", () => {
    const home = makeHome();
    assert.equal(backupHealth(home).ok, false);
    createBackup(home, { kind: "native", now: t0 });
    const health = backupHealth(home);
    assert.equal(health.ok, true);
    assert.match(health.detail, /native 1/);
  });
});
