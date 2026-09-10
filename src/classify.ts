import type { Spec } from "./spec.ts";

export type CategoryScore = {
  id: string;
  score: number;
  terms: string[];
};

export type Classification = {
  categories: CategoryScore[];
  requiredSkills: string[];
};

export type ClassifyOptions = {
  minScore?: number;
  maxCategories?: number;
  fallbackCategory?: string;
};

export function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termMatches(text: string, keyword: string): boolean {
  const needle = fold(keyword).trim();
  if (needle.length === 0) return false;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(needle)}([^\\p{L}\\p{N}]|$)`, "u");
  return pattern.test(text);
}

export function classify(spec: Spec, prompt: string, options: ClassifyOptions = {}): Classification {
  const minScore = options.minScore ?? spec.config.classify.minScore;
  const maxCategories = options.maxCategories ?? spec.config.classify.maxCategories;
  const fallbackCategory = options.fallbackCategory ?? spec.config.classify.fallbackCategory;
  const text = fold(prompt);

  const scored: CategoryScore[] = [];
  for (const category of spec.categories) {
    let score = 0;
    const terms: string[] = [];
    for (const keyword of category.keywords) {
      if (termMatches(text, keyword)) {
        score += 1;
        terms.push(keyword);
      }
    }
    if (score >= minScore) scored.push({ id: category.id, score, terms });
  }

  const priorityOf = (id: string): number =>
    spec.categories.find((category) => category.id === id)?.priority ?? 0;

  scored.sort(
    (a, b) => b.score - a.score || priorityOf(b.id) - priorityOf(a.id) || a.id.localeCompare(b.id)
  );

  const selected = scored.slice(0, Math.max(0, maxCategories));
  if (selected.length === 0 && fallbackCategory.length > 0) {
    selected.push({ id: fallbackCategory, score: 0, terms: [] });
  }

  const requiredSkills: string[] = [];
  for (const item of selected) {
    const category = spec.categories.find((entry) => entry.id === item.id);
    if (!category) continue;
    for (const skill of category.defaultSkills) {
      if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
    }
  }

  return { categories: selected, requiredSkills };
}
