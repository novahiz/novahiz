/**
 * Graft integration for skillenforce — version-controls the SQLite ledger.
 *
 * Provides: init, commit, log, diff, status, restore, isAvailable, isInitialized.
 * Auto-commit is handled by calling `commitGraft()` from ledger operations.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { skillenforceHome } from "./spec.ts";

// ── Graft binary resolution ──────────────────────────────────────────────────
// Graft is expected on PATH. If not found, we degrade gracefully (no-op).

let _graftBinary: string | null = null;

function graftBinary(): string {
  if (_graftBinary !== null) return _graftBinary;
  // Try common locations on Windows where npm global bin lives
  const candidates = ["graft", "graft.exe"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "pipe", timeout: 5000 });
      _graftBinary = c;
      return _graftBinary;
    } catch {
      // not found, try next
    }
  }
  _graftBinary = "graft"; // fallback — will fail with clear error
  return _graftBinary;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function graftDir(): string {
  return resolve(skillenforceHome(), ".graft");
}

function ledgerPath(): string {
  const envDb = process.env.SKILLEFORCE_DB || process.env.NOVAHIZ_DB;
  if (envDb) return resolve(envDb);
  // Default: skillenforce.sqlite in the skillenforce home directory
  return resolve(skillenforceHome(), "skillenforce.sqlite");
}

function runGraft(args: string[], opts?: { timeout?: number }): string {
  const bin = graftBinary();
  const db = ledgerPath();
  const fullArgs = ["--db", db, ...args];
  try {
    return execFileSync(bin, fullArgs, {
      stdio: "pipe",
      timeout: opts?.timeout ?? 30_000,
      cwd: skillenforceHome(),
      encoding: "utf-8",
    }).trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString() ?? "";
    const stdout = err.stdout?.toString() ?? "";
    throw new Error(`graft ${args[0]} failed: ${stderr || stdout || err.message}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Check if graft CLI is available on PATH. */
export function isGraftAvailable(): boolean {
  try {
    execFileSync(graftBinary(), ["--version"], { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Check if .graft directory exists in the skillenforce home. */
export function isGraftInitialized(): boolean {
  return existsSync(graftDir());
}

/** Initialize a .graft repository in the skillenforce home directory. */
export function initGraft(): { success: boolean; message: string } {
  if (!isGraftAvailable()) {
    return { success: false, message: "graft CLI not found on PATH" };
  }
  if (isGraftInitialized()) {
    return { success: true, message: "graft already initialized" };
  }
  try {
    // graft init creates .graft/ in cwd
    execFileSync(graftBinary(), ["init"], {
      stdio: "pipe",
      timeout: 10_000,
      cwd: skillenforceHome(),
    });
    // Configure user identity
    try {
      runGraft(["config", "set", "user.name", "skillenforce"]);
      runGraft(["config", "set", "user.email", "skillenforce@local"]);
    } catch {
      // non-critical
    }
    return { success: true, message: "graft initialized" };
  } catch (err: any) {
    return { success: false, message: `init failed: ${err.message}` };
  }
}

/**
 * Stage and commit the ledger database.
 * No-op if graft is not initialized or unavailable.
 * Returns commit info or null if nothing to commit.
 */
export function commitGraft(message: string): { hash: string; message: string } | null {
  if (!isGraftAvailable() || !isGraftInitialized()) return null;
  const db = ledgerPath();
  // Stage the database file (--force needed because .gitignore excludes *.sqlite)
  try {
    runGraft(["add", "--force", db]);
  } catch {
    // may be no changes — graft add exits non-zero if nothing changed
    return null;
  }
  // Commit
  try {
    const out = runGraft(["commit", "-m", message]);
    // parse "[abc123] message"
    const match = out.match(/^\[([a-f0-9]+)\]\s*(.*)/m);
    if (match) {
      return { hash: match[1], message: match[2] };
    }
    return { hash: "unknown", message };
  } catch {
    return null;
  }
}

/** Get commit log as an array of objects. */
export function getGraftLog(limit = 20): Array<{ hash: string; date: string; message: string }> {
  if (!isGraftAvailable() || !isGraftInitialized()) return [];
  try {
    const out = runGraft(["log", "--json", `--limit=${limit}`]);
    const data = JSON.parse(out);
    // graft JSON output has `commits` array
    const commits = data.commits ?? [];
    return commits.map((entry: any) => ({
      hash: (entry.id ?? "unknown").slice(0, 8),
      date: entry.timestamp_ms ? new Date(entry.timestamp_ms).toISOString() : "",
      message: entry.message ?? "",
    }));
  } catch {
    return [];
  }
}

/** Get diff between current ledger and last committed version. */
export function getGraftDiff(): string {
  if (!isGraftAvailable() || !isGraftInitialized()) return "(graft not initialized)";
  try {
    return runGraft(["diff"]);
  } catch {
    return "(no diff available)";
  }
}

/** Get graft status output. */
export function getGraftStatus(): string {
  if (!isGraftAvailable() || !isGraftInitialized()) return "graft not initialized";
  try {
    return runGraft(["status"]);
  } catch {
    return "status unavailable";
  }
}

/** Restore the ledger to a specific revision. */
export function restoreGraft(revision: string): { success: boolean; message: string } {
  if (!isGraftAvailable() || !isGraftInitialized()) {
    return { success: false, message: "graft not initialized" };
  }
  try {
    runGraft(["checkout", revision]);
    return { success: true, message: `restored to ${revision}` };
  } catch (err: any) {
    return { success: false, message: `restore failed: ${err.message}` };
  }
}

/** Export a snapshot of the ledger as a physical .sqlite file. */
export function exportGraft(revision: string, outputPath: string): { success: boolean; message: string } {
  if (!isGraftAvailable() || !isGraftInitialized()) {
    return { success: false, message: "graft not initialized" };
  }
  try {
    runGraft(["export", revision, "--output", outputPath]);
    return { success: true, message: `exported to ${outputPath}` };
  } catch (err: any) {
    return { success: false, message: `export failed: ${err.message}` };
  }
}

// ── Auto-commit wrapper ──────────────────────────────────────────────────────

/**
 * Wraps a ledger operation with auto-commit.
 * Call this after any significant write to the database.
 * The commit message is generated from the operation type.
 */
export function autoCommit(operation: string, detail?: string): void {
  const msg = detail ? `skillenforce: ${operation} — ${detail}` : `skillenforce: ${operation}`;
  try {
    commitGraft(msg);
  } catch {
    // H12: auto-commit failures must never break the caller
  }
}
