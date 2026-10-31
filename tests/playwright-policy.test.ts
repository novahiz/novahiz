import assert from "node:assert/strict";
import { test } from "node:test";

import { commandePlaywright, verifierPolitiquePlaywright } from "../src/playwright-policy.ts";

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
