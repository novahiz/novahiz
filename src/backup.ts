/**
 * Versioned snapshots of a Novahiz home.
 *
 * The failures that motivated this module were not exotic: an allowlist that
 * blocked every database open, a gate that refused all writes, a plugin edited
 * mid-session. Each one was repaired by hand, from memory, with no way back.
 *
 * Two levels, as asked for:
 * - `native`      — taken before the first self-improvement; the way home.
 *                    Never pruned automatically: it is the baseline by
 *                    definition, and keeping only the two newest would delete
 *                    exactly the copy that matters.
 * - `auto-improve`— taken after a verified-good improvement; the newest two
 *                    are kept, so a repair can step back one generation.
 * - `pre-restore` — taken automatically before any restore, so a restore is
 *                    itself reversible. Newest two kept.
 *
 * Every snapshot carries the SHA-256 of each file it holds. `verify` re-hashes
 * the copies, and `restore` refuses to write when the snapshot fails its own
 * check — a corrupted backup must never overwrite a working system.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FileEntry, fingerprintFiles, hashFile, walkSystemFiles } from "./fingerprint.ts";

export type BackupKind = "native" | "auto-improve" | "pre-restore";

export type BackupMeta = {
  id: string;
  kind: BackupKind;
  createdAt: string;
  version: string;
  fileCount: number;
  bytes: number;
  note: string;
};

export type BackupManifest = {
  id: string;
  kind: BackupKind;
  createdAt: string;
  files: Record<string, FileEntry>;
};

export type VerifyResult = {
  id: string;
  ok: boolean;
  checked: number;
  missing: string[];
  mismatches: { path: string; expected: string; actual: string | null }[];
  extra: string[];
};

export type RestoreResult = {
  ok: boolean;
  id: string;
  dryRun: boolean;
  reason?: string;
  /** Files whose content changed on disk (new or modified). */
  written: string[];
  unchanged: number;
  /** Only with `prune`: files removed because the snapshot does not hold them. */
  pruned: string[];
  preRestore: BackupMeta | null;
  /**
   * `dist/` is excluded from snapshots (it is rebuilt, not source). When it
   * exists, the restored sources and the emitted build disagree until
   * `npm run prepare` runs — say so instead of letting `bin/novahiz.mjs`
   * execute stale code.
   */
  needsRebuild: boolean;
};

const META_FILE = "backup.json";
const MANIFEST_FILE = "manifest.json";
const FILES_DIR = "files";

/** Newest-two for derived snapshots; the native baseline is kept as long as it exists. */
export const RETENTION: Record<BackupKind, number> = {
  native: Number.POSITIVE_INFINITY,
  "auto-improve": 2,
  "pre-restore": 2,
};

export function isBackupKind(value: string): value is BackupKind {
  return value === "native" || value === "auto-improve" || value === "pre-restore";
}

export function backupRoot(home: string): string {
  return join(home, "backups");
}

export function backupDir(home: string, id: string): string {
  return join(backupRoot(home), id);
}

