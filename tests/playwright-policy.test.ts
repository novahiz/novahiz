import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commandePlaywright, verifierPolitiquePlaywright } from "../src/playwright-policy.ts";
import { reconcilePlaywrightCommand } from "../install/lib.mjs";

/**
 * NX-37 : la politique du navigateur, vérifiée sur la configuration réelle.
 * Cycle du 2026-10-31 : `--browser=msedge` présent, `--user-data-dir` absent,
 * donc onze profils et onze états de connexion.
 */

const configAvecCommentaires = `{
  "mcp": {
    // le navigateur de vérification
    "playwright": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "@playwright/mcp@0.0.83",
        "--browser=msedge",
        "--user-data-dir=C:\\\\Users\\\\Tawhid\\\\.opencode\\\\playwright-profile"
      ],
      "timeout": 180000
    }
  }
}`;

test("la commande Playwright est lue malgré les commentaires", () => {
  const commande = commandePlaywright(configAvecCommentaires);
  assert.ok(commande);
  assert.ok(commande!.includes("--browser=msedge"));
  assert.ok(commande!.some((element) => element.startsWith("--user-data-dir=")));
});

test("sans bloc Playwright, la lecture rend null", () => {
  assert.equal(commandePlaywright(`{ "mcp": { "autre": {} } }`), null);
});

test("Edge avec un profil explicite ne pose aucun problème", () => {
  assert.deepEqual(
    verifierPolitiquePlaywright(["npx", "-y", "@playwright/mcp@0.0.83", "--browser=msedge", "--user-data-dir=C:/profil"]),
    [],
  );
});

test("un profil absent est signalé", () => {
  const problemes = verifierPolitiquePlaywright(["npx", "-y", "@playwright/mcp@0.0.83", "--browser=msedge"]);
  assert.equal(problemes.length, 1);
  assert.match(problemes[0], /user-data-dir/);
});

test("Chromium est refusé", () => {
  const problemes = verifierPolitiquePlaywright(["npx", "-y", "@playwright/mcp", "--browser=chromium", "--user-data-dir=C:/p"]);
  assert.ok(problemes.some((probleme) => probleme.includes("Chromium/Chrome")));
});

test("un navigateur non imposé est signalé", () => {
  const problemes = verifierPolitiquePlaywright(["npx", "-y", "@playwright/mcp", "--user-data-dir=C:/p"]);
  assert.ok(problemes.some((probleme) => probleme.includes("--browser=msedge")));
});

test("--isolated est signalé", () => {
  const problemes = verifierPolitiquePlaywright([
    "npx",
    "-y",
    "@playwright/mcp",
    "--browser=msedge",
    "--user-data-dir=C:/p",
    "--isolated",
  ]);
  assert.ok(problemes.some((probleme) => probleme.includes("--isolated")));
});

test("une commande absente est un problème en soi", () => {
  assert.deepEqual(verifierPolitiquePlaywright(null), ["aucune commande Playwright dans la configuration"]);
});

/**
 * L'installateur ne doit pas seulement ecrire la bonne entree : il doit
 * rattraper une entree deja posee par une version anterieure, sinon le
 * correctif NX-37 ne profite qu'aux installations neuves.
 */
test("l'installateur ajoute le profil et le navigateur manquants", () => {
  const dossier = mkdtempSync(join(tmpdir(), "novahiz-playwright-"));
  const fichier = join(dossier, "opencode.jsonc");
  writeFileSync(
    fichier,
    JSON.stringify({ mcp: { playwright: { type: "local", command: ["npx", "-y", "@playwright/mcp@0.0.83"] } } }, null, 2),
    "utf8",
  );

  const resultat = reconcilePlaywrightCommand(fichier, "win32", {});
  assert.equal(resultat.state, "corrige");

  const texte = readFileSync(fichier, "utf8");
  const commande = commandePlaywright(texte);
  assert.ok(commande);
  assert.deepEqual(verifierPolitiquePlaywright(commande), []);
  assert.ok(commande.some((token) => token === "--browser=msedge"));
  assert.ok(commande.some((token) => token.startsWith("--user-data-dir=")));
  rmSync(dossier, { recursive: true, force: true });
});

test("l'installateur remplace un navigateur interdit au lieu d'en empiler deux", () => {
  const dossier = mkdtempSync(join(tmpdir(), "novahiz-playwright-"));
  const fichier = join(dossier, "opencode.jsonc");
  writeFileSync(
    fichier,
    JSON.stringify({ mcp: { playwright: { command: ["npx", "@playwright/mcp", "--browser=chrome"] } } }, null, 2),
    "utf8",
  );

  assert.equal(reconcilePlaywrightCommand(fichier, "win32", {}).state, "corrige");
  const commande = commandePlaywright(readFileSync(fichier, "utf8"));
  assert.ok(commande);
  assert.equal(commande.filter((token) => token.startsWith("--browser=")).length, 1);
  assert.deepEqual(verifierPolitiquePlaywright(commande), []);
  rmSync(dossier, { recursive: true, force: true });
});

test("une entree deja conforme n'est pas reecrite", () => {
  const dossier = mkdtempSync(join(tmpdir(), "novahiz-playwright-"));
  const fichier = join(dossier, "opencode.jsonc");
  writeFileSync(
    fichier,
    JSON.stringify({
      mcp: { playwright: { command: ["npx", "@playwright/mcp", "--browser=msedge", "--user-data-dir=C:/p"] } },
    }, null, 2),
    "utf8",
  );
  const avant = readFileSync(fichier, "utf8");

  assert.equal(reconcilePlaywrightCommand(fichier, "win32", {}).state, "inchange");
  assert.equal(readFileSync(fichier, "utf8"), avant);
  rmSync(dossier, { recursive: true, force: true });
});

test("un fichier a commentaires est signale, jamais reecrit", () => {
  const dossier = mkdtempSync(join(tmpdir(), "novahiz-playwright-"));
  const fichier = join(dossier, "opencode.jsonc");
  writeFileSync(fichier, configAvecCommentaires, "utf8");
  const avant = readFileSync(fichier, "utf8");

  assert.equal(reconcilePlaywrightCommand(fichier, "win32", {}).state, "illisible");
  assert.equal(readFileSync(fichier, "utf8"), avant);
  rmSync(dossier, { recursive: true, force: true });
});

test("sans entree playwright, rien n'est invente", () => {
  const dossier = mkdtempSync(join(tmpdir(), "novahiz-playwright-"));
  const fichier = join(dossier, "opencode.jsonc");
  writeFileSync(fichier, JSON.stringify({ mcp: {} }), "utf8");

  assert.equal(reconcilePlaywrightCommand(fichier, "win32", {}).state, "absent");
  assert.equal(reconcilePlaywrightCommand(join(dossier, "absent.jsonc"), "win32", {}).state, "absent");
  rmSync(dossier, { recursive: true, force: true });
});
