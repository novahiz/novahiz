/**
 * The baseline manifest: what Novahiz looked like when the safety net was laid.
 *
 * Provenance starts here. A file whose digest matches the manifest is untouched
 * since the baseline; one that differs was changed (`learned` or `user`); one
 * that is absent was removed; one that is new was added. That is the fact a
 * restore decision needs, and it is a fact, not a guess.
 *
 * Honest limitation: on a source checkout the manifest cannot recover the
 * shipped bytes — the home *is* the working tree. The first manifest is
 * therefore labelled `baseline`, not `native`. Once a release installs over it,
 * `novahiz manifest sync --origin package` records the shipped digests, and the
 * two stop being confusable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FileEntry, fingerprintFiles } from "./fingerprint.ts";

export type ManifestOrigin = "baseline" | "package";

export type NativeManifest = {
  version: string;
  origin: ManifestOrigin;
  createdAt: string;
  updatedAt: string;
  files: Record<string, FileEntry>;
};

export type ManifestDiff = {
  present: boolean;
  origin: ManifestOrigin | null;
  version: string | null;
  createdAt: string | null;
  total: number;
  unchanged: number;
  modified: string[];
  missing: string[];
  added: string[];
};

export function manifestPath(home: string): string {
  return join(home, "manifest", "native.json");
}

export function readManifest(home: string): NativeManifest | null {
  try {
    return JSON.parse(readFileSync(manifestPath(home), "utf8")) as NativeManifest;
  } catch {
    return null;
  }
}

function version(home: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(home, "package.json"), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Record the current digests as the baseline.
 * `createdAt` survives a re-sync: the baseline was laid once, at that moment.
 */
export function writeManifest(
  home: string,
  options: { origin?: ManifestOrigin; now?: Date; sourceRoot?: string } = {}
): NativeManifest {
  const existing = readManifest(home);
  const now = (options.now ?? new Date()).toISOString();
  // `sourceRoot` lets an install record the bytes of the package it copied,
  // rather than the state of the tree it landed in. Without it the manifest
  // describes the home, which on a source checkout IS the package — that is why
  // the first manifest is labelled "baseline" and not "native".
  const manifest: NativeManifest = {
    version: version(home),
    origin: options.origin ?? existing?.origin ?? "baseline",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    files: fingerprintFiles(options.sourceRoot ?? home),
  };
  const path = manifestPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

/** Compare disk against the baseline. No manifest means no statement, not a clean one. */
export function diffManifest(home: string): ManifestDiff {
  const manifest = readManifest(home);
  if (!manifest) {
    return {
      present: false,
      origin: null,
      version: null,
      createdAt: null,
      total: 0,
      unchanged: 0,
      modified: [],
      missing: [],
      added: [],
    };
  }
  const current = fingerprintFiles(home);
  const modified: string[] = [];
  const missing: string[] = [];
  let unchanged = 0;
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const now = current[rel];
    if (!now) missing.push(rel);
    else if (now.sha256 !== entry.sha256) modified.push(rel);
    else unchanged += 1;
  }
  const added = Object.keys(current)
    .filter((rel) => !(rel in manifest.files))
    .sort();
  return {
    present: true,
    origin: manifest.origin,
    version: manifest.version,
    createdAt: manifest.createdAt,
    total: Object.keys(manifest.files).length,
    unchanged,
    modified: modified.sort(),
    missing: missing.sort(),
    added,
  };
}

export type HealthCheck = { id: string; label: string; ok: boolean; detail: string; blocking: boolean };

/** Doctor row: does a baseline exist, and how far has the disk moved from it? */
export function manifestHealth(home: string): HealthCheck {
  if (!existsSync(manifestPath(home))) {
    return {
      id: "manifest",
      label: "Native manifest",
      ok: false,
      detail: "absent — run: novahiz manifest sync (records the baseline digests)",
      blocking: false,
    };
  }
  const diff = diffManifest(home);
  // A missing system file means the baseline cannot be trusted as a reference;
  // edits and additions are expected and only reported.
  return {
    id: "manifest",
    label: "Native manifest",
    ok: diff.missing.length === 0,
    detail:
      `${diff.origin} ${diff.version ?? ""}`.trim() +
      ` — ${diff.total} tracked, ${diff.unchanged} untouched, ${diff.modified.length} modified, ` +
      `${diff.added.length} added, ${diff.missing.length} missing`,
    blocking: false,
  };
}
