/**
 * File fingerprints for backups and the native manifest.
 *
 * A backup that cannot be verified is a hope, not a backup. Every snapshot
 * stores the SHA-256 of each file it claims to hold, so a restore can prove the
 * bytes it is about to write are the bytes that were saved.
 *
 * The whitelist matters as much as the digest: copying `node_modules`, the
 * 14 MB documentation index and the sqlite registry would turn each snapshot
 * into a slow, noisy archive of things that are either rebuildable or private.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Directories that carry system source. Everything else stays out. */
export const SYSTEM_DIRS = ["catalog", "src", "skills", "adapters", "install", "mcp", "docs", "scripts", "bin"];

/** Root files that decide how the system behaves. */
export const SYSTEM_FILES = [
  "package.json",
  "package-lock.json",
  "novahiz.config.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "CHANGELOG.md",
];

/**
 * Skipped anywhere in the tree:
 * - node_modules, dist, build: rebuilt by `npm install` / `npm run prepare`
 * - data: the 14 MB novahiz-docs sqlite index and its WAL
 * - backups, manifest, evolution: the safety net cannot contain itself
 * - tmp, logs, .snap, .graph, .search, project-memory: session artefacts
 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "data",
  "tmp",
  "logs",
  "backups",
  "proposals",
  "manifest",
  "evolution",
  "project-memory",
  "coverage",
  ".git",
  ".snap",
  ".graph",
  ".search",
  ".backup-novahiz-fixes-20261029",
]);

export type FileEntry = { sha256: string; size: number };

export function hashBytes(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashText(text: string): string {
  return hashBytes(Buffer.from(text, "utf8"));
}

/** Digest of a file, or null when it cannot be read. */
export function hashFile(path: string): string | null {
  try {
    return hashBytes(readFileSync(path));
  } catch {
    return null;
  }
}

function skip(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".backup-");
}

/**
 * Every system file of a Novahiz home, as posix relative paths ("src/gate.ts").
 * Deterministic order, so a manifest diff is stable.
 */
export function walkSystemFiles(home: string): string[] {
  const found: string[] = [];
  const walk = (absolute: string, base: string): void => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (skip(entry.name)) continue;
        walk(join(absolute, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/\.sqlite(-wal|-shm)?$/.test(entry.name)) continue;
      found.push(rel);
    }
  };
  for (const dir of SYSTEM_DIRS) {
    const absolute = join(home, dir);
    if (existsSync(absolute)) walk(absolute, dir);
  }
  for (const file of SYSTEM_FILES) {
    if (existsSync(join(home, file))) found.push(file);
  }
  return found.sort();
}

/** Fingerprints of the given files (default: every system file). One read each. */
export function fingerprintFiles(home: string, files?: string[]): Record<string, FileEntry> {
  const entries: Record<string, FileEntry> = {};
  for (const rel of (files ?? walkSystemFiles(home)).sort()) {
    let buffer: Buffer;
    try {
      buffer = readFileSync(join(home, rel));
    } catch {
      continue;
    }
    entries[rel] = { sha256: hashBytes(buffer), size: buffer.length };
  }
  return entries;
}
