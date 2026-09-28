import { fold } from "./classify.ts";

export type CatalogSkill = {
  id: string;
  name: string;
  description: string;
  power: number;
  stars: number | null;
  tags: string[];
  categories: string[];
};

type RankedSkill = {
  id: string;
  score: number;
  power: number;
  matched: string[];
};

function tokens(value: string): string[] {
  return fold(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function skillText(skill: CatalogSkill): string {
  return [skill.id, skill.name, skill.description, skill.tags.join(" "), skill.categories.join(" ")].join(" ");
}

export function rankSkills(skills: CatalogSkill[], query: string, limit = 10): RankedSkill[] {
  const queryTokens = [...new Set(tokens(query))];
  if (queryTokens.length === 0) return [];

  const docs = skills.map((skill) => ({ skill, tokens: new Set(tokens(skillText(skill))) }));
  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const doc of docs) if (doc.tokens.has(token)) count += 1;
    documentFrequency.set(token, count);
  }

  const total = docs.length;
  const ranked: RankedSkill[] = [];
  for (const doc of docs) {
    let score = 0;
    const matched: string[] = [];
    for (const token of queryTokens) {
      if (!doc.tokens.has(token)) continue;
      matched.push(token);
      score += Math.log((total + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
    }

    const idFolded = fold(doc.skill.id);
    const nameTokens = tokens(doc.skill.name);
    const tagTokens = new Set(doc.skill.tags.map((tag) => fold(tag)));
    const categoryTokens = new Set(doc.skill.categories.map((category) => fold(category)));
    for (const token of queryTokens) {
      if (idFolded === token) score += 3;
      if (nameTokens.includes(token)) score += 1.5;
      if (tagTokens.has(token)) score += 1.5;
      if (categoryTokens.has(token)) score += 1.5;
    }
    if (idFolded === fold(query.trim())) score += 5;

    if (score <= 0) continue;
    score += (doc.skill.power ?? 0) / 10;
    ranked.push({ id: doc.skill.id, score: Math.round(score * 1000) / 1000, power: doc.skill.power, matched });
  }

  ranked.sort((a, b) => b.score - a.score || b.power - a.power || (a.id < b.id ? -1 : 1));
  return ranked.slice(0, Math.max(0, limit));
}
