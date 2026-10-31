import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { bodyOf, DESCRIPTION_WARN, lintSkillFile, lintSkillFiles, lintSkills } from "../src/skilllint.ts";
import { loadSpec } from "../src/spec.ts";

/**
 * NX-33 : le contrat d'un SKILL.md est vérifié, sans jamais le modifier.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const description = "Décrit quand charger la skill, sur quarante caractères au moins.";
const corps = "## Contrat\n\n" + "Cette section explique le contrat de la skill en une phrase longue. ".repeat(4);

function fichier(nom: string, remplacements: { name?: string; description?: string; corps?: string } = {}) {
  const frontmatter = [
    "---",
    `name: ${remplacements.name ?? nom}`,
    `description: ${remplacements.description ?? description}`,
    "---",
    "",
    remplacements.corps ?? corps,
    ""
  ].join("\n");
  return { file: `C:/tmp/skills/${nom}/SKILL.md`, content: frontmatter };
}

test("une skill conforme ne produit aucun problème", () => {
  assert.deepEqual(lintSkillFile(fichier("alpha")), []);
});

test("un name absent est une erreur", () => {
  const issues = lintSkillFile(fichier("alpha", { name: "" }));
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("sans « name »")));
});

test("un name qui ne correspond pas au dossier est une erreur", () => {
  const issues = lintSkillFile(fichier("alpha", { name: "beta" }));
  assert.ok(issues.some((issue) => issue.message.includes("ne correspond pas au dossier")));
});

test("une description absente ou trop courte est une erreur", () => {
  assert.ok(lintSkillFile(fichier("alpha", { description: "" })).some((i) => i.message.includes("absente")));
  assert.ok(lintSkillFile(fichier("alpha", { description: "court" })).some((i) => i.message.includes("trop courte")));
});

test("une description longue est un avertissement, pas une erreur", () => {
  const long = "x".repeat(DESCRIPTION_WARN + 1);
  const issues = lintSkillFile(fichier("alpha", { description: long }));
  assert.equal(issues.filter((issue) => issue.severity === "error").length, 0);
  assert.ok(issues.some((issue) => issue.severity === "warning" && issue.message.includes("longue")));
});

test("un corps vide est une erreur, un corps sans titre un avertissement", () => {
  assert.ok(lintSkillFile(fichier("alpha", { corps: "" })).some((i) => i.message.includes("corps vide")));
  const sansTitre = lintSkillFile(fichier("alpha", { corps: "x".repeat(300) }));
  assert.ok(sansTitre.some((i) => i.severity === "warning" && i.message.includes("aucun titre")));
});

test("un même nom porté par deux contenus différents est une erreur", () => {
  const autre = fichier("beta", {
    name: "alpha",
    description: "Une autre description, tout aussi valable, mais qui n'est pas la même.",
  });
  const rapport = lintSkillFiles([fichier("alpha"), autre]);
  const doublons = rapport.issues.filter((issue) => issue.message.includes("contenus différents"));
  assert.equal(doublons.length, 2);
  assert.ok(rapport.errors >= 2);
});

test("un miroir d'installation n'est pas un doublon", () => {
  const source = fichier("alpha");
  const rapport = lintSkillFiles([source, { ...source, file: "C:/autre/racine/alpha/SKILL.md" }]);
  assert.deepEqual(rapport.issues, []);
});

test("bodyOf rend tout ce qui suit le frontmatter", () => {
  assert.equal(bodyOf(fichier("alpha").content).trim().startsWith("## Contrat"), true);
  assert.equal(bodyOf("pas de frontmatter"), "pas de frontmatter");
});

test("les skills installées ne produisent aucune erreur", () => {
  const rapport = lintSkills(loadSpec(repoRoot));
  // Borne tiree du depot : un checkout nu ne contient que les skills livrees.
  const livrees = readdirSync(join(repoRoot, "skills"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(join(repoRoot, "skills", entry.name, "SKILL.md")),
  ).length;
  assert.ok(rapport.checked >= livrees, `skills vérifiées : ${rapport.checked} pour ${livrees} livrées`);

  // Le conflit `impeccable` (deux versions dans deux racines) a été réglé le
  // 2026-10-31 par une réinstallation propre via le provider : une seule copie,
  // dans `~/.agents/skills`. Le lint doit désormais rester à zéro erreur.
  assert.deepEqual(
    rapport.issues.filter((issue) => issue.severity === "error"),
    [],
    "des erreurs de lint sur les skills installées",
  );
});
