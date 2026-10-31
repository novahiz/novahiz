/**
 * Audit des skills (NX-30 à NX-32) — mesure, aucune réécriture.
 *
 * Compresser ou fusionner des skills sans chiffres revient à réécrire du
 * contenu au hasard. L'audit donne ce qui manque pour décider : taille par
 * skill, plus grosse section, et blocs de texte strictement identiques
 * présents dans plusieurs skills — les seuls candidats à une fusion vraiment
 * mécanique.
 *
 * Un bloc dupliqué n'est pas une faute : le même avertissement répété dans
 * trois skills peut être volontaire. Il devient une décision à prendre, avec
 * la liste des skills concernées sous les yeux.
 */
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { findSkillFiles, parseFrontmatter } from "./catalog.ts";
import { bodyOf } from "./skilllint.ts";
import type { Spec } from "./spec.ts";

/** En dessous, un bloc est trop court pour être un doublon significatif. */
const BLOCK_MIN_CHARS = 160;

export type SkillMeasure = {
  name: string;
  file: string;
  chars: number;
  lines: number;
  sections: number;
  largestSection: { title: string; chars: number } | null;
};

export type DuplicateBlock = {
  chars: number;
  skills: string[];
  excerpt: string;
};

export type AuditReport = {
  checked: number;
  totalChars: number;
  medianChars: number;
  biggest: SkillMeasure[];
  duplicateBlocks: DuplicateBlock[];
};

/** Les sections d'un SKILL.md : titre de niveau 2 et taille du corps. */
function sectionsOf(body: string): { title: string; chars: number }[] {
  const parts = body.split(/^##\s+/m).slice(1);
  return parts.map((part) => {
    const [firstLine, ...rest] = part.split(/\r?\n/);
    return { title: firstLine.trim(), chars: rest.join("\n").trim().length };
  });
}

export function measureSkill(input: { file: string; content: string }): SkillMeasure {
  const name = (parseFrontmatter(input.content).name ?? "").trim() || basename(dirname(input.file));
  const body = bodyOf(input.content);
  const sections = sectionsOf(body);
  const largest = sections.reduce<{ title: string; chars: number } | null>(
    (best, section) => (best === null || section.chars > best.chars ? section : best),
    null,
  );

  return {
    name,
    file: input.file,
    chars: input.content.length,
    lines: input.content.split(/\r?\n/).length,
    sections: sections.length,
    largestSection: largest,
  };
}

/** Les paragraphes assez longs pour être comparés entre skills. */
function blocksOf(content: string): string[] {
  return bodyOf(content)
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length >= BLOCK_MIN_CHARS && !block.startsWith("## "));
}

export function auditSkills(files: readonly { file: string; content: string }[]): AuditReport {
  /*
   * Le même skill est installé dans plusieurs racines (miroir de l'installeur).
   * Sans déduplication, « la plus grosse skill » sort deux fois et le total est
   * gonflé d'un tiers. On ne retire que les copies strictement identiques :
   * deux versions différentes du même nom restent mesurées toutes les deux.
   */
  const vus = new Set<string>();
  const uniques = files.filter((fichier) => {
    if (vus.has(fichier.content)) return false;
    vus.add(fichier.content);
    return true;
  });

  const mesures = uniques.map(measureSkill);
  const tailles = mesures.map((mesure) => mesure.chars).sort((a, b) => a - b);
  const median = tailles.length === 0 ? 0 : tailles[Math.floor(tailles.length / 2)];

  const parBloc = new Map<string, Set<string>>();
  for (const fichier of uniques) {
    const nom = (parseFrontmatter(fichier.content).name ?? "").trim() || basename(dirname(fichier.file));
    for (const bloc of blocksOf(fichier.content)) {
      const vus = parBloc.get(bloc) ?? new Set<string>();
      vus.add(nom);
      parBloc.set(bloc, vus);
    }
  }

  const duplicateBlocks: DuplicateBlock[] = [...parBloc.entries()]
    .filter(([, skills]) => skills.size > 1)
    .map(([texte, skills]) => ({
      chars: texte.length,
      skills: [...skills].sort(),
      excerpt: texte.slice(0, 120),
    }))
    .sort((a, b) => b.skills.length - a.skills.length || b.chars - a.chars)
    .slice(0, 20);

  return {
    checked: mesures.length,
    totalChars: mesures.reduce((somme, mesure) => somme + mesure.chars, 0),
    medianChars: median,
    biggest: [...mesures].sort((a, b) => b.chars - a.chars).slice(0, 15),
    duplicateBlocks,
  };
}

export function auditInstalledSkills(spec: Spec): AuditReport & { scanErrors: string[] } {
  const scanErrors: string[] = [];
  const files: { file: string; content: string }[] = [];

  for (const file of findSkillFiles(spec, scanErrors)) {
    try {
      files.push({ file, content: readFileSync(file, "utf8") });
    } catch {
      // Un fichier illisible est déjà signalé par le lint ; l'audit mesure.
    }
  }

  return { ...auditSkills(files), scanErrors };
}
