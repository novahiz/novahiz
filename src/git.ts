// Git integration for Lodestone: blame, recent commits and working-tree
// status, read-only over the workspace. Every call spawns `git` with an
// argument array (never a shell string), a timeout and a capped buffer, and
// answers `{ repo: false }` instead of throwing when the root is not a
// repository or git is missing — "not a git repo" is a normal answer, not
// an error.

import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { statSync } from "node:fs";

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 5 * 1024 * 1024;

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitBlameEntry {
  line: number;
  commit: string;
  author: string;
  date: string;
  summary: string;
}

export interface GitModified {
  repo: boolean;
  staged: string[];
  untracked: string[];
  conflicted: string[];
}

export interface GitRecentResult {
  repo: boolean;
  commits: GitCommit[];
  truncated: boolean;
}

export interface GitBlameResult {
  repo: boolean;
  file: string;
  entries: GitBlameEntry[];
  truncated: boolean;
}

function runGit(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/** True when `root` is a work tree git can read. */
export function gitAvailable(root: string): boolean {
  const out = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return out !== null && out.trim() === "true";
}

function clamp(value: unknown, def: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return def;
  return Math.min(Math.max(Math.trunc(Number(value)), min), max);
}

/** `git log` compact: hash, author, ISO date, subject. */
export function gitRecent(root: string, limit?: number): GitRecentResult {
  const count = clamp(limit, 20, 1, 100);
  const out = runGit(root, [
    "log",
    `-n ${count + 1}`,
    "--pretty=format:%h|%an|%ad|%s",
    "--date=short",
  ]);
  if (out === null) return { repo: false, commits: [], truncated: false };
  const lines = out.split("\n").filter((line) => line.length > 0);
  const truncated = lines.length > count;
  const commits: GitCommit[] = lines.slice(0, count).map((line) => {
    const [hash, author, date, ...rest] = line.split("|");
    return { hash, author, date, subject: rest.join("|") };
  });
  return { repo: true, commits, truncated };
}

/**
 * `git blame` over a line range of one file. `file` must be a workspace-
 * relative path: absolute paths, `..` segments and drive prefixes are
 * refused before git is ever spawned.
 */
export function gitBlame(
  root: string,
  file: string,
  start?: number,
  count?: number
): GitBlameResult {
  const wanted = String(file ?? "").trim();
  const base: GitBlameResult = { repo: false, file: wanted, entries: [], truncated: false };
  if (wanted.length === 0) return base;
  if (isAbsolute(wanted) || /^[A-Za-z]:/.test(wanted)) return base;
  const rel = relative(resolve(root), resolve(root, wanted));
  if (rel.startsWith("..") || isAbsolute(rel)) return base;

  const from = clamp(start, 1, 1, 1_000_000);
  const span = clamp(count, 40, 1, 200);
  const out = runGit(root, [
    "blame",
    "--line-porcelain",
    `-L ${from},${from + span - 1}`,
    "--",
    wanted,
  ]);
  if (out === null) return base;

  const entries: GitBlameEntry[] = [];
  let current: { commit: string; line: number } | null = null;
  let author = "";
  let date = "";
  let summary = "";
  for (const rawLine of out.split("\n")) {
    const header = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(rawLine);
    if (header) {
      if (current !== null) {
        entries.push({ line: current.line, commit: current.commit, author, date, summary });
      }
      current = { commit: header[1].slice(0, 8), line: Number(header[3]) };
      author = "";
      date = "";
      summary = "";
      continue;
    }
    if (current === null) continue;
    if (rawLine.startsWith("author ")) author = rawLine.slice(7);
    else if (rawLine.startsWith("author-time ")) {
      const seconds = Number(rawLine.slice(12));
      if (Number.isFinite(seconds)) {
        date = new Date(seconds * 1000).toISOString().slice(0, 10);
      }
    } else if (rawLine.startsWith("summary ")) summary = rawLine.slice(8);
  }
  if (current !== null) {
    entries.push({ line: current.line, commit: current.commit, author, date, summary });
  }
  return { repo: true, file: wanted, entries, truncated: entries.length >= span };
}

/** Working-tree status: staged, untracked and conflicted paths. */
export function gitModified(root: string): GitModified {
  const empty: GitModified = { repo: false, staged: [], untracked: [], conflicted: [] };
  const out = runGit(root, ["status", "--porcelain=v1", "-uall"]);
  if (out === null) return empty;
  const staged: string[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];
  for (const line of out.split("\n")) {
    if (line.length < 3) continue;
    const code = line.slice(0, 2);
    const path = line.slice(3);
    if (code === "??") {
      untracked.push(path);
      continue;
    }
    if (code[0] !== " " && code[0] !== "?") staged.push(path);
    if (code[1] === "U" || code[0] === "U" || code === "AA" || code === "DD") {
      conflicted.push(path);
    }
  }
  return { repo: true, staged, untracked, conflicted };
}

/** True when `root` exists and is a directory (pre-flight for the MCP layer). */
export function isDirectory(root: string): boolean {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
}

/** Path separator re-exported for the MCP layer's safety checks. */
export const pathSep = sep;
