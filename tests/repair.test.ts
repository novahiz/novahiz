import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { applyRepair, repair, repairChecks } from "../src/repair.ts";
import { listBackups } from "../src/backup.ts";
import { diffManifest } from "../src/manifest.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A home with a plausible index and nothing else: enough for the checks that
 *  do not need a catalog to load. */
function makeHome(options: { index?: boolean } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "novahiz-repair-"));
  made.push(home);
  writeFileSync(join(home, "package.json"), JSON.stringify({ name: "novahiz", version: "0.0.0" }), "utf8");
  if (options.index !== false) {
    mkdirSync(join(home, "build"), { recursive: true });
    writeFileSync(join(home, "build", "installed-skills.json"), JSON.stringify([{ name: "novahiz-plan" }]), "utf8");
  }
  mkdirSync(join(home, "src"), { recursive: true });
  writeFileSync(join(home, "src", "gate.ts"), "export const gate = 1;\n", "utf8");
  return home;
}

const check = (home: string, id: string) => repairChecks(home).find((entry) => entry.id === id)!;

describe("repair: liste blanche, effet prouve", () => {
  test("un index absent est signale et reparable", () => {
    const home = makeHome({ index: false });
    const result = check(home, "skills-index");
    assert.match(String(result.problem), /absent/);
    assert.equal(result.fixable, true);
  });

  test("un index vide est signale", () => {
    const home = makeHome({ index: false });
    mkdirSync(join(home, "build"), { recursive: true });
    writeFileSync(join(home, "build", "installed-skills.json"), "[]", "utf8");
    assert.match(String(check(home, "skills-index").problem), /vide/);
  });

  test("un index illisible est signale", () => {
    const home = makeHome({ index: false });
    mkdirSync(join(home, "build"), { recursive: true });
    writeFileSync(join(home, "build", "installed-skills.json"), "{ pas du json", "utf8");
    assert.match(String(check(home, "skills-index").problem), /illisible/);
  });

  test("sans catalogue, la reparation de l'index s'execute mais le probleme persiste", () => {
    const home = makeHome({ index: false });
    const outcome = applyRepair(home, "skills-index");
    assert.equal(outcome.applied, true);
    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error), /persiste/);
  });

  test("sans base, l'integrite du ledger est saine et ne cree rien", () => {
    const home = makeHome();
    const result = check(home, "ledger-integrity");
    assert.equal(result.problem, null);
    assert.equal(existsSync(join(home, "novahiz.sqlite")), false);
  });

  test("une base corrompue n'est pas reparable a chaud", () => {
    const home = makeHome();
    writeFileSync(join(home, "novahiz.sqlite"), "ceci n'est pas une base", "utf8");
    const result = check(home, "ledger-integrity");
    assert.ok(result.problem, "un fichier illisible doit etre signale");
    assert.equal(result.fixable, false);
    assert.match(String(result.reason), /restaure depuis un instantane/);  });

  test("une baseline absente se cree, et la verification passe ensuite", () => {
    const home = makeHome();
    assert.match(String(check(home, "backup-missing").problem), /aucun instantane/);

    const outcome = applyRepair(home, "backup-missing", new Date("2026-10-29T12:00:00Z"));
    assert.equal(outcome.ok, true, outcome.error ?? "");
    assert.equal(outcome.before, "aucun instantane native");
    assert.equal(outcome.after, "sain");
    assert.equal(listBackups(home).filter((meta) => meta.kind === "native").length, 1);
    assert.equal(check(home, "backup-missing").problem, null);
  });

  test("un manifeste absent se cree quand rien ne peut le contredire", () => {
    const home = makeHome();
    const before = check(home, "manifest-missing");
    assert.equal(before.fixable, true);

    const outcome = applyRepair(home, "manifest-missing");
    assert.equal(outcome.ok, true, outcome.error ?? "");
    const diff = diffManifest(home);
    assert.equal(diff.present, true);
    assert.equal(diff.origin, "baseline");
  });

  test("un instantane existant rend le manifeste non reparable : il masquerait la derive", () => {
    const home = makeHome();
    applyRepair(home, "backup-missing");

    const result = check(home, "manifest-missing");
    assert.equal(result.fixable, false);
    assert.match(String(result.reason), /masquerait la derive/);
    const outcome = applyRepair(home, "manifest-missing");
    assert.equal(outcome.applied, false);
    assert.match(String(outcome.error), /masquerait la derive/);
  });

  test("sans --apply, repair ne produit aucun effet", () => {
    const home = makeHome();
    const report = repair(home);
    assert.ok(report.checks.length > 0);
    assert.deepEqual(report.outcomes, []);
    assert.equal(listBackups(home).length, 0);
  });

  test("un identifiant hors liste blanche est refuse", () => {
    const home = makeHome();
    const outcome = applyRepair(home, "gate");
    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error), /reparation inconnue/);
    assert.match(String(outcome.error), /skills-index/);
  });

  test("une reparation deja saine ne fait rien et reste verte", () => {
    const home = makeHome();
    applyRepair(home, "backup-missing");
    const again = applyRepair(home, "backup-missing");
    assert.equal(again.applied, false);
    assert.equal(again.ok, true);
    assert.equal(again.after, "deja sain");
  });
});
