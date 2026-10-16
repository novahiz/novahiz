// Nettoyage de l'ancienne installation apres une mise a jour acceptee.
//
// Ce que ces tests defendent, dans les deux sens. Un skill retire de la source
// par une nouvelle version restait charge au demarrage suivant : le correctif
// l'efface. Mais la regle inverse compte autant : un fichier que novahiz n'a
// pas ecrit — un skill ou une commande d'un pack — ne figure pas au manifeste
// d'installation et ne peut donc pas partir. C'est ce manifeste, et lui seul,
// qui fait preuve de propriete ; une regle du type "absent de la source" aurait
// detruit le pack impeccable, qui vit dans ~/.agents/skills et pas ici.
//
// Tout se passe dans un dossier temporaire : aucun home reel n'est lu ni ecrit.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import {
  cleanupPreviousInstall,
  loadManifest,
  pruneEmptyDirs,
  saveManifest,
  staleOwnedPaths,
  type OwnedRoot
} from "../install/lib.mjs";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

let home = "";
let conf = "";
let roots: OwnedRoot[] = [];

/** home + dossier de config + arbres source/destination, vierges a chaque test. */
function scaffold(): void {
  const base = mkdtempSync(join(tmpdir(), "novahiz-clean-"));
  made.push(base);
  home = join(base, "novahiz");
  conf = join(base, "opencode");
  mkdirSync(join(home, "skills"), { recursive: true });
  mkdirSync(join(home, "adapters", "opencode", "agent"), { recursive: true });
  mkdirSync(join(home, "adapters", "opencode", "commands"), { recursive: true });
  mkdirSync(join(conf, "skills"), { recursive: true });
  mkdirSync(join(conf, "plugins"), { recursive: true });
  mkdirSync(join(conf, "agent"), { recursive: true });
  mkdirSync(join(conf, "commands"), { recursive: true });
  roots = [
    { dest: join(conf, "skills"), src: join(home, "skills") },
    { dest: join(conf, "plugins"), src: join(home, "adapters", "opencode") },
    { dest: join(conf, "agent"), src: join(home, "adapters", "opencode", "agent") },
    { dest: join(conf, "commands"), src: join(home, "adapters", "opencode", "commands") }
  ];
}

/** Ecrit un fichier en creant ses parents et renvoie son chemin. */
function put(path: string, body: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
  return path;
}

beforeEach(scaffold);

describe("staleOwnedPaths", () => {
  test("retient le fichier dont la source a disparu, pas celui qui est toujours livre", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    put(join(home, "skills", "live-skill", "SKILL.md"), "x");
    const live = put(join(conf, "skills", "live-skill", "SKILL.md"), "x");
    assert.deepEqual(staleOwnedPaths([dead, live], roots), [dead]);
  });

  test("n'efface rien hors des racines declarees, meme si le manifeste le nomme", () => {
    const config = put(join(home, "novahiz.config.json"), "{}");
    const memory = put(join(home, "project-memory", "slot-001.md"), "note");
    const sqlite = put(join(home, "novahiz.sqlite"), "blob");
    assert.deepEqual(staleOwnedPaths([config, memory, sqlite], roots), []);
  });

  test("une sauvegarde part avec le fichier dont elle est la copie", () => {
    const dead = put(join(conf, "commands", "old-cmd.md"), "x");
    const backup = `${dead}.novahiz-bak`;
    put(backup, "ancienne version");
    assert.deepEqual(staleOwnedPaths([dead], roots), [dead, backup]);
  });

  test("une sauvegarde dont le fichier d'origine existe toujours reste en place", () => {
    put(join(home, "adapters", "opencode", "commands", "keep-cmd.md"), "x");
    const keep = put(join(conf, "commands", "keep-cmd.md"), "x");
    put(`${keep}.novahiz-bak`, "ancienne version");
    assert.deepEqual(staleOwnedPaths([keep], roots), []);
  });

  test("refuse une entree absente ou non chaine", () => {
    assert.deepEqual(staleOwnedPaths([null, "", undefined, 42] as unknown as string[], roots), []);
  });

  test("sans manifeste, aucun fichier n'est retenu", () => {
    put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    assert.deepEqual(staleOwnedPaths(undefined, roots), []);
    assert.deepEqual(staleOwnedPaths([], roots), []);
  });

  test("un chemin du manifeste qui n'existe plus sur disque est ignore", () => {
    const gone = join(conf, "skills", "already-gone", "SKILL.md");
    assert.deepEqual(staleOwnedPaths([gone], roots), []);
  });
});

