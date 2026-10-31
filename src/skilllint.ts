/**
 * Lint des skills (NX-33).
 *
 * Le frontmatter est ce que le routeur lit : un `name` absent, une description
 * vide ou un nom qui ne correspond pas au dossier produisent une skill que
 * l'agent ne trouvera pas, ou trouvera sous un autre nom. Un doublon de nom est
 * pire : `scanSkills` en garde un et jette l'autre sans le dire.
 *
 * Le lint ne modifie rien. Il sépare les erreurs (la skill est cassée) des
 * avertissements (elle fonctionne, mais son routage ou sa lisibilité se
 * dégradent). Le seuil haut de description est un avertissement : les skills
 * longues existent et restent utiles, elles perdent seulement en précision de
 * routage.
 */
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { findSkillFiles, parseFrontmatter } from "./catalog.ts";
import type { Spec } from "./spec.ts";

export type LintSeverity = "error" | "warning";

export type LintIssue = {
  skill: string;
  file: string;
  severity: LintSeverity;
  message: string;
};

export type LintReport = {
  checked: number;
  issues: LintIssue[];
  errors: number;
  warnings: number;
};

/** En dessous, la description ne dit plus quand déclencher la skill. */
export const DESCRIPTION_MIN = 40;
/** Au-delà, le routeur n'en lit que le début : la skill reste valable. */
export const DESCRIPTION_WARN = 600;
/** Un corps plus court qu'une phrase n'explique aucun contrat. */
export const BODY_MIN = 200;

/** Le corps d'un SKILL.md : tout ce qui suit le frontmatter. */
export function bodyOf(content: string): string {
  const text = content.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") return lines.slice(index + 1).join("\n");
  }
  return "";
}

/** Les problèmes d'un seul fichier, sans le comparer aux autres. */
export function lintSkillFile(input: { file: string; content: string }): LintIssue[] {
  const folder = basename(dirname(input.file));
  const frontmatter = parseFrontmatter(input.content);
  const skill = (frontmatter.name ?? "").trim() || folder;
  const issues: LintIssue[] = [];
  const add = (severity: LintSeverity, message: string): void => {
    issues.push({ skill, file: input.file, severity, message });
  };

  const name = (frontmatter.name ?? "").trim();
  if (name.length === 0) add("error", "frontmatter sans « name »");
  else if (name !== folder) add("error", `name « ${name} » ne correspond pas au dossier « ${folder} »`);

  const description = (frontmatter.description ?? "").trim();
  if (description.length === 0) add("error", "description absente");
  else if (description.length < DESCRIPTION_MIN) {
    add("error", `description trop courte (${description.length} < ${DESCRIPTION_MIN} caractères)`);
  } else if (description.length > DESCRIPTION_WARN) {
    add("warning", `description longue (${description.length} caractères) : le routeur n'en lit que le début`);
  }

  const body = bodyOf(input.content);
  if (body.trim().length === 0) {
    add("error", "corps vide");
  } else {
    if (body.trim().length < BODY_MIN) add("warning", `corps court (${body.trim().length} < ${BODY_MIN} caractères)`);
    if (!/^##\s+\S/m.test(body)) add("warning", "aucun titre de section (## …) dans le corps");
  }

  return issues;
}

/** Le lint sur une liste de fichiers déjà lus : testable sans disque. */
export function lintSkillFiles(files: readonly { file: string; content: string }[]): LintReport {
  const issues: LintIssue[] = [];
  const parNom = new Map<string, { file: string; content: string }[]>();

  for (const file of files) {
    issues.push(...lintSkillFile(file));
    const nom = (parseFrontmatter(file.content).name ?? "").trim() || basename(dirname(file.file));
    const liste = parNom.get(nom) ?? [];
    liste.push(file);
    parNom.set(nom, liste);
  }

  for (const [nom, entrées] of parNom) {
    if (entrées.length < 2) continue;
    /*
     * NX-33 : le même skill est installé dans plusieurs racines (miroir de
     * l'installeur : `~/.config/novahiz/skills`, `~/.config/opencode/skills`).
     * Ce n'est pas un doublon, c'est la même skill recopiée. Seul un nom porté
     * par des contenus différents est un vrai conflit : l'index en garde un et
     * jette l'autre sans le dire.
     */
    const contenus = new Set(entrées.map((entrée) => entrée.content.trim()));
    if (contenus.size === 1) continue;
    for (const entrée of entrées) {
      issues.push({
        skill: nom,
        file: entrée.file,
        severity: "error",
        message: `nom « ${nom} » porté par ${entrées.length} fichiers de contenus différents : l'index n'en garde qu'un`,
      });
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { checked: files.length, issues, errors, warnings: issues.length - errors };
}

/** Le lint sur les skills installées d'un home. */
export function lintSkills(spec: Spec): LintReport & { scanErrors: string[] } {
  const scanErrors: string[] = [];
  const paths = findSkillFiles(spec, scanErrors);
  const files: { file: string; content: string }[] = [];
  const issues: LintIssue[] = [];

  for (const file of paths) {
    try {
      files.push({ file, content: readFileSync(file, "utf8") });
    } catch (error) {
      issues.push({
        skill: basename(dirname(file)),
        file,
        severity: "error",
        message: `fichier illisible : ${String(error).slice(0, 120)}`,
      });
    }
  }

  const report = lintSkillFiles(files);
  const errors = report.errors + issues.length;
  return {
    checked: report.checked,
    issues: [...issues, ...report.issues],
    errors,
    warnings: report.warnings,
    scanErrors,
  };
}
