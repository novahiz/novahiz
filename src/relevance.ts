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

export type SlotDoc = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  text: string;
};

export type RankedSlot = {
  id: string;
  score: number;
  matched: string[];
};

/**
 * S2: meme moteur que rankSkills (fold + IDF sur le corpus), adapte aux slots
 * memoire. `score` est normalise sur [0,1]: (idf brut + boosts titre/desc/tags)
 * divises par le maximum theorique — tous les tokens du query rares (df=0) et
 * tous les boosts actifs. Un match complet sur des termes courants plafonne en
 * "medium", un match sur des termes rares atteint "high".
 */
export function rankSlots(docs: SlotDoc[], query: string, limit = 5): RankedSlot[] {
  const queryTokens = [...new Set(tokens(query))];
  if (queryTokens.length === 0 || docs.length === 0) return [];

  const entries = docs.map((doc) => ({
    id: doc.id,
    set: new Set(tokens([doc.title, doc.description, doc.tags.join(" "), doc.text].join(" "))),
    title: new Set(tokens(doc.title)),
    description: new Set(tokens(doc.description)),
    tags: new Set(doc.tags.map((tag) => fold(tag)))
  }));

  const total = docs.length;
  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const entry of entries) if (entry.set.has(token)) count += 1;
    documentFrequency.set(token, count);
  }

  const maxIdf = Math.log(total + 1) + 1;
  const maxBoostPerToken = 1.5 + 0.75 + 0.75;
  const maxRaw = queryTokens.length * (maxIdf + maxBoostPerToken);

  const ranked: RankedSlot[] = [];
  for (const entry of entries) {
    const matched = queryTokens.filter((token) => entry.set.has(token));
    if (matched.length === 0) continue;
    let raw = 0;
    for (const token of matched) {
      raw += Math.log((total + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
      if (entry.title.has(token)) raw += 1.5;
      if (entry.description.has(token)) raw += 0.75;
      if (entry.tags.has(token)) raw += 0.75;
    }
    const score = Math.min(1, Math.round((raw / maxRaw) * 1000) / 1000);
    ranked.push({ id: entry.id, score, matched });
  }
  ranked.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return ranked.slice(0, Math.max(0, limit));
}
