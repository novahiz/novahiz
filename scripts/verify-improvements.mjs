/**
 * Vérifie les améliorations du système Novahiz appliquées le 2026-10-31.
 *
 * Chaque assertion correspond à une ligne du registre improvements.md. Le
 * script échoue si une régression réintroduit le défaut observé pendant la
 * session admin (design skills exigées sur du code, shell de vérification
 * bloqué, message de close muet sur le scope, mémoire qui fusionne à tort,
 * écran de messagerie classé « réglages »).
 *
 * Usage : node scripts/verify-improvements.mjs
 */
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { homedir } from "node:os";

import { evaluateGate } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";
import { isReadOnlyCommand } from "../src/readonly.ts";
import { planSections } from "../src/wireframe.ts";
import { DEFAULT_LIMIT_CHARS, DEFAULT_LIMIT_LINES } from "../src/memory.ts";

const root = join(homedir(), ".config", "novahiz");
const spec = loadSpec(root);
const results = [];

function check(id, label, run) {
  try {
    run();
    results.push({ id, label, ok: true });
  } catch (error) {
    results.push({ id, label, ok: false, error: String(error).slice(0, 300) });
  }
}

const gate = (overrides) =>
  evaluateGate({
    tool: "edit",
    categories: ["design-ui"],
    tier: "lite",
    loadedSkills: [],
    installedSkills: null,
    installedIndexAvailable: true,
    spec,
    ...overrides,
  });

check("NX-01", "un fichier .ts en catégorie design n'exige aucune skill design", () => {
  const result = gate({
    filePath: "app/[locale]/admin/biens/actions.ts",
    content: "x".repeat(900),
    prompt: "améliore le formulaire de nouveau bien",
  });
  for (const skill of [
    "novahiz-humanizer",
    "ui-slop-remover",
    "ui-craft-rules",
    "impeccable",
    "novahiz-wireframe",
    "novahiz-wcag-audit",
  ]) {
    assert.ok(
      !result.requiredSkills.includes(skill),
      `skill design exigée sur du code : ${skill}`,
    );
  }
});

check("NX-01b", "une vue Flutter .dart garde les skills design", () => {
  const result = gate({
    filePath: "lib/ui/features/auth/views/login_view.dart",
    content: "x".repeat(900),
    prompt: "ajoute un bouton de connexion sur l'écran d'accueil",
  });
  for (const skill of ["novahiz-humanizer", "impeccable", "novahiz-wireframe"]) {
    assert.ok(
      result.requiredSkills.includes(skill),
      `skill design perdue sur une vue Flutter : ${skill}`,
    );
  }
});

check("NX-02", "npm run typecheck et npx tsc --noEmit sont lus comme lecture seule", () => {
  assert.equal(isReadOnlyCommand("npm run typecheck"), true);
  assert.equal(isReadOnlyCommand("npx tsc --noEmit"), true);
  assert.equal(isReadOnlyCommand("npm run lint"), true);
  assert.equal(isReadOnlyCommand("npm run build"), false);
  assert.equal(isReadOnlyCommand("npm test"), false);
});

check("NX-27", "les slots mémoire acceptent 16 000 caractères et 400 lignes", () => {
  assert.equal(DEFAULT_LIMIT_CHARS, 16000);
  assert.equal(DEFAULT_LIMIT_LINES, 400);
});

check("NX-34", "« Admin — Messages » est classé en liste, pas en réglages", () => {
  const plan = planSections("Admin — Messages", "Lire les messages des clients");
  assert.equal(plan.screenClass, "list");
});

check("NX-34b", "« Admin — Biens » reste une liste", () => {
  const plan = planSections("Admin — Biens", "Lister les biens du catalogue");
  assert.equal(plan.screenClass, "list");
});

for (const result of results) {
  const line = result.ok ? "ok  " : "FAIL";
  console.log(`${line} ${result.id}  ${result.label}`);
  if (!result.ok) console.log(`     ${result.error}`);
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications vertes`);
process.exitCode = failed === 0 ? 0 : 1;
