import type { Category, CategoryKeyword, RoadmapStep, Spec } from "./spec.ts";
import { providersForCategories } from "./providers.ts";
import { determineTier, liteKeeps, type ComplexityTier } from "./complexity.ts";

type CategoryScore = {
  id: string;
  score: number;
  confidence: number;
  margin: number;
  terms: string[];
  negatives: string[];
  /** Path rules that contributed to the score, e.g. "style file (globals.css)". */
  pathSignals: string[];
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
  enforced: boolean;
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
  /**
   * Files the task touches. A prompt alone under-classifies: "ajoute le
   * skeleton de chargement" carries no design vocabulary, but the files it
   * edits are `.tsx` and `.css`. Path signals make the classification
   * deterministic on what the work actually touches, not only on how it is
   * phrased.
   */
  files?: string[];
};

/**
 * Path → category signals. Ids are guarded against the catalog: a signal for a
 * category the project does not define is ignored, never invented.
 */
const PATH_SIGNALS: { pattern: RegExp; category: string; weight: number; label: string }[] = [
  { pattern: /\.(css|scss|sass|less|styl)$/i, category: "design-ui", weight: 3, label: "style file" },
  { pattern: /\.(tsx|jsx|vue|svelte)$/i, category: "design-ui", weight: 1.5, label: "component file" },
  {
    pattern: /(^|\/)(globals\.css|tailwind\.config\.[cm]?[jt]s|theme\/)/i,
    category: "design-ui",
    weight: 2,
    label: "design tokens",
  },
  {
    pattern: /(^|\/)(supabase|migrations)\/|\.sql$/i,
    category: "database-supabase",
    weight: 4,
    label: "database path",
  },
  {
    pattern: /(^|\/)messages\/|\.(md|mdx)$|(^|\/)docs\//i,
    category: "docs-writing",
    weight: 2,
    label: "documentation path",
  },
  {
    pattern: /(^|\/)(Dockerfile|docker-compose\.ya?ml)$|(^|\/)\.github\/workflows\/|(^|\/)terraform\/|\.(ya?ml)$/i,
    category: "devops",
    weight: 3,
    label: "infrastructure path",
  },
  {
    pattern: /\.(test|spec)\.(ts|tsx|js|jsx|py|dart)$|(^|\/)(__tests__|tests?)\//i,
    category: "test",
    weight: 3,
    label: "test path",
  },
  {
    pattern: /(^|\/)lib\/data\/|\.(json|csv|parquet)$/i,
    category: "data",
    weight: 2,
    label: "data path",
  },
];

function pathSignalsFor(files: string[] | undefined, categoryId: string): string[] {
  if (!files?.length) return [];
  const signals: string[] = [];
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    for (const rule of PATH_SIGNALS) {
      if (rule.category !== categoryId) continue;
      if (!rule.pattern.test(normalized)) continue;
      const label = `${rule.label} (${normalized})`;
      if (!signals.includes(label)) signals.push(label);
    }
  }
  return signals;
}

function pathWeightFor(files: string[] | undefined, categoryId: string): number {
  if (!files?.length) return 0;
  let weight = 0;
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    let best = 0;
    for (const rule of PATH_SIGNALS) {
      if (rule.category !== categoryId) continue;
      if (rule.pattern.test(normalized) && rule.weight > best) best = rule.weight;
    }
    weight += best;
  }
  return Math.round(weight * 1000) / 1000;
}

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

// Confidence maps a raw keyword score to [0, 1) using a half-saturation curve.
// At score=2 the confidence is ~0.5; at score=5 it's ~0.71; at score=10 it's ~0.83.
// The "+2" constant prevents low-score categories from having disproportionate confidence.
function confidence(score: number): number {
  if (score <= 0) return 0;
  return Math.round((score / (score + 2)) * 100) / 100;
}

export function skillsOfCategory(category: Category): string[] {
  const skills: string[] = [...category.defaultSkills];
  for (const step of category.roadmap?.steps ?? []) {
    for (const skill of step.requireSkills ?? []) {
      if (!skills.includes(skill)) skills.push(skill);
    }
  }
  return skills;
}