describe("pruneEmptyDirs", () => {
  // Regression : rmSync(..., {recursive:false}) levait ERR_FS_EISDIR sur un
  // repertoire, et le catch avalait l'erreur. La fonction semblait marcher et
  // ne retirait rien — uninstall.mjs l'appelle aussi.
  test("retire un repertoire vide sans toucher a la racine", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    rmSync(dead, { force: true });
    pruneEmptyDirs([dead], [conf, join(conf, "skills")]);
    assert.equal(existsSync(join(conf, "skills", "dead-skill")), false);
    assert.equal(existsSync(join(conf, "skills")), true, "la racine skills ne doit pas partir");
  });

  test("s'arrete sur un repertoire non vide", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    pruneEmptyDirs([dead], [conf, join(conf, "skills")]);
    assert.equal(existsSync(join(conf, "skills", "dead-skill")), true, "un repertoire non vide ne doit pas partir");
    assert.equal(existsSync(dead), true);
  });
});

describe("cleanupPreviousInstall", () => {
  test("sans --clean, rien ne bouge", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    saveManifest(home, { created: [dead], backups: [] });
    const result = cleanupPreviousInstall({ home, configDir: conf, roots, clean: false });
    assert.equal(result.status, "skip");
    assert.equal(result.removed.length, 0);
    assert.equal(existsSync(dead), true);
  });

  test("un echec precedent arrete le nettoyage avant toute suppression", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    saveManifest(home, { created: [dead], backups: [] });
    const result = cleanupPreviousInstall({
      home,
      configDir: conf,
      roots,
      clean: true,
      stepFailure: "catalog sync"
    });
    assert.equal(result.status, "skip");
    assert.match(result.detail, /catalog sync/);
    assert.equal(existsSync(dead), true, "le fichier doit survivre a un echec");
  });

  test("sans manifeste, rien ne part", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    const result = cleanupPreviousInstall({ home, configDir: conf, roots, clean: true });
    assert.equal(result.removed.length, 0);
    assert.equal(existsSync(dead), true);
  });

  test("une copie ecrasee prouve la propriete autant qu'un fichier cree", () => {
    // Installation qui existait deja avant le manifeste : chaque copie
    // renvoyait created: null, seul le backup trace l'ecriture par novahiz.
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    saveManifest(home, { created: [], backups: [{ path: dead, backup: `${dead}.novahiz-bak` }] });

    const result = cleanupPreviousInstall({ home, configDir: conf, roots, clean: true });

    assert.deepEqual(result.removed, [dead]);
    assert.equal(existsSync(dead), false);
  });

  test("le mode a blanc annonce sans rien effacer", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    saveManifest(home, { created: [dead], backups: [] });
    const result = cleanupPreviousInstall({ home, configDir: conf, roots, clean: true, dryRun: true });
    assert.equal(result.removed.length, 0);
    assert.equal(existsSync(dead), true);
    assert.match(result.detail, /would be removed/);
  });

  test("l'orphelin part, le fichier conserve reste, le fichier de pack reste", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    put(join(home, "skills", "live-skill", "SKILL.md"), "x");
    const live = put(join(conf, "skills", "live-skill", "SKILL.md"), "x");
    // Pose par un pack, pas par novahiz : absent du manifeste.
    const pack = put(join(conf, "plugins", "pack-plugin.ts"), "export {};\n");
    saveManifest(home, { created: [dead, live], backups: [] });

    const result = cleanupPreviousInstall({ home, configDir: conf, roots, clean: true });

    assert.equal(result.status, "done");
    assert.deepEqual(result.removed, [dead]);
    assert.equal(existsSync(dead), false);
    assert.equal(existsSync(live), true);
    assert.equal(existsSync(pack), true, "un fichier de pack ne figure pas au manifeste");
    assert.deepEqual(loadManifest(home).created, [live], "le manifeste ne doit plus nommer l'orphelin");
  });

  test("le dossier vide de l'orphelin disparait, la racine reste", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    saveManifest(home, { created: [dead], backups: [] });
    cleanupPreviousInstall({ home, configDir: conf, roots, clean: true });
    assert.equal(existsSync(join(conf, "skills", "dead-skill")), false);
    assert.equal(existsSync(join(conf, "skills")), true, "la racine skills ne doit pas partir");
  });

  test("une sauvegarde retiree quitte aussi le champ backups du manifeste", () => {
    const dead = put(join(conf, "commands", "old-cmd.md"), "x");
    const backup = `${dead}.novahiz-bak`;
    put(backup, "ancienne version");
    saveManifest(home, { created: [dead], backups: [{ path: dead, backup }] });

    cleanupPreviousInstall({ home, configDir: conf, roots, clean: true });

    assert.equal(existsSync(backup), false);
    const manifest = loadManifest(home);
    assert.deepEqual(manifest.created, []);
    assert.deepEqual(manifest.backups, []);
  });

  test("un deuxieme passage ne trouve plus rien a effacer", () => {
    const dead = put(join(conf, "skills", "dead-skill", "SKILL.md"), "x");
    saveManifest(home, { created: [dead], backups: [] });

    const first = cleanupPreviousInstall({ home, configDir: conf, roots, clean: true });
    const second = cleanupPreviousInstall({ home, configDir: conf, roots, clean: true });

    assert.deepEqual(first.removed, [dead]);
    assert.deepEqual(second.removed, []);
    assert.equal(second.status, "done");
  });
});
