// Nettoyage des fichiers retires du paquet (install/retired.json, install/lib.mjs).
//
// Le manifeste d'installation ne connait pas les fichiers copies par une
// version anterieure a l'invention du champ `created`. Sans cet inventaire, un
// home traverse par plusieurs versions garde des installateurs morts que
// `--clean` ne voit pas : c'est exactement ce qui est arrive entre 0.10.0 et
// 0.11.0. La preuve de propriete devient le contenu, jamais le chemin seul :
// seule une empreinte identique autorise la suppression. Ce fichier verrouille
// les deux moities de la regle, ce qui part et ce qui reste.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { cleanupPreviousInstall, normalisedSha256, retiredOwnedPaths } from "../install/lib.mjs";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "novahiz-retired-"));
  made.push(home);
  return home;
}

/** Ecrit `content` dans <home>/<relative>, en creant les dossiers parents. */
function seed(home: string, relative: string, content: string): string {
  const target = join(home, relative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
  return target;
}

const SHIPPED = "#!/usr/bin/env node\nconsole.log('ancien installateur');\n";
const DIGEST = normalisedSha256(SHIPPED);

function inventory(path = "install/bootstrap.mjs", sha256 = DIGEST) {
  return { files: [{ path, version: "0.11.0", sha256 }] };
}

describe("normalisedSha256 : une empreinte stable d'une machine a l'autre", () => {
  test("CRLF et LF donnent la meme empreinte", () => {
    assert.equal(normalisedSha256(SHIPPED.replace(/\n/g, "\r\n")), DIGEST);
  });

  test("un contenu different change l'empreinte", () => {
    assert.notEqual(normalisedSha256(`${SHIPPED}// retouche\n`), DIGEST);
  });
});

describe("retiredOwnedPaths : le contenu autorise, le chemin non", () => {
  test("fichier intact : il est candidat au retrait", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", SHIPPED.replace(/\n/g, "\r\n"));

    const scan = retiredOwnedPaths(inventory(), home);

    assert.deepEqual(scan.removed, [target]);
    assert.deepEqual(scan.kept, []);
  });

  test("fichier retouche a la main : il reste et il est dit", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", `${SHIPPED}// ajout local\n`);

    const scan = retiredOwnedPaths(inventory(), home);

    assert.deepEqual(scan.removed, []);
    assert.deepEqual(scan.kept, [target]);
  });

  test("fichier absent : rien a dire", () => {
    const home = tempHome();
    const scan = retiredOwnedPaths(inventory(), home);
    assert.deepEqual(scan.removed, []);
    assert.deepEqual(scan.kept, []);
  });

  test("un chemin qui sort du home est ignore", () => {
    const home = tempHome();
    const outside = join(home, "..", "novahiz-echappe.txt");
    writeFileSync(outside, SHIPPED);
    try {
      const scan = retiredOwnedPaths(inventory("../novahiz-echappe.txt"), home);
      assert.deepEqual(scan.removed, []);
      assert.equal(existsSync(outside), true);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe("cleanupPreviousInstall : --clean seul, et sous conditions", () => {
  test("sans --clean, aucun fichier ne bouge", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", SHIPPED);

    const result = cleanupPreviousInstall({ home, configDir: home, roots: [], clean: false, retired: inventory() });

    assert.equal(result.status, "skip");
    assert.deepEqual(result.removed, []);
    assert.equal(existsSync(target), true);
  });

  test("dry-run : le fichier est annonce, rien n'est supprime", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", SHIPPED);

    const result = cleanupPreviousInstall({
      home,
      configDir: home,
      roots: [],
      clean: true,
      dryRun: true,
      retired: inventory()
    });

    assert.equal(result.status, "skip");
    assert.deepEqual(result.stale, [target]);
    assert.equal(existsSync(target), true);
  });

  test("run reel : le fichier part, le manifeste est datte", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", SHIPPED);

    const result = cleanupPreviousInstall({ home, configDir: home, roots: [], clean: true, retired: inventory() });

    assert.equal(result.status, "done");
    assert.deepEqual(result.removed, [target]);
    assert.equal(existsSync(target), false);
    const manifest = JSON.parse(readFileSync(join(home, ".novahiz-install.json"), "utf8"));
    assert.equal(typeof manifest.cleanedAt, "string");
  });

  test("un fichier retouche survit au nettoyage", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", `${SHIPPED}// retouche\n`);

    const result = cleanupPreviousInstall({ home, configDir: home, roots: [], clean: true, retired: inventory() });

    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.kept, [target]);
    assert.equal(existsSync(target), true);
  });

  test("une etape precedente en echec annule le nettoyage", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", SHIPPED);

    const result = cleanupPreviousInstall({
      home,
      configDir: home,
      roots: [],
      clean: true,
      stepFailure: "Core files",
      retired: inventory()
    });

    assert.equal(result.status, "skip");
    assert.deepEqual(result.removed, []);
    assert.equal(existsSync(target), true);
  });

  test("sans inventaire, le comportement d'avant est conserve", () => {
    const home = tempHome();
    const target = seed(home, "install/bootstrap.mjs", SHIPPED);

    const result = cleanupPreviousInstall({ home, configDir: home, roots: [], clean: true });

    assert.deepEqual(result.removed, []);
    assert.equal(existsSync(target), true);
  });
});
