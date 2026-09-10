import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Category = {
  id: string;
  label: string;
  priority: number;
  keywords: string[];
  defaultSkills: string[];
};

export type RuleWhen = {
  fileClasses?: string[];
  pathGlobs?: string[];
  promptCategories?: string[];
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

export type GateConfig = {
  enabled: boolean;
  mode: "block" | "warn" | "audit";
  envEscape: string;
  tools: string[];
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
};

export type Spec = {
  root: string;
  config: NovahizConfig;
  categories: Category[];
  rules: Rule[];
  overrides: Overrides;
};

export const DEFAULT_CONFIG: NovahizConfig = {
  dbPath: "novahiz.sqlite",
  skillRoots: [],
  gate: {
    enabled: true,
    mode: "block",
    envEscape: "NOVAHIZ_GATE",
    tools: ["edit", "write", "patch"]
  },
  classify: {
    minScore: 1,
    maxCategories: 3,
    fallbackCategory: "general"
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function mergeConfig(raw: Partial<NovahizConfig> | null | undefined): NovahizConfig {
  const source = raw ?? {};
  return {
    dbPath: typeof source.dbPath === "string" ? source.dbPath : DEFAULT_CONFIG.dbPath,
    skillRoots: Array.isArray(source.skillRoots) ? source.skillRoots : DEFAULT_CONFIG.skillRoots,
    gate: { ...DEFAULT_CONFIG.gate, ...(source.gate ?? {}) },
    classify: { ...DEFAULT_CONFIG.classify, ...(source.classify ?? {}) }
  };
}

export function loadConfig(root: string = novahizHome()): NovahizConfig {
  const userPath = join(root, "novahiz.config.json");
  if (existsSync(userPath)) {
    try {
      return mergeConfig(JSON.parse(readFileSync(userPath, "utf8")) as Partial<NovahizConfig>);
    } catch (error) {
      throw new Error(`Invalid JSON in ${userPath}: ${(error as Error).message}`);
    }
  }
  const examplePath = join(root, "novahiz.config.example.json");
  if (existsSync(examplePath)) return mergeConfig(readJson<Partial<NovahizConfig>>(examplePath));
  return DEFAULT_CONFIG;
}

export function loadSpec(root: string = novahizHome()): Spec {
  return {
    root,
    config: loadConfig(root),
    categories: readJson<Category[]>(join(root, "catalog", "categories.json")),
    rules: readJson<Rule[]>(join(root, "catalog", "rules.json")),
    overrides: readJson<Overrides>(join(root, "catalog", "overrides.json"))
  };
}