function readVersion(home: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(home, "package.json"), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Unique id: `<kind>-<YYYYMMDD-HHmmss>`, suffixed when two land in one second. */
function makeId(home: string, kind: BackupKind, date: Date): string {
  const base = `${kind}-${stamp(date)}`;
  let candidate = base;
  let suffix = 2;
  while (existsSync(backupDir(home, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export type CreateOptions = { kind?: BackupKind; note?: string; now?: Date };

/**
 * Copy every system file into `backups/<id>/files` and record its digest.
 * The manifest describes the copies (hashed after the copy), not the sources:
 * a snapshot proves what it holds.
 */
export function createBackup(home: string, options: CreateOptions = {}): BackupMeta {
  const kind = options.kind ?? "auto-improve";
  if (!isBackupKind(kind)) throw new Error(`unknown backup kind: ${kind}`);
  const now = options.now ?? new Date();
  const id = makeId(home, kind, now);
  const dir = backupDir(home, id);
  const filesDir = join(dir, FILES_DIR);
  mkdirSync(filesDir, { recursive: true });

  const sources = walkSystemFiles(home);
  const files: Record<string, FileEntry> = {};
  let bytes = 0;
  for (const rel of sources) {
    const source = join(home, rel);
    const target = join(filesDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    const digest = hashFile(target);
    if (digest === null) continue;
    const size = statSync(target).size;
    files[rel] = { sha256: digest, size };
    bytes += size;
  }

  const createdAt = now.toISOString();
  const manifest: BackupManifest = { id, kind, createdAt, files };
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const meta: BackupMeta = {
    id,
    kind,
    createdAt,
    version: readVersion(home),
    fileCount: Object.keys(files).length,
    bytes,
    note: options.note ?? "",
  };
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2) + "\n", "utf8");
  prune(home, kind);
  return meta;
}

/** Drop snapshots of a kind beyond its retention. Never touches `native`. */
export function prune(home: string, kind: BackupKind): string[] {
  const limit = RETENTION[kind];
  if (!Number.isFinite(limit)) return [];
  const kept = listBackups(home).filter((meta) => meta.kind === kind);
  const removed: string[] = [];
  for (const meta of kept.slice(limit)) {
    rmSync(backupDir(home, meta.id), { recursive: true, force: true });
    removed.push(meta.id);
  }
  return removed;
}

/** Newest first. Unreadable snapshots are skipped, not fatal. */
export function listBackups(home: string): BackupMeta[] {
  const root = backupRoot(home);
  if (!existsSync(root)) return [];
  const metas: BackupMeta[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(root, entry.name, META_FILE);
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as BackupMeta;
      if (!meta.id || !isBackupKind(String(meta.kind)) || !meta.createdAt) continue;
      metas.push(meta);
    } catch {
      continue;
    }
  }
  return metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
}

export function readManifest(home: string, id: string): BackupManifest | null {
  try {
    return JSON.parse(readFileSync(join(backupDir(home, id), MANIFEST_FILE), "utf8")) as BackupManifest;
  } catch {
    return null;
  }
}

/** Re-hash every stored file against the snapshot's own manifest. */
export function verifyBackup(home: string, id: string): VerifyResult {
  const manifest = readManifest(home, id);
  if (!manifest) {
    // No manifest, no proof: report the absence as a missing file rather than
    // returning an empty result that would read as "nothing to check, fine".
    return { id, ok: false, checked: 0, missing: [`${MANIFEST_FILE} absent`], mismatches: [], extra: [] };
  }
  const filesDir = join(backupDir(home, id), FILES_DIR);
  const missing: string[] = [];
  const mismatches: { path: string; expected: string; actual: string | null }[] = [];
  let checked = 0;
  for (const [rel, entry] of Object.entries(manifest.files)) {
    checked += 1;
    const actual = hashFile(join(filesDir, rel));
    if (actual === null) missing.push(rel);
    else if (actual !== entry.sha256) mismatches.push({ path: rel, expected: entry.sha256, actual });
  }
  // A file inside the snapshot that its manifest does not list: the snapshot
  // was written from outside the API, so it is not trustworthy either.
  const extra: string[] = [];
  if (existsSync(filesDir)) {
    const known = new Set(Object.keys(manifest.files));
    const walk = (absolute: string, base: string): void => {
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(absolute, entry.name), rel);
        else if (entry.isFile() && !known.has(rel)) extra.push(rel);
      }
    };
    walk(filesDir, "");
  }
  return { id, ok: missing.length === 0 && mismatches.length === 0 && extra.length === 0, checked, missing, mismatches, extra };
}

export type RestoreOptions = { dryRun?: boolean; prune?: boolean; note?: string; now?: Date };

/**
 * Write a snapshot back over the home.
 *
 * Order is the safety contract: verify, snapshot the current state, then write.
 * A restore that fails its own verification writes nothing. `prune` is opt-in
 * because deleting files is the one irreversible act here: it removes system
 * files the snapshot does not hold (a learned file added after the snapshot).
 */
export function restoreBackup(home: string, id: string, options: RestoreOptions = {}): RestoreResult {
  const dryRun = options.dryRun === true;
  const base = {
    id,
    dryRun,
    written: [] as string[],
    unchanged: 0,
    pruned: [] as string[],
    preRestore: null,
    needsRebuild: existsSync(join(home, "dist")),
  };
  const meta = listBackups(home).find((entry) => entry.id === id);
  if (!meta) return { ...base, ok: false, reason: `unknown backup: ${id}` };
  const manifest = readManifest(home, id);
  if (!manifest) return { ...base, ok: false, reason: `snapshot manifest unreadable: ${id}` };
  const verification = verifyBackup(home, id);
  if (!verification.ok) {
    return {
      ...base,
      ok: false,
      reason:
        `snapshot failed verification (${verification.missing.length} missing, ` +
        `${verification.mismatches.length} mismatched, ${verification.extra.length} unexpected) — nothing written`,
    };
  }

  const current = fingerprintFiles(home);
  const written: string[] = [];
  let unchanged = 0;
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (current[rel]?.sha256 === entry.sha256) unchanged += 1;
    else written.push(rel);
  }
  const orphans = Object.keys(current).filter((rel) => !(rel in manifest.files)).sort();

  if (dryRun) {
    return {
      ...base,
      ok: true,
      written,
      unchanged,
      pruned: options.prune === true ? orphans : [],
    };
  }

  const preRestore = createBackup(home, {
    kind: "pre-restore",
    note: options.note ?? `avant restauration de ${id}`,
    ...(options.now ? { now: options.now } : {}),
  });

  const filesDir = join(backupDir(home, id), FILES_DIR);
  for (const rel of written) {
    const target = join(home, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(filesDir, rel), target);
  }

  const pruned: string[] = [];
  if (options.prune === true) {
    for (const rel of orphans) {
      rmSync(join(home, rel), { force: true });
      pruned.push(rel);
    }
  }

  return { ...base, ok: true, written, unchanged, pruned, preRestore };
}

export type HealthCheck = { id: string; label: string; ok: boolean; detail: string; blocking: boolean };

/** Doctor row: is there a baseline, and does the newest snapshot still verify? */
export function backupHealth(home: string): HealthCheck {
  const metas = listBackups(home);
  if (metas.length === 0) {
    return {
      id: "backup",
      label: "Backups",
      ok: false,
      detail: "none yet — run: novahiz backup create --kind native (before any self-improvement)",
      blocking: false,
    };
  }
  const counts: Record<string, number> = {};
  for (const meta of metas) counts[meta.kind] = (counts[meta.kind] ?? 0) + 1;
  const newest = metas[0];
  const verification = verifyBackup(home, newest.id);
  const shape = Object.entries(counts)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  const baseline = counts.native ?? 0;
  return {
    id: "backup",
    label: "Backups",
    ok: verification.ok && baseline > 0,
    detail: verification.ok
      ? `${metas.length} snapshot(s) (${shape}); newest ${newest.id} verified (${verification.checked} files)`
      : `newest ${newest.id} fails verification: ${verification.missing.length} missing, ${verification.mismatches.length} mismatched, ${verification.extra.length} unexpected`,
    blocking: false,
  };
}