export function enforcedOfCategory(category: Category): string[] {
  const skills: string[] = [];
  for (const step of category.roadmap?.steps ?? []) {
    // Every non-optional step counts, whatever its kind: `edit:implement` and
    // `verify:converge` carry skills too. Restricting to kind "skill" made
    // lite/debug roadmaps advertise nothing while the gate demanded R6's
    // implement/converge — the block and the gate disagreed.
    if (step.optional) continue;
    for (const skill of step.requireSkills ?? []) {
      if (!skills.includes(skill)) skills.push(skill);
    }
  }
  return skills;
}

/**
 * Is this roadmap step enforced by the gate, or is it a checklist line?
 *
 * The rule is the gate's, not a new one: a step blocks only when it is not
 * optional AND carries `requireSkills`. Exposing it on every step is what makes
 * "critique / polish / a11y" visible as advisory before an agent plans around
 * them — and what makes the ledger's close rule legible.
 */
export function stepEnforcement(step: RoadmapStep): {
  enforced: boolean;
  advisory: boolean;
  why: string;
} {
  const skills = step.requireSkills ?? [];
  if (step.optional === true) return { enforced: false, advisory: true, why: "optional step" };
  if (skills.length === 0) return { enforced: false, advisory: true, why: "no required skill" };
  return { enforced: true, advisory: false, why: `${skills.length} required skill(s)` };
}

export type AnnotatedStep = RoadmapStep & { enforced: boolean; advisory: boolean; why: string };

type RoadmapLike = { id: string; steps: RoadmapStep[] } & Record<string, unknown>;
type AnnotatedRoadmap = { id: string; steps: AnnotatedStep[] } & Record<string, unknown>;

export function annotateRoadmap(roadmap: RoadmapLike | null | undefined): AnnotatedRoadmap | null {
  if (!roadmap) return null;
  return { ...roadmap, steps: roadmap.steps.map((step) => ({ ...step, ...stepEnforcement(step) })) };
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
    const pathSignals = pathSignalsFor(options.files, category.id);
    score += pathWeightFor(options.files, category.id);
    if (score >= minScore) {
      scored.push({ id: category.id, score, confidence: confidence(score), margin: 0, terms, negatives, pathSignals });
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
  // H8: when nothing matched and fallback is misconfigured, force "general" so
  // the gate still applies R6 rules instead of silently allowing everything.
  if (selected.length === 0) {
    if (fallbackCategory.length > 0 && spec.categories.some((entry) => entry.id === fallbackCategory)) {
      selected.push({ id: fallbackCategory, score: 0, confidence: 0, margin: 0, terms: [], negatives: [], pathSignals: [] });
    } else if (spec.categories.some((entry) => entry.id === "general")) {
      selected.push({ id: "general", score: 0, confidence: 0, margin: 0, terms: [], negatives: [], pathSignals: [] });
    }
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
      // Lite keeps every domain skill and drops only the process skills (plan,
      // clarify, task, analyse). The old filter kept implement/converge only,
      // which erased wireframe and design craft from a lite design change while
      // the gate was expected to enforce them.
      for (const step of category.roadmap?.steps ?? []) {
        if (step.optional) continue;
        const allowed = (step.requireSkills ?? []).filter(liteKeeps);
        for (const skill of allowed) {
          if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
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
        optional: step.optional === true,
        enforced: stepEnforcement(step).enforced
      });
    }
    if (category.roadmap) {
      roadmaps.push({
        category: category.id,
        id: category.roadmap.id,
        steps: annotateRoadmap(category.roadmap)!.steps
      });
    }
  }

  const primary = selected[0]?.id ?? null;
  const primaryCategory = primary ? spec.categories.find((entry) => entry.id === primary) : undefined;
  // C1: enforcedSkills must respect tier gating — trivial prompts should not
  // expose enforced skills, otherwise downstream consumers load skills unnecessarily.
  // Audit 2026-09-25 (finding 10): lite must mirror the gate's lite filter too,
  // or the enforcement block advertises skills the gate never blocks on.
  const enforcedSkills =
    tier !== "trivial" && primaryCategory
      ? tier === "lite"
        ? enforcedOfCategory(primaryCategory).filter(liteKeeps)
        : enforcedOfCategory(primaryCategory)
      : [];

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
