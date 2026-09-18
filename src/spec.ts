import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Keyword = { term: string; weight?: number };
export type CategoryKeyword = string | Keyword;

type RoadmapStepKind = "advisory" | "skill" | "edit" | "verify" | "approval";

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
  negativeKeywords?: CategoryKeyword[];
  defaultSkills: string[];
  roadmap?: Roadmap;
};

type RuleWhen = {
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

type SkillOverride = {
  power?: number;
  stars?: number | null;
  tags?: string[];
  categories?: string[];
};

type Overrides = {
  skills?: Record<string, SkillOverride>;
};

type ProviderKind = "mcp" | "skill" | "commands";

export type Provider = {
  id: string;
  label: string;
  kind: ProviderKind;
  transport?: "local" | "remote";
  command?: string[];
  url?: string;
  install?: string[];
  requires?: string[];
  bootstrap?: Record<string, string[]>;
  purpose?: string;
  categories?: string[];
  source?: string;
  license?: string;
};

type ProvidersConfig = {
  autoRegister: boolean;
  autoInstall: boolean;
  disabled: string[];
};

type TraceConfig = {
  enabled: boolean;
  categories: string[];
};

export type GateConfig = {
  enabled: boolean;
  mode: "block" | "warn" | "audit";
  envEscape: string;
  tools: string[];
  ignoreFiles: string[];
  placeholders: boolean;
  trace: TraceConfig;
};

type ClassifyConfig = {
  minScore: number;
  maxCategories: number;
  fallbackCategory: string;
};

type LedgerReviewConfig = {
  edits: number;
  todos: number;
};

type LedgerConfig = {
  enabled: boolean;
  review: LedgerReviewConfig;
};

export type NovahizConfig = {
  dbPath: string;
  skillRoots: string[];
  gate: GateConfig;
  classify: ClassifyConfig;
  providers: ProvidersConfig;
  ledger: LedgerConfig;
};

export type Spec = {
  root: string;
  config: NovahizConfig;
  categories: Category[];
  rules: Rule[];
  overrides: Overrides;
  providers: Provider[];
};

const DEFAULT_IGNORE_FILES = [
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
  dbPath: "skillenforce.sqlite",
  skillRoots: [],
  gate: {
    enabled: true,
    mode: "block",
    envEscape: "NOVAHIZ_GATE",
    tools: ["edit", "write", "patch", "apply_patch", "bash", "shell"],
    ignoreFiles: DEFAULT_IGNORE_FILES,
    placeholders: true,
    trace: {
      enabled: false,
      categories: ["code", "debug", "audit", "review", "database-supabase"]
    }
  },
  classify: {
    minScore: 1,
    maxCategories: 3,
    fallbackCategory: "general"
  },
  providers: {
    autoRegister: true,
    autoInstall: false,
    disabled: []
  },
  ledger: {
    enabled: true,
    review: {
      edits: 3,
      todos: 2
    }
  }
};

export function skillenforceHome(): string {
  const fromEnv = process.env.SKILLEFORCE_HOME;
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
  const gateSource: Partial<GateConfig> = source.gate && typeof source.gate === "object" ? source.gate : {};
  const gate: GateConfig = { ...DEFAULT_CONFIG.gate, ...gateSource };
  if (typeof gate.enabled !== "boolean") gate.enabled = DEFAULT_CONFIG.gate.enabled;
  if (gate.mode !== "block" && gate.mode !== "warn" && gate.mode !== "audit") gate.mode = DEFAULT_CONFIG.gate.mode;
  if (typeof gate.envEscape !== "string") gate.envEscape = DEFAULT_CONFIG.gate.envEscape;
  if (!Array.isArray(gate.tools)) gate.tools = DEFAULT_CONFIG.gate.tools;
  if (!Array.isArray(gate.ignoreFiles)) gate.ignoreFiles = DEFAULT_CONFIG.gate.ignoreFiles;
  if (typeof gate.placeholders !== "boolean") gate.placeholders = DEFAULT_CONFIG.gate.placeholders;

  const traceSource: Partial<TraceConfig> = gateSource.trace && typeof gateSource.trace === "object" ? gateSource.trace : {};
  const trace: TraceConfig = { ...DEFAULT_CONFIG.gate.trace, ...traceSource };
  if (typeof trace.enabled !== "boolean") trace.enabled = DEFAULT_CONFIG.gate.trace.enabled;
  if (!Array.isArray(trace.categories)) trace.categories = [...DEFAULT_CONFIG.gate.trace.categories];
  gate.trace = trace;

  const classifySource: Partial<ClassifyConfig> = source.classify && typeof source.classify === "object" ? source.classify : {};
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

  const providersSource: Partial<ProvidersConfig> = source.providers && typeof source.providers === "object" ? source.providers : {};
  const providers: ProvidersConfig = {
    autoRegister: typeof providersSource.autoRegister === "boolean" ? providersSource.autoRegister : DEFAULT_CONFIG.providers.autoRegister,
    autoInstall: typeof providersSource.autoInstall === "boolean" ? providersSource.autoInstall : DEFAULT_CONFIG.providers.autoInstall,
    disabled: Array.isArray(providersSource.disabled) ? providersSource.disabled : [...DEFAULT_CONFIG.providers.disabled]
  };

  const ledgerSource: Partial<LedgerConfig> = source.ledger && typeof source.ledger === "object" ? source.ledger : {};
  const reviewSource: Partial<LedgerReviewConfig> = ledgerSource.review && typeof ledgerSource.review === "object" ? ledgerSource.review : {};
  const review: LedgerReviewConfig = {
    edits: typeof reviewSource.edits === "number" && Number.isFinite(reviewSource.edits) && reviewSource.edits > 0 ? Math.trunc(reviewSource.edits) : DEFAULT_CONFIG.ledger.review.edits,
    todos: typeof reviewSource.todos === "number" && Number.isFinite(reviewSource.todos) && reviewSource.todos > 0 ? Math.trunc(reviewSource.todos) : DEFAULT_CONFIG.ledger.review.todos
  };
  const ledger: LedgerConfig = {
    enabled: typeof ledgerSource.enabled === "boolean" ? ledgerSource.enabled : DEFAULT_CONFIG.ledger.enabled,
    review
  };

  return {
    dbPath: typeof source.dbPath === "string" ? source.dbPath : DEFAULT_CONFIG.dbPath,
    skillRoots: Array.isArray(source.skillRoots) ? source.skillRoots : [...DEFAULT_CONFIG.skillRoots],
    gate,
    classify,
    providers,
    ledger
  };
}

function loadConfig(root: string = skillenforceHome()): NovahizConfig {
  const config = readUserConfig(root);
  const dbOverride = process.env.SKILLEFORCE_DB;
  if (dbOverride && dbOverride.length > 0) config.dbPath = dbOverride;
  return config;
}

function readUserConfig(root: string): NovahizConfig {
  const userPath = join(root, "skillenforce.config.json");
  if (existsSync(userPath)) {
    try {
      return mergeConfig(JSON.parse(stripBom(readFileSync(userPath, "utf8"))) as Partial<NovahizConfig>);
    } catch (error) {
      throw new Error(`Invalid JSON in ${userPath}: ${(error as Error).message}`);
    }
  }
  const examplePath = join(root, "skillenforce.config.example.json");
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

export function loadSpec(root: string = skillenforceHome()): Spec {
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
