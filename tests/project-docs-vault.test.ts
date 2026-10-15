// Écriture automatique de la documentation projet dans le vault Obsidian.
//
// Ce que l'on épingle ici n'est pas seulement "les 4 fichiers arrivent" — c'est
// surtout ce qui NE doit PAS arriver : aucun dossier inventé, aucun fichier
// fabriqué, aucune écriture en dry-run, et une entrée de journal unique par jour
// plutôt que doublonnée à chaque flush.
//
// Aucun vault réel n'est lu ni écrit : tout part dans le répertoire temporaire,
// avec les deux surcharges documentées par le contrat (NOVAHIZ_SM_VAULT,
// NOVAHIZ_SM_MEMORY).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROJECT_DOC_FILES, syncProjectDocsToVault } from "../src/commands/second-memory.ts";
import { ensureProjectAutoDocsConfig, flushAutoDocs } from "../src/commands/autodocs.ts";
import { markDirty, readState } from "../src/autodocs.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Avant le premier loadStructure() : le catalogue doit être celui du dépôt.
process.env.NOVAHIZ_HOME = repoRoot;

const made: string[] = [];
const savedVault = process.env.NOVAHIZ_SM_VAULT;
const savedMemory = process.env.NOVAHIZ_SM_MEMORY;

type Fixture = {
  vault: string;
  mem: string;
  docs: string;
  /** Rel du dossier projet créé par `project-init`, du modèle Code/Mobile. */
  target: string;
};

/** Un vault + une racine mémoire + un `novahiz-docs/` privés à ce test. */
function fixture(prefix: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), prefix));
  made.push(root);
  const f: Fixture = {
    vault: join(root, "vault"),
    mem: join(root, "mem"),
    docs: join(root, "novahiz-docs"),
    target: "Code/Mobile/docs/mon-app"
  };
  mkdirSync(f.vault, { recursive: true });
  mkdirSync(f.mem, { recursive: true });
  mkdirSync(f.docs, { recursive: true });
  process.env.NOVAHIZ_SM_VAULT = f.vault;
  process.env.NOVAHIZ_SM_MEMORY = f.mem;
  return f;
}

/** Simule `project-init --apply` : binding + chaîne de dossiers + `_MOC.md`. */
function linkedProject(f: Fixture, domain = "Code", branch = "Mobile"): void {
  writeFileSync(
    join(f.mem, "vault.json"),
    JSON.stringify({ "mon-app": { domain, branch } }),
    "utf8"
  );
  mkdirSync(join(f.vault, domain, branch, "docs", "mon-app"), { recursive: true });
  writeFileSync(join(f.vault, domain, branch, "docs", "_MOC.md"), `# ${branch} docs\n`, "utf8");
}

/** Les 4 fichiers de doc, avec un contenu distinct pour détecter un mélange. */
function writeDocs(f: Fixture, files: readonly string[] = PROJECT_DOC_FILES): void {
  for (const file of files) {
    writeFileSync(join(f.docs, file), `# ${file}\n\ncontenu de ${file}\n`, "utf8");
  }
}

