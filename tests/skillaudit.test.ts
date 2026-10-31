import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { auditInstalledSkills, auditSkills, measureSkill } from "../src/skillaudit.ts";
import { loadSpec } from "../src/spec.ts";

/**
 * NX-30 : l'audit mesure, il ne réécrit rien.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function skill(nom: string, corps: string) {
  return {
    file: `C:/tmp/skills/${nom}/SKILL.md`,
    content: `---\nname: ${nom}\ndescription: Une description suffisamment longue pour le lint.\n---\n\n${corps}\n`,
  };
}

const blocLong = "Cette phrase décrit un contrat stable et se répète à l'identique dans plusieurs skills, ce qui en fait un candidat sérieux à une mise en commun. Elle est volontairement longue pour dépasser le seuil de comparaison de l'audit, sans quoi le bloc ne serait jamais examiné.";

test("measureSkill compte les caractères, les lignes et les sections", () => {
  const mesure = measureSkill(skill("alpha", `## Contrat\n\n${blocLong}\n\n## Usage\n\nCourt.`));
  assert.equal(mesure.name, "alpha");
  assert.equal(mesure.sections, 2);
  assert.equal(mesure.largestSection?.title, "Contrat");
  assert.ok(mesure.chars > 100);
  assert.ok(mesure.lines >= 6);
});

test("auditSkills repère un bloc identique dans deux skills", () => {
  const rapport = auditSkills([skill("alpha", `## Contrat\n\n${blocLong}`), skill("beta", `## Contrat\n\n${blocLong}`)]);
  assert.equal(rapport.checked, 2);
  assert.equal(rapport.duplicateBlocks.length, 1);
  assert.deepEqual(rapport.duplicateBlocks[0].skills, ["alpha", "beta"]);
});

test("auditSkills ignore un bloc présent une seule fois", () => {
  const rapport = auditSkills([skill("alpha", `## Contrat\n\n${blocLong}`), skill("beta", "## Contrat\n\nUn autre texte, tout aussi long mais different de bout en bout pour ne rien partager.")]);
  assert.deepEqual(rapport.duplicateBlocks, []);
});

test("auditSkills trie les plus grosses skills en premier", () => {
  const petit = skill("petit", "## A\n\ncourt");
  const grand = skill("grand", `## A\n\n${blocLong}\n\n${blocLong}`);
  const rapport = auditSkills([petit, grand]);
  assert.equal(rapport.biggest[0].name, "grand");
  assert.ok(rapport.medianChars > 0);
});

test("l'audit des skills installées mesure sans échouer", () => {
  const rapport = auditInstalledSkills(loadSpec(repoRoot));
  // La borne vient du dépôt, pas de la machine : sur un checkout nu la CI ne
  // voit que les skills livrées (50). Un seuil fixe à 90 ne mesurait que la
  // richesse de l'installation locale.
  const livrees = readdirSync(join(repoRoot, "skills"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(join(repoRoot, "skills", entry.name, "SKILL.md")),
  ).length;
  assert.ok(rapport.checked >= livrees, `skills mesurées : ${rapport.checked} pour ${livrees} livrées`);
  assert.ok(rapport.totalChars > 0);
  assert.deepEqual(rapport.scanErrors, []);
});
