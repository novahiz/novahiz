import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NOVAHIZ_DIR = ".novahiz";
export const CONFIG_NAME = "config.json";
export const STATE_NAME = "state.json";

export type ProjectAutoDocsConfig = {
  autoDocs?: boolean;
};

export type AutoDocsState = {
  dirty: boolean;
  pending: string[];
  lastSync: string | null;
  sessions: number;
};

export const EMPTY_STATE: AutoDocsState = {
  dirty: false,
  pending: [],
  lastSync: null,
  sessions: 0
};

const MAJOR_DIRS = /^(src|lib|app|routes|pages|api|server|internal|pkg|cmd)\//;
const MAJOR_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile"
]);
const MAJOR_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".php",
  ".rb",
  ".java",
  ".kt",
  ".swift",
  ".dart",
  ".sql"
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "project-memory",
  "novahiz-docs",
  ".novahiz",
  "dist",
  "build",
  "coverage",
  ".next"
]);

export function projectDir(cwd: string): string {
  return join(cwd, NOVAHIZ_DIR);
}

export function configPath(cwd: string): string {
  return join(projectDir(cwd), CONFIG_NAME);
}

export function statePath(cwd: string): string {
  return join(projectDir(cwd), STATE_NAME);
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function autoDocsEnabled(cwd: string): boolean {
  const escape = (process.env.NOVAHIZ_AUTODOCS ?? "").toLowerCase();
  if (["off", "0", "false", "no", "disabled"].includes(escape)) return false;
  const config = readProjectConfig(cwd);
  return config.autoDocs === true;
}

export function readProjectConfig(cwd: string): ProjectAutoDocsConfig {
  try {
    const raw = readFileSync(configPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectAutoDocsConfig>;
    if (!parsed || typeof parsed !== "object") return {};
    return { autoDocs: parsed.autoDocs === true };
  } catch {
    return {};
  }
}

export function writeProjectConfig(cwd: string, config: ProjectAutoDocsConfig): void {
  ensureDir(projectDir(cwd));
  writeFileSync(configPath(cwd), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function readState(cwd: string): AutoDocsState {
  try {
    const raw = readFileSync(statePath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<AutoDocsState>;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_STATE };
    return {
      dirty: parsed.dirty === true,
      pending: Array.isArray(parsed.pending)
        ? parsed.pending.filter((entry): entry is string => typeof entry === "string").slice(0, 64)
        : [],
      lastSync: typeof parsed.lastSync === "string" ? parsed.lastSync : null,
      sessions: typeof parsed.sessions === "number" && Number.isFinite(parsed.sessions) ? parsed.sessions : 0
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function writeState(cwd: string, state: AutoDocsState): void {
  ensureDir(projectDir(cwd));
  writeFileSync(statePath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function isMajorPath(filePath: string): boolean {
  const path = normalizePath(filePath);
  const parts = path.split("/");
  if (parts.some((part) => SKIP_DIRS.has(part))) return false;
  const base = parts[parts.length - 1] ?? "";
  if (MAJOR_FILES.has(base)) return true;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  if (MAJOR_EXT.has(ext)) return true;
  return MAJOR_DIRS.test(path);
}

export function markDirty(cwd: string, filePath: string): AutoDocsState {
  const path = normalizePath(filePath);
  const state = readState(cwd);
  const pending = state.pending.includes(path) ? state.pending : [...state.pending, path].slice(-64);
  const next: AutoDocsState = {
    ...state,
    dirty: true,
    pending,
    sessions: state.sessions + 1
  };
  writeState(cwd, next);
  return next;
}

export function clearDirty(cwd: string): AutoDocsState {
  const state = readState(cwd);
  const next: AutoDocsState = {
    ...state,
    dirty: false,
    pending: [],
    lastSync: new Date().toISOString()
  };
  writeState(cwd, next);
  return next;
}

export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function upsertChangesSection(doc: string, lines: string[]): string {
  const header = "## Recent changes";
  const stamp = `*Last updated: ${dateStamp()}*`;
  const bullet = lines.map((line) => `- ${line}`).join("\n");
  const footerMatch = doc.match(/\n---\n\n\*Last updated:.*$/s);
  const footer = footerMatch ? footerMatch[0] : `\n---\n\n${stamp}\n`;

  if (!doc.includes(header)) {
    const base = doc.replace(/\n---\n\n\*Last updated:.*$/s, "").replace(/\s+$/, "");
    return `${base}\n\n${header}\n\n${bullet}\n${footer}`;
  }

  const start = doc.indexOf(header);
  const after = doc.slice(start + header.length);
  const nextHeader = after.search(/\n#{1,6} /);
  const sectionEnd = nextHeader === -1 ? doc.length : start + header.length + nextHeader;
  const before = doc.slice(0, start);
  const rest = doc.slice(sectionEnd);
  return `${before}${header}\n\n${bullet}\n${rest}`;
}
