import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { diffManifest, manifestHealth, manifestPath, readManifest, writeManifest } from "../src/manifest.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "novahiz-manifest-"));
  made.push(home);
  mkdirSync(join(home, "src"), { recursive: true });
  writeFileSync(join(home, "src", "gate.ts"), "export const gate = 1;\n", "utf8");
  writeFileSync(join(home, "package.json"), JSON.stringify({ name: "novahiz", version: "1.0.0" }), "utf8");
  return home;
}

describe("manifest: distinguer natif, appris et modifie", () => {
  test("un sync frais ne montre aucune derive", () => {
    const home = makeHome();
    const manifest = writeManifest(home, { now: new Date("2026-01-01T00:00:00Z") });

    assert.equal(manifest.origin, "baseline");
    assert.equal(Object.keys(manifest.files).length, 2);
    const diff = diffManifest(home);
    assert.equal(diff.present, true);
    assert.deepEqual(diff.modified, []);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.missing, []);
    assert.equal(diff.unchanged, 2);
  });

  test("un fichier modifie est signale", () => {
    const home = makeHome();
    writeManifest(home);
    writeFileSync(join(home, "src", "gate.ts"), "export const gate = 2;\n", "utf8");

    const diff = diffManifest(home);
    assert.deepEqual(diff.modified, ["src/gate.ts"]);
    assert.equal(diff.unchanged, 1);
    assert.equal(manifestHealth(home).ok, true, "une modification attendue n'est pas une anomalie");
  });

  test("un fichier ajoute est signale", () => {
    const home = makeHome();
    writeManifest(home);
    writeFileSync(join(home, "src", "learned.ts"), "export const learned = true;\n", "utf8");

    assert.deepEqual(diffManifest(home).added, ["src/learned.ts"]);
  });

  test("un fichier disparu rend le manifeste inutilisable comme reference", () => {
    const home = makeHome();
    writeManifest(home);
    unlinkSync(join(home, "src", "gate.ts"));

    const diff = diffManifest(home);
    assert.deepEqual(diff.missing, ["src/gate.ts"]);
    const health = manifestHealth(home);
    assert.equal(health.ok, false);
    assert.match(health.detail, /1 missing/);
  });

  test("sans manifeste, diff ne pretend pas que tout va bien", () => {
    const home = makeHome();
    const diff = diffManifest(home);
    assert.equal(diff.present, false);
    assert.equal(diff.total, 0);
    assert.equal(manifestHealth(home).ok, false);
    assert.match(manifestHealth(home).detail, /manifest sync/);
  });

  test("un manifeste peut decrire un autre arbre que la maison", () => {
    // After an install, the shipped bytes live in the package, not in whatever
    // edits landed in the home. Recording them keeps "native" honest.
    const home = makeHome();
    const pkg = mkdtempSync(join(tmpdir(), "novahiz-pkg-"));
    made.push(pkg);
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(join(pkg, "src", "gate.ts"), "export const gate = 'shipped';\n", "utf8");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "novahiz", version: "9.9.9" }), "utf8");

    const manifest = writeManifest(home, { origin: "package", sourceRoot: pkg });
    assert.equal(manifest.origin, "package");
    assert.deepEqual(Object.keys(manifest.files).sort(), ["package.json", "src/gate.ts"]);
    assert.match(readFileSync(join(pkg, "src", "gate.ts"), "utf8"), /shipped/);
  });

  test("re-sync conserve createdAt et met a jour updatedAt", () => {
    const home = makeHome();
    writeManifest(home, { now: new Date("2026-01-01T00:00:00Z") });
    const second = writeManifest(home, { origin: "package", now: new Date("2026-02-01T00:00:00Z") });

    assert.equal(second.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(second.updatedAt, "2026-02-01T00:00:00.000Z");
    assert.equal(second.origin, "package");
    assert.equal(readManifest(home)!.origin, "package");
    assert.ok(readFileSync(manifestPath(home), "utf8").includes("package"));
  });
});
