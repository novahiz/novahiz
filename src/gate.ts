import type { Spec } from "./spec.ts";

export type FileClass = "code" | "text" | "design" | "data" | "config" | "other";

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

  if (base.startsWith(".")) {
    const rest = base.replace(/^\.+/, "").toLowerCase();
    if (rest.length === 0) return "other";
    const direct = CLASS_BY_EXTENSION[rest];
    if (direct) return direct;
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
          output += "(?:.*/)?";
        } else {
          output += ".*";
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

export type GateInput = {
  tool: string;
  filePath: string;
  categories?: string[];
  loadedSkills?: string[];
  installedSkills?: ReadonlySet<string> | null;
  installedIndexAvailable?: boolean;
  spec: Spec;
};

export type GateResult = {
  allow: boolean;
  fileClass: FileClass;
  requiredSkills: string[];
  missingSkills: string[];
  unmatchedRequired: string[];
  matchedRules: string[];
  indexMissing: boolean;
};

export function evaluateGate(input: GateInput): GateResult {
  const classification = fileClass(input.filePath);
  const categories = input.categories ?? [];
  const path = input.filePath.replace(/\\/g, "/");
  const requiredSkills: string[] = [];
  const matchedRules: string[] = [];

  for (const rule of input.spec.rules) {
    const byClass = rule.when.fileClasses?.includes(classification) ?? false;
    const byPath = rule.when.pathGlobs?.some((glob) => globToRegExp(glob).test(path)) ?? false;
    const byCategory = rule.when.promptCategories?.some((category) => categories.includes(category)) ?? false;
    if (!byClass && !byPath && !byCategory) continue;
    matchedRules.push(rule.id);
    for (const skill of rule.require) {
      if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
    }
  }

  for (const id of categories) {
    const category = input.spec.categories.find((entry) => entry.id === id);
    if (!category) continue;
    for (const skill of category.defaultSkills) {
      if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
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

  return {
    allow: missingSkills.length === 0,
    fileClass: classification,
    requiredSkills: effective,
    missingSkills,
    unmatchedRequired,
    matchedRules,
    indexMissing: input.installedIndexAvailable === false
  };
}
