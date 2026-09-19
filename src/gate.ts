import type { Rule, Spec } from "./spec.ts";
import { hasPlaceholder, hasProse, hasStyle, isTrivial } from "./content.ts";
import { determineTier, type ComplexityTier } from "./complexity.ts";

type FileClass = "code" | "text" | "design" | "data" | "config" | "other";

const CLASS_BY_EXTENSION: Record<string, FileClass> = {
  css: "design",
  scss: "design",
  sass: "design",
  less: "design",
  styl: "design",
  html: "design",
  htm: "design",
  vue: "design",
  svelte: "design",
  astro: "design",
  jsx: "design",
  tsx: "design",
  md: "text",
  mdx: "text",
  markdown: "text",
  txt: "text",
  rst: "text",
  adoc: "text",
  json: "data",
  jsonc: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  csv: "data",
  tsv: "data",
  xml: "data",
  env: "config",
  ini: "config",
  cfg: "config",
  conf: "config",
  gitignore: "config",
  gitattributes: "config",
  js: "code",
  mjs: "code",
  cjs: "code",
  ts: "code",
  mts: "code",
  cts: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  kts: "code",
  swift: "code",
  c: "code",
  cc: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  cs: "code",
  php: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  ps1: "code",
  sql: "code",
  lua: "code",
  dart: "code",
  ex: "code",
  exs: "code",
  erl: "code",
  clj: "code",
  scala: "code"
};

export function fileClass(filePath: string): FileClass {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (base.length === 0) return "other";

// M8: dotted dotfiles (.env.local, .eslintrc.json, .babelrc.js) carry a config
// basename before their extension — classify by basename first.
const CONFIG_BASENAMES = new Set([
  "env",
  "eslintrc",
  "babelrc",
  "prettierrc",
  "stylelintrc",
  "editorconfig",
  "dockerignore",
  "npmrc",
  "yarnrc",
  "nvmrc",
  "terraformrc",
  "gitignore",
  "gitattributes"
]);

  if (base.startsWith(".")) {
    const rest = base.replace(/^\.+/, "").toLowerCase();
    if (rest.length === 0) return "other";
    const direct = CLASS_BY_EXTENSION[rest];
    if (direct) return direct;
    const firstDot = rest.indexOf(".");
    if (firstDot > 0 && CONFIG_BASENAMES.has(rest.slice(0, firstDot))) return "config";
    const lastDot = rest.lastIndexOf(".");
    if (lastDot !== -1) {
      const ext = rest.slice(lastDot + 1);
      return CLASS_BY_EXTENSION[ext] ?? "config";
    }
    return "config";
  }

  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "other";
  const ext = base.slice(dot + 1).toLowerCase();
  return CLASS_BY_EXTENSION[ext] ?? "other";
}

export function globToRegExp(glob: string): RegExp {
  const source = glob.replace(/\\/g, "/");
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "*") {
      if (source[index + 1] === "*") {
        index += 1;
        if (source[index + 1] === "/") {
          index += 1;
          output += "(?:.+/)?";
        } else if (source[index + 1] === undefined) {
          output += ".*";
        } else {
          output += "(?:[^/]+/)*[^/]*";
        }
      } else {
        output += "[^/]*";
      }
    } else if (char === "?") {
      output += "[^/]";
    } else if (".+^${}()|[]\\".includes(char)) {
      output += `\\${char}`;
    } else {
      output += char;
    }
  }
  return new RegExp(`^${output}$`, "i");
}

// C3: nested quantifiers — (a+)+, (x*)*, (a+)? — are the classic ReDoS shape.
// try/catch stops syntax errors but cannot stop catastrophic backtracking,
// so reject the shape before compiling.
const UNSAFE_NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)[+*?]/;

export function isSafeRegexPattern(pattern: string): boolean {
  return !UNSAFE_NESTED_QUANTIFIER.test(pattern);
}

export function contentSatisfies(content: string, patterns: string[]): boolean {
  if (content.length === 0) return false;
  return patterns.some((pattern) => {
    if (pattern === "prose") return hasProse(content);
    if (pattern === "style") return hasStyle(content);
    if (pattern.length > 1000) return false;
    if (!isSafeRegexPattern(pattern)) return false;
    try {
      return new RegExp(pattern, "i").test(content);
    } catch {
      return false;
    }
  });
}

function selectorMatches(rule: Rule, classification: FileClass, path: string, categories: string[]): boolean {
  const when = rule.when;
  const checks: boolean[] = [];
  if (when.fileClasses && when.fileClasses.length > 0) checks.push(when.fileClasses.includes(classification));
  if (when.pathGlobs && when.pathGlobs.length > 0) checks.push(when.pathGlobs.some((glob) => globToRegExp(glob).test(path)));
  if (when.promptCategories && when.promptCategories.length > 0) {
    checks.push(when.promptCategories.some((category) => categories.includes(category)));
  }
  // M1: a rule with no selectors must match nothing, not everything.
  // An empty `when` is a misconfiguration — fail closed, not open.
  if (checks.length === 0) return false;
  return when.match === "all" ? checks.every(Boolean) : checks.some(Boolean);
}

