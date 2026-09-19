import type { Category, CategoryKeyword, RoadmapStep, Spec } from "./spec.ts";
import { providersForCategories } from "./providers.ts";
import { determineTier, type ComplexityTier } from "./complexity.ts";

type CategoryScore = {
  id: string;
  score: number;
  confidence: number;
  margin: number;
  terms: string[];
  negatives: string[];
};

type RoadmapView = {
  category: string;
  id: string;
  steps: RoadmapStep[];
};

type SkillInvocation = {
  category: string;
  step: string;
  label: string;
  kind: RoadmapStep["kind"];
  skills: string[];
  optional: boolean;
};

type Classification = {
  categories: CategoryScore[];
  primary: string | null;
  tier: ComplexityTier;
  requiredSkills: string[];
  enforcedSkills: string[];
  invocations: SkillInvocation[];
  providers: string[];
  roadmaps: RoadmapView[];
};

type ClassifyOptions = {
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termMatches(text: string, keyword: string): boolean {
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

function matchedAlternative(text: string, keyword: CategoryKeyword): string | null {
  const raw = keywordTerm(keyword);
  const alternatives = raw.includes("|") ? raw.split("|") : [raw];
  for (const alternative of alternatives) {
    const term = alternative.trim();
    if (term.length > 0 && termMatches(text, term)) return term;
  }
  return null;
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

  // Determine complexity tier
  const tier = determineTier(prompt);

  const scored: CategoryScore[] = [];
  for (const category of spec.categories) {
    let score = 0;
    const terms: string[] = [];
    const negatives: string[] = [];
    for (const keyword of category.keywords) {
      const matched = matchedAlternative(text, keyword);
      if (!matched) continue;
      let weight = keywordWeight(keyword);
      if (matched.includes(" ")) weight += 0.5;
      score += weight;
      terms.push(matched);
    }
    for (const negative of category.negativeKeywords ?? []) {
      const matched = matchedAlternative(text, negative);
      if (!matched) continue;
      score -= keywordWeight(negative);
      negatives.push(matched);
    }
    if (score >= minScore) {
      scored.push({ id: category.id, score, confidence: confidence(score), margin: 0, terms, negatives });
    }
  }

  const priorityOf = (id: string): number =>
    spec.categories.find((category) => category.id === id)?.priority ?? 0;

  scored.sort(
    (a, b) => b.score - a.score || priorityOf(b.id) - priorityOf(a.id) || byCodeUnit(a.id, b.id)
  );

  for (let index = 0; index < scored.length; index += 1) {
    const next = scored[index + 1]?.score ?? 0;
    scored[index].margin = Math.round((scored[index].score - next) * 1000) / 1000;
  }

  const selected = scored.slice(0, Math.max(0, maxCategories));
  // M2: a misconfigured fallbackCategory used to produce a hollow classification
  // (primary set, zero skills). Validate it exists before pushing.
  if (
    selected.length === 0 &&
    fallbackCategory.length > 0 &&
    spec.categories.some((entry) => entry.id === fallbackCategory)
  ) {
    selected.push({ id: fallbackCategory, score: 0, confidence: 0, margin: 0, terms: [], negatives: [] });
  }

  const requiredSkills: string[] = [];
  const invocations: SkillInvocation[] = [];
  const roadmaps: RoadmapView[] = [];
  for (const item of selected) {
    const category = spec.categories.find((entry) => entry.id === item.id);
    if (!category) continue;

    // Tier-based skill filtering
    if (tier === "trivial") {
      // Trivial: no skills required from roadmap
      continue;
    }
    if (tier === "lite") {
      // Lite: only implement + converge (any step kind — edit, verify, skill)
      for (const step of category.roadmap?.steps ?? []) {
        if (step.requireSkills?.some(s => s === "skillenforce-implement" || s === "skillenforce-converge")) {
          for (const skill of step.requireSkills ?? []) {
            if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
          }
        }
      }
    } else {
      // Full: all skills
      for (const skill of skillsOfCategory(category)) {
        if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
      }
    }

    for (const step of category.roadmap?.steps ?? []) {
      if (step.kind !== "skill") continue;
      invocations.push({
        category: category.id,
        step: step.id,
        label: step.label,
        kind: step.kind,
        skills: step.requireSkills ?? [],
        optional: step.optional === true
      });
    }
    if (category.roadmap) {
      roadmaps.push({ category: category.id, id: category.roadmap.id, steps: category.roadmap.steps });
    }
  }

  const primary = selected[0]?.id ?? null;
  const primaryCategory = primary ? spec.categories.find((entry) => entry.id === primary) : undefined;
  const enforcedSkills = primaryCategory ? enforcedOfCategory(primaryCategory) : [];

  const providers = providersForCategories(
    spec,
    selected.map((entry) => entry.id)
  ).map((provider) => provider.id);

  return {
    categories: selected,
    primary,
    tier,
    requiredSkills,
    enforcedSkills,
    invocations,
    providers,
    roadmaps
  };
}
