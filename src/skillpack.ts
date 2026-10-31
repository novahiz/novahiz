/**
 * Category digests.
 *
 * A category can require a dozen skills, and loading all of them costs 30–40k
 * tokens before a single line of code is read — most of it prose and rationale.
 * This module builds a compact *map* of a category: one line of purpose plus the
 * headings and bullet rules of each skill, capped. It does not replace `skill()`:
 * the gate still demands the real load. It answers "what is in this pack, and
 * which part do I actually need?" before paying for it.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { enforcedOfCategory, skillsOfCategory } from "./classify.ts";
import type { Spec } from "./spec.ts";

export type SkillDigest = {
  id: string;
  description: string;
  outline: string[];
  chars: number;
  found: boolean;
};

export type Skillpack = {
  category: string | null;
  skills: SkillDigest[];
  totalChars: number;
  /** Skills left out because the character budget was reached. */
  skipped: string[];
  notes: string[];
};

const MAX_OUTLINE_LINES = 18;
const DEFAULT_MAX_CHARS = 12_000;

function skillFile(spec: Spec, id: string): string | null {
  for (const root of spec.config.skillRoots) {
    const expanded = root.startsWith("~") ? join(homedir(), root.slice(2)) : root;
    const absRoot = isAbsolute(expanded) ? expanded : join(spec.root, expanded);
    const candidate = join(absRoot, id, "SKILL.md");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function digestOne(id: string, file: string | null): SkillDigest {
  if (!file) {
    return { id, description: "SKILL.md introuvable (index et disque divergent : lancer novahiz sync)", outline: [], chars: 0, found: false };
  }
  const raw = readFileSync(file, "utf8");
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const description = (body.match(/^#\s+(.+)$/m)?.[1] ?? "").trim();
  const outline: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/^#{2,4}\s+/.test(trimmed)) {
      outline.push(`• ${trimmed.replace(/^#+\s*/, "")}`);
    } else if (/^[-*]\s+/.test(trimmed)) {
      outline.push(`- ${trimmed.replace(/^[-*]\s+/, "").slice(0, 140)}`);
    }
    if (outline.length >= MAX_OUTLINE_LINES) break;
  }
  const text = [description, ...outline].join("\n");
  return { id, description, outline, chars: text.length, found: true };
}

export function buildSkillpack(
  spec: Spec,
  options: { category?: string; skills?: string[]; maxChars?: number },
): Skillpack {
  const category = options.category
    ? spec.categories.find((entry) => entry.id === options.category)
    : undefined;
  const notes: string[] = [];
  if (options.category && !category) {
    notes.push(`catégorie inconnue: ${options.category}`);
  }

  let ids = [...(options.skills ?? [])].filter((id) => id.trim().length > 0);
  if (ids.length === 0 && category) {
    ids = skillsOfCategory(category);
  }
  ids = [...new Set(ids)];
  // Enforced skills first: under a character budget, the map must describe what
  // the gate will actually demand before it describes the optional extras.
  if (category) {
    const enforced = new Set(enforcedOfCategory(category));
    ids.sort((a, b) => Number(!enforced.has(a)) - Number(!enforced.has(b)));
  }
  if (ids.length === 0) {
    notes.push("aucune skill à décrire : passer category ou skills");
  }

  const maxChars = Math.max(Number(options.maxChars) || DEFAULT_MAX_CHARS, 500);
  const skills: SkillDigest[] = [];
  const skipped: string[] = [];
  let totalChars = 0;
  for (const id of ids) {
    const digest = digestOne(id, skillFile(spec, id));
    if (totalChars + digest.chars > maxChars) {
      skipped.push(id);
      continue;
    }
    skills.push(digest);
    totalChars += digest.chars;
  }
  if (skipped.length > 0) {
    notes.push(`${skipped.length} skill(s) omise(s) par budget : ${skipped.join(", ")}`);
  }
  return { category: category?.id ?? null, skills, totalChars, skipped, notes };
}
