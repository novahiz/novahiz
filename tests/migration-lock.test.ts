import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { claimPaths, migrationCommand } from "../src/claims.ts";
import { openDb } from "../src/db.ts";
import { enforceLedgerChecks } from "../src/gate.ts";
import { recordProjectSession } from "../src/sessions.ts";
import { loadSpec } from "../src/spec.ts";

/**
 * NX-42 : une commande de migration sans chemin exige un claim sur le dossier
 * des migrations, dès qu'une autre session vit sur le même projet.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);
const made: string[] = [];

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function projet(): { root: string; migrations: string } {
  const root = mkdtempSync(join(tmpdir(), "novahiz-migration-"));
  made.push(root);
  writeFileSync(join(root, "package.json"), "{\"name\":\"probe\"}\n", "utf8");
  const migrations = join(root, "supabase", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function base(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-migration-db-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

/** L'entrée pathless qu'un outil shell produit. */
function entreeShell() {
  return {
    path: "",
    allow: true,
    ignored: false,
    fileClass: "other" as const,
    tier: "lite" as const,
    roadmap: null,
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

function jouer(
  db: ReturnType<typeof openDb>,
  options: { command: string; projectRoot: string; required?: boolean },
) {
  const entry = entreeShell();
  const gateConfig = {
    ...spec.config.gate,
    claims: { required: options.required ?? true },
  };
  const resultat = enforceLedgerChecks(db, {
    session: "ses_me",
    tool: "shell",
    paths: [],
    categories: ["general"],
    results: [entry],
    spec,
    gateConfig,
    command: options.command,
    projectRoot: options.projectRoot,
  });
  return { entry, resultat };
}

test("migrationCommand reconnaît les commandes qui écrivent le schéma", () => {
  assert.equal(migrationCommand("supabase db push"), true);
  assert.equal(migrationCommand("npx supabase db push --linked"), true);
  assert.equal(migrationCommand("npx prisma migrate deploy"), true);
  assert.equal(migrationCommand("prisma migrate dev --name ajout"), true);
  assert.equal(migrationCommand("npx drizzle-kit push"), true);
  assert.equal(migrationCommand("alembic upgrade head"), true);
});

test("migrationCommand laisse passer les commandes de lecture", () => {
  assert.equal(migrationCommand("supabase db lint"), false);
  assert.equal(migrationCommand("supabase migration list"), false);
  assert.equal(migrationCommand("prisma migrate status"), false);
  assert.equal(migrationCommand("npm test"), false);
  assert.equal(migrationCommand("git status"), false);
});

test("une session seule n'est pas bloquée sur une migration", () => {
  const { root } = projet();
  const db = base();
  const { entry } = jouer(db, { command: "supabase db push", projectRoot: root });
  assert.equal(entry.allow, true);
  assert.deepEqual(entry.reasons, []);
  db.close();
});

test("avec une autre session vivante, une migration non réclamée est refusée", () => {
  const { root } = projet();
  const db = base();
  recordProjectSession(db, root, "ses_autre");

  const { entry } = jouer(db, { command: "supabase db push", projectRoot: root });
  assert.equal(entry.allow, false);
  assert.ok(entry.reasons.some((reason) => reason.includes("migration command not claimed")));
  db.close();
});

test("avec un claim sur le dossier des migrations, elle passe", () => {
  const { root, migrations } = projet();
  const db = base();
  recordProjectSession(db, root, "ses_autre");
  claimPaths(db, { session: "ses_me", paths: [migrations], projectRoot: root });

  const { entry } = jouer(db, { command: "supabase db push", projectRoot: root });
  assert.equal(entry.allow, true);
  assert.deepEqual(entry.reasons, []);
  db.close();
});

test("claims désactivés : la migration passe sans claim", () => {
  const { root } = projet();
  const db = base();
  recordProjectSession(db, root, "ses_autre");

  const { entry } = jouer(db, { command: "supabase db push", projectRoot: root, required: false });
  assert.equal(entry.allow, true);
  db.close();
});