type GateInput = {
  tool: string;
  filePath: string;
  content?: string;
  categories?: string[];
  loadedSkills?: string[];
  installedSkills?: ReadonlySet<string> | null;
  installedIndexAvailable?: boolean;
  tier?: ComplexityTier;
  spec: Spec;
};

type GateResult = {
  allow: boolean;
  ignored: boolean;
  fileClass: FileClass;
  roadmap: string | null;
  tier: ComplexityTier;
  requiredSkills: string[];
  missingSkills: string[];
  unmatchedRequired: string[];
  matchedRules: string[];
  indexMissing: boolean;
  placeholder: boolean;
  reasons: string[];
};

export function evaluateGate(input: GateInput): GateResult {
  const classification = fileClass(input.filePath);
  const categories = input.categories ?? [];
  const path = input.filePath.replace(/\\/g, "/");
  const content = input.content ?? "";

  try {
    const ignored = input.spec.config.gate.ignoreFiles.some((glob) => globToRegExp(glob).test(path));
    if (ignored) {
      return {
        allow: true,
        ignored: true,
        fileClass: classification,
        roadmap: null,
        tier: "trivial",
        requiredSkills: [],
        missingSkills: [],
        unmatchedRequired: [],
        matchedRules: [],
        indexMissing: false,
        placeholder: false,
        reasons: []
      };
    }

    const requiredSkills: string[] = [];
    const matchedRules: string[] = [];

    for (const rule of input.spec.rules) {
      if (!selectorMatches(rule, classification, path, categories)) continue;
      if (rule.when.minChange && isTrivial(content, rule.when.minChange)) continue;
      if (rule.when.contentExcludes && contentSatisfies(content, rule.when.contentExcludes)) continue;
      if (rule.when.contentMatches && !contentSatisfies(content, rule.when.contentMatches)) continue;
      matchedRules.push(rule.id);
      for (const skill of rule.require) {
        if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
      }
    }

    const primary = categories[0];
    let roadmap: string | null = null;

    // Determine complexity tier for this prompt
    const tier = input.tier ?? determineTier(content);

    if (primary) {
      const category = input.spec.categories.find((entry) => entry.id === primary);
      if (category?.roadmap) {
        roadmap = category.roadmap.id;
        for (const step of category.roadmap.steps) {
          if (step.kind !== "skill" || step.optional) continue;

          // Tier-based filtering
          if (tier === "trivial") {
            // Trivial: no skills from roadmap
            continue;
          }
          if (tier === "lite") {
            // Lite: only implement + converge (any step kind — edit, verify, skill)
            const isImplementOrConverge = (step.requireSkills ?? []).some(
              s => s.includes("implement") || s.includes("converge")
            );
            if (!isImplementOrConverge) continue;
          }

          for (const skill of step.requireSkills ?? []) {
            if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
          }
        }
      }
    }

    const installed = input.installedSkills ?? null;
    const indexAvailable = input.installedIndexAvailable !== false;
    const effective: string[] = [];
    const unmatchedRequired: string[] = [];
    for (const skill of requiredSkills) {
      if (indexAvailable && installed && !installed.has(skill)) unmatchedRequired.push(skill);
      else effective.push(skill);
    }

    const loaded = new Set(input.loadedSkills ?? []);
    const missingSkills = effective.filter((skill) => !loaded.has(skill));

    const placeholderEligible = input.spec.config.gate.placeholders && (classification === "code" || classification === "design");
    const placeholder = placeholderEligible && hasPlaceholder(content);

    const reasons: string[] = [];
    for (const skill of missingSkills) reasons.push(`missing skill: ${skill}`);
    if (placeholder) reasons.push("placeholder marker found in content");

    return {
      allow: missingSkills.length === 0 && !placeholder,
      ignored: false,
      fileClass: classification,
      roadmap,
      tier,
      requiredSkills: effective,
      missingSkills,
      unmatchedRequired,
      matchedRules,
      indexMissing: input.installedIndexAvailable === false,
      placeholder,
      reasons
    };
  } catch (error) {
    return {
      allow: false,
      ignored: false,
      fileClass: classification,
      roadmap: null,
      tier: "trivial",
      requiredSkills: [],
      missingSkills: [],
      unmatchedRequired: [],
      matchedRules: [],
      indexMissing: false,
      placeholder: false,
      reasons: [`gate error: ${String((error as Error)?.message ?? error)}`]
    };
  }
}