after(() => {
  if (savedVault === undefined) delete process.env.NOVAHIZ_SM_VAULT;
  else process.env.NOVAHIZ_SM_VAULT = savedVault;
  if (savedMemory === undefined) delete process.env.NOVAHIZ_SM_MEMORY;
  else process.env.NOVAHIZ_SM_MEMORY = savedMemory;
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("syncProjectDocsToVault — écriture", () => {
  test("copie les 4 fichiers dans <branche>/docs/<slug>/ et journalise", () => {
    const f = fixture("novahiz-vault-seed-");
    linkedProject(f);
    writeDocs(f);

    const r = syncProjectDocsToVault("Mon App", f.docs, true);

    assert.equal(r.apply, true);
    assert.equal(r.domain, "Code");
    assert.equal(r.branch, "Mobile");
    assert.equal(r.slug, "mon-app");
    assert.equal(r.target, f.target);
    assert.deepEqual(r.warnings, [], "aucune anomalie sur un projet lié");
    assert.deepEqual(r.absent, []);
    assert.deepEqual([...r.copied].sort(), [...PROJECT_DOC_FILES].sort());

    // Le contenu doit être un miroir octet à octet, pas une réécriture.
    for (const file of PROJECT_DOC_FILES) {
      const mirrored = join(f.vault, f.target, file);
      assert.equal(existsSync(mirrored), true, `${file} doit exister dans le vault`);
      assert.equal(readFileSync(mirrored, "utf8"), readFileSync(join(f.docs, file), "utf8"));
    }

    const log = readFileSync(join(f.vault, "log.md"), "utf8");
    assert.match(log, /## \d{4}-\d{2}-\d{2}/, "une section de date");
    assert.ok(
      log.includes(`project docs synced: ${f.target} (4 file(s))`),
      "le journal nomme la cible et le nombre de fichiers"
    );
  });

  test("un second passage réécrit dans la même section de jour (pas de doublon)", () => {
    const f = fixture("novahiz-vault-idem-");
    linkedProject(f);
    writeDocs(f);

    syncProjectDocsToVault("Mon App", f.docs, true);
    writeFileSync(join(f.docs, "ARCHITECTURE.md"), "# ARCHITECTURE.md\n\nv2\n", "utf8");
    const second = syncProjectDocsToVault("Mon App", f.docs, true);

    assert.deepEqual(second.warnings, []);
    assert.equal(readFileSync(join(f.vault, f.target, "ARCHITECTURE.md"), "utf8"), "# ARCHITECTURE.md\n\nv2\n");

    const log = readFileSync(join(f.vault, "log.md"), "utf8");
    const headings = log.split("\n").filter((line) => line.startsWith("## "));
    assert.equal(headings.length, 1, "les deux écritures partagent la section du jour");
    assert.equal(log.split("\n").filter((line) => line.includes("project docs synced:")).length, 2);
  });

  test("un fichier absent du projet est signalé, jamais fabriqué", () => {
    const f = fixture("novahiz-vault-absent-");
    linkedProject(f);
    writeDocs(f, ["ARCHITECTURE.md", "CONVENTIONS.md"]);

    const r = syncProjectDocsToVault("Mon App", f.docs, true);

    assert.deepEqual(r.copied, ["ARCHITECTURE.md", "CONVENTIONS.md"]);
    assert.deepEqual(r.absent, ["DECISIONS.md", "STANDARDS.md"]);
    assert.equal(existsSync(join(f.vault, f.target, "DECISIONS.md")), false, "pas d'étublage");
    assert.equal(existsSync(join(f.vault, f.target, "STANDARDS.md")), false, "pas d'étublage");
  });
});

describe("syncProjectDocsToVault — garde-fous", () => {
  test("sans binding : aucun dossier créé, retour du conseil project-init", () => {
    const f = fixture("novahiz-vault-nobind-");
    writeDocs(f);

    const r = syncProjectDocsToVault("Mon App", f.docs, true);

    assert.deepEqual(r.copied, []);
    assert.equal(r.target, "");
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /no vault binding/);
    assert.match(r.warnings[0], /project-init --name mon-app --branch/);
    assert.equal(existsSync(join(f.vault, "Code")), false, "aucun domaine inventé");
  });

  test("binding hors catalogue : le vault a bougé, on ne crée rien", () => {
    const f = fixture("novahiz-vault-stale-");
    writeDocs(f);
    linkedProject(f, "Nope", "Nope");

    const r = syncProjectDocsToVault("Mon App", f.docs, true);

    assert.deepEqual(r.copied, []);
    assert.equal(r.domain, "", "un domaine dont la branche manque n'est pas un chemin");
    assert.equal(r.branch, "");
    assert.match(r.warnings[0] ?? "", /unknown branch/);
    assert.match(r.warnings[0] ?? "", /Nope\/Nope/, "le nom reste lisible dans l'avertissement");
    assert.equal(existsSync(join(f.vault, "Code")), false);
  });

  test("dossier cible absent : on ne l'invente pas (contrainte 1)", () => {
    const f = fixture("novahiz-vault-nocible-");
    writeDocs(f);
    // Binding seul : la chaîne de dossiers n'a jamais été posée par project-init.
    writeFileSync(
      join(f.mem, "vault.json"),
      JSON.stringify({ "mon-app": { domain: "Code", branch: "Mobile" } }),
      "utf8"
    );

    const r = syncProjectDocsToVault("Mon App", f.docs, true);

    assert.deepEqual(r.copied, []);
    assert.equal(r.target, "");
    assert.match(r.warnings[0] ?? "", /target folder missing: Code\/Mobile\/docs\/mon-app/);
    assert.equal(existsSync(join(f.vault, "Code")), false, "la chaîne n'est pas devinée");
  });

  test("branche sans feuille docs : pas de dépôt de doc par défaut", () => {
    const f = fixture("novahiz-vault-noleaf-");
    writeDocs(f);
    // Projects/Active n'a ni memory ni docs dans le catalogue.
    linkedProject(f, "Projects", "Active");

    const r = syncProjectDocsToVault("Mon App", f.docs, true);

    assert.deepEqual(r.copied, []);
    assert.match(r.warnings[0] ?? "", /carries no docs leaf/);
    assert.equal(existsSync(join(f.vault, "Projects/Active/docs/mon-app/ARCHITECTURE.md")), false);
  });

  test("sans novahiz-docs : renvoi vers `novahiz init`, rien d'écrit", () => {
    const f = fixture("novahiz-vault-nodir-");
    linkedProject(f);

    const r = syncProjectDocsToVault("Mon App", join(f.vault, "..", "absent-docs"), true);

    assert.deepEqual(r.copied, []);
    assert.match(r.warnings[0] ?? "", /run `novahiz init`/);
    assert.equal(existsSync(join(f.vault, f.target, "ARCHITECTURE.md")), false);
  });
});

describe("syncProjectDocsToVault — dry-run", () => {
  test("préviens sans écrire : ni note, ni entrée de journal", () => {
    const f = fixture("novahiz-vault-dry-");
    linkedProject(f);
    writeDocs(f);

    const r = syncProjectDocsToVault("Mon App", f.docs, false);

    assert.equal(r.apply, false);
    // `copied` liste ce qui SERAIT copié — c'est le rapport, pas l'écriture.
    assert.deepEqual([...r.copied].sort(), [...PROJECT_DOC_FILES].sort());
    assert.deepEqual(r.warnings, []);
    assert.equal(existsSync(join(f.vault, f.target, "ARCHITECTURE.md")), false, "aucun fichier écrit");
    assert.equal(existsSync(join(f.vault, "log.md")), false, "aucune trace d'un dry-run");
  });
});

describe("flushAutoDocs — le vault ne peut pas casser le flush", () => {
  /** Un projet valide mais SANS binding vault : le cas le plus courant de
   *  tous, celui d'un projet qui n'a jamais été lié. Le flush doit y passer. */
  function unboundProject(prefix: string): string {
    const f = fixture(prefix);
    const cwd = join(dirname(f.docs), "app");
    const docs = join(cwd, "novahiz-docs");
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, "ARCHITECTURE.md"), "# Architecture\n\n## Recent changes\n", "utf8");
    writeFileSync(join(cwd, "package.json"), '{"name":"mon-app","version":"1.0.0"}', "utf8");
    return cwd;
  }

  test("sans binding : flush flushed, vaultDocs nul, dirty vidé", () => {
    const cwd = unboundProject("novahiz-flush-nobind-");
    assert.equal(ensureProjectAutoDocsConfig(cwd), "created");
    markDirty(cwd, "src/ai/parser.ts");

    const outcome = flushAutoDocs(cwd);

    assert.equal(outcome.status, "flushed", "l'absence de vault ne doit pas faire échouer le flush");
    assert.equal(outcome.docsUpdated, true, "ARCHITECTURE.md est bien mis à jour");
    assert.equal(outcome.vaultDocs, null, "rien à signaler quand il n'y a pas de copie");
    // L'état doit être vidé : sinon le flush rejoue à chaque exécution.
    assert.equal(readState(cwd).pending.length, 0, "pas de boucle de reflush");
    assert.equal(readState(cwd).dirty, false);
  });
});
