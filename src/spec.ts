import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Keyword = { term: string; weight?: number };
export type CategoryKeyword = string | Keyword;

export type RoadmapStepKind = "advisory" | "skill" | "edit" | "verify" | "approval";

export type RoadmapStep = {
  id: string;
  label: string;
  kind: RoadmapStepKind;
  requireSkills?: string[];
  optional?: boolean;
};

export type Roadmap = {
  id: string;
  steps: RoadmapStep[];
};

export type Category = {
  id: string;
  label: string;
  priority: number;
  keywords: CategoryKeyword[];
  negativeKeywords?: string[];
  defaultSkills: string[];
  roadmap?: Roadmap;
};

export type RuleWhen = {
  match?: "any" | "all";
  fileClasses?: string[];
  pathGlobs?: string[];
  promptCategories?: string[];
  contentMatches?: string[];
  contentExcludes?: string[];
  minChange?: number;
};

export type Rule = {
  id: string;
  description: string;
  when: RuleWhen;
  require: string[];
};

export type SkillOverride = {
  power?: number;
  stars?: number | null;
  tags?: string[];
  categories?: string[];
};

export type Overrides = {
  skills?: Record<string, SkillOverride>;
};

export type Provider = {
  id: string;
  label: string;
  transport: "local" | "remote";
  command?: string[];
  url?: string;
  purpose?: string;
  categories?: string[];
};

export type ProvidersConfig = {
  autoRegister: boolean;
  disabled: string[];
};

export type GateConfig = {
  enabled: boolean;
  mode: "block" | "warn" | "audit";
  envEscape: string;
  tools: string[];
  ignoreFiles: string[];
};

export type ClassifyConfig = {
  minScore: number;
  maxCategories: number;
  fallbackCategory: string;
};

export type NovahizConfig = {
  dbPath: string;
  skillRoots: string[];
  gate: GateConfig;
  classify: ClassifyConfig;
  providers: ProvidersConfig;
};

export type Spec = {
  root: string;
  config: NovahizConfig;
  categories: Category[];
  rules: Rule[];
  overrides: Overrides;
  providers: Provider[];
};

export const DEFAULT_IGNORE_FILES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/*.min.*",
  "**/*.map",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lockb",
  "**/__snapshots__/**",
  "**/*.snap",
  "**/*.generated.*"
];

export const DEFAULT_CONFIG: NovahizConfig = {
  dbPath: "novahiz.sqlite",
  skillRoots: [],
  gate: {
    enabled: true,
    mode: "block",
    envEscape: "NOVAHIZ_GATE",
    tools: ["edit", "write", "patch", "apply_patch", "bash", "shell"],
    ignoreFiles: DEFAULT_IGNORE_FILES
  },
  classify: {
    minScore: 1,
    maxCategories: 3,
    fallbackCategory: "general"
  },
  providers: {
    autoRegister: true,
    disabled: []
  }
};

export function novahizHome(): string {
  const fromEnv = process.env.NOVAHIZ_HOME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".config", "novahiz");
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function readJson<T>(path: string): T {
  return JSON.parse(stripBom(readFileSync(path, "utf8"))) as T;
}

export function mergeConfig(raw: Partial<NovahizConfig> | null | undefined): NovahizConfig {
  const source = raw && typeof raw === "object" ? raw : {};
  const gateSource = source.gate && typeof source.gate === "object" ? source.gate : {};
  const gate: GateConfig = { ...DEFAULT_CONFIG.gate, ...gateSource };
  if (typeof gate.enabled !== "boolean") gate.enabled = DEFAULT_CONFIG.gate.enabled;
  if (gate.mode !== "block" && gate.mode !== "warn" && gate.mode !== "audit") gate.mode = DEFAULT_CONFIG.gate.mode;
  if (typeof gate.envEscape !== "string") gate.envEscape = DEFAULT_CONFIG.gate.envEscape;
  if (!Array.isArray(gate.tools)) gate.tools = DEFAULT_CONFIG.gate.tools;
  if (!Array.isArray(gate.ignoreFiles)) gate.ignoreFiles = DEFAULT_CONFIG.gate.ignoreFiles;

  const classifySource = source.classify && typeof source.classify === "object" ? source.classify : {};
  const classify: ClassifyConfig = { ...DEFAULT_CONFIG.classify, ...classifySource };
  if (typeof classify.minScore !== "number" || !Number.isFinite(classify.minScore)) {
    classify.minScore = DEFAULT_CONFIG.classify.minScore;
  }
  if (typeof classify.maxCategories !== "number" || !Number.isFinite(classify.maxCategories)) {
    classify.maxCategories = DEFAULT_CONFIG.classify.maxCategories;
  }
  if (typeof classify.fallbackCategory !== "string") {
    classify.fallbackCategory = DEFAULT_CONFIG.classify.fallbackCategory;
  }

  const providersSource = source.providers && typeof source.providers === "object" ? source.providers : {};
  const providers: ProvidersConfig = {
    autoRegister: typeof providersSource.autoRegister === "boolean" ? providersSource.autoRegister : DEFAULT_CONFIG.providers.autoRegister,
    disabled: Array.isArray(providersSource.disabled) ? providersSource.disabled : [...DEFAULT_CONFIG.providers.disabled]
  };

  return {
    dbPath: typeof source.dbPath === "string" ? source.dbPath : DEFAULT_CONFIG.dbPath,
    skillRoots: Array.isArray(source.skillRoots) ? source.skillRoots : [...DEFAULT_CONFIG.skillRoots],
    gate,
    classify,
    providers
  };
}

export function loadConfig(root: string = novahizHome()): NovahizConfig {
  const userPath = join(root, "novahiz.config.json");
  if (existsSync(userPath)) {
    try {
      return mergeConfig(JSON.parse(stripBom(readFileSync(userPath, "utf8"))) as Partial<NovahizConfig>);
    } catch (error) {
      throw new Error(`Invalid JSON in ${userPath}: ${(error as Error).message}`);
    }
  }
  const examplePath = join(root, "novahiz.config.example.json");
  if (existsSync(examplePath)) return mergeConfig(readJson<Partial<NovahizConfig>>(examplePath));
  return mergeConfig(null);
}

function readCatalog<T>(path: string): T {
  try {
    return JSON.parse(stripBom(readFileSync(path, "utf8"))) as T;
  } catch (error) {
    throw new Error(`Invalid or missing catalog file ${path}: ${(error as Error).message}`);
  }
}

export function loadSpec(root: string = novahizHome()): Spec {
  const categories = readCatalog<Category[]>(join(root, "catalog", "categories.json"));
  const rules = readCatalog<Rule[]>(join(root, "catalog", "rules.json"));
  const overrides = readCatalog<Overrides>(join(root, "catalog", "overrides.json"));
  let providers: Provider[] = [];
  try {
    const loaded = readCatalog<Provider[]>(join(root, "catalog", "providers.json"));
    if (Array.isArray(loaded)) providers = loaded;
  } catch {
    providers = [];
  }
  if (!Array.isArray(categories)) throw new Error("catalog/categories.json must be an array");
  if (!Array.isArray(rules)) throw new Error("catalog/rules.json must be an array");
  if (!overrides || typeof overrides !== "object") throw new Error("catalog/overrides.json must be an object");
  return { root, config: loadConfig(root), categories, rules, overrides, providers };
}
