import type { Category, CategoryKeyword, RoadmapStep, Spec } from "./spec.ts";

export type CategoryScore = {
  id: string;
  score: number;
  confidence: number;
  terms: string[];
};

export type RoadmapView = {
  category: string;
  id: string;
  steps: RoadmapStep[];
};

export type Classification = {
  categories: CategoryScore[];
  primary: string | null;
  requiredSkills: string[];
  enforcedSkills: string[];
  roadmaps: RoadmapView[];
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

function keywordTerm(keyword: CategoryKeyword): string {
  return typeof keyword === "string" ? keyword : keyword.term;
}

function keywordWeight(keyword: CategoryKeyword): number {
  if (typeof keyword === "string") return 1;
  return typeof keyword.weight === "number" ? keyword.weight : 1;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function confidence(score: number): number {
  if (score <= 0) return 0;
  return Math.round((score / (score + 2)) * 100) / 100;
}

function skillsOfCategory(category: Category): string[] {
  const skills: string[] = [...category.defaultSkills];
  for (const step of category.roadmap?.steps ?? []) {
    for (const skill of step.requireSkills ?? []) {
      if (!skills.includes(skill)) skills.push(skill);
    }
  }
  return skills;
}

function enforcedOfCategory(category: Category): string[] {
  const skills: string[] = [];
  for (const step of category.roadmap?.steps ?? []) {
    if (step.kind !== "skill" || step.optional) continue;
    for (const skill of step.requireSkills ?? []) {
      if (!skills.includes(skill)) skills.push(skill);
    }
  }
  return skills;
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
      if (!termMatches(text, keywordTerm(keyword))) continue;
      let weight = keywordWeight(keyword);
      if (keywordTerm(keyword).includes(" ")) weight += 0.5;
      score += weight;
      terms.push(keywordTerm(keyword));
    }
    for (const negative of category.negativeKeywords ?? []) {
      if (termMatches(text, negative)) score -= 1;
    }
    if (score >= minScore) scored.push({ id: category.id, score, confidence: confidence(score), terms });
  }

  const priorityOf = (id: string): number =>
    spec.categories.find((category) => category.id === id)?.priority ?? 0;

  scored.sort(
    (a, b) => b.score - a.score || priorityOf(b.id) - priorityOf(a.id) || byCodeUnit(a.id, b.id)
  );

  const selected = scored.slice(0, Math.max(0, maxCategories));
  if (selected.length === 0 && fallbackCategory.length > 0) {
    selected.push({ id: fallbackCategory, score: 0, confidence: 0, terms: [] });
  }

  const requiredSkills: string[] = [];
  const roadmaps: RoadmapView[] = [];
  for (const item of selected) {
    const category = spec.categories.find((entry) => entry.id === item.id);
    if (!category) continue;
    for (const skill of skillsOfCategory(category)) {
      if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
    }
    if (category.roadmap) {
      roadmaps.push({ category: category.id, id: category.roadmap.id, steps: category.roadmap.steps });
    }
  }

  const primary = selected[0]?.id ?? null;
  const primaryCategory = primary ? spec.categories.find((entry) => entry.id === primary) : undefined;
  const enforcedSkills = primaryCategory ? enforcedOfCategory(primaryCategory) : [];

  return { categories: selected, primary, requiredSkills, enforcedSkills, roadmaps };
}
