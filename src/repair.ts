/**
 * Phase 3: automatic repair, on a closed whitelist.
 *
 * A system that "repairs" anything is a system that invents fixes. So the list
 * is short, each entry is a symptom seen in a real session, and every fix is
 * either additive or rebuilds a derived artefact:
 *
 * - `skills-index`   — the index file is missing or unreadable, so the gate is
 *                      fail-closed and every edit is refused. Rebuilding it is
 *                      exactly what `novahiz sync` does.
 * - `stale-sessions` — sessions older than the 6 h TTL survived a prune. They
 *                      keep dead skills "loaded" and make `resume` lie.
 * - `backup-missing` — no native snapshot exists. Creating one is additive.
 * - `manifest-missing` — no baseline digests. Written only when there is no
 *                      snapshot to contradict, otherwise recording today as
 *                      "native" would launder whatever drift came before.
 *
 * Never on the list, by rule: `catalog/`, `src/`, `rules.json`, the gate, the
 * classifier. Those are decisions. A repair that rewrites them is not a repair.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupHealth, createBackup, listBackups } from "./backup.ts";
import { manifestHealth, manifestPath, writeManifest } from "./manifest.ts";
import { loadSpec } from "./spec.ts";
import { commandSync } from "./commands/inspect.ts";
import { dbPathFor } from "./commands/context.ts";

export type RepairCheck = {
  id: string;
  label: string;
  /** null when healthy. */
  problem: string | null;
  fixable: boolean;
  /** Why it cannot be fixed on its own, when that is the case. */
  reason: string | null;
};

export type RepairOutcome = {
  id: string;
  applied: boolean;
  ok: boolean;
  before: string | null;
  after: string;
  error: string | null;
};

export function repairChecks(home: string): RepairCheck[] {
  return [
    checkSkillsIndex(home),
    checkLedger(home),
    checkBackup(home),
    checkManifest(home),
  ];
}

function checkSkillsIndex(home: string): RepairCheck {
  const label = "Skills index";
  const file = join(home, "build", "installed-skills.json");
  if (!existsSync(file)) {
    return { id: "skills-index", label, problem: "build/installed-skills.json absent", fixable: true, reason: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const skills = Array.isArray(parsed) ? parsed : (parsed as { skills?: unknown[] }).skills;
    if (!Array.isArray(skills) || skills.length === 0) {
      return { id: "skills-index", label, problem: "index lisible mais vide", fixable: true, reason: null };
    }
    return { id: "skills-index", label, problem: null, fixable: true, reason: null };
  } catch (error) {
    return {
      id: "skills-index",
      label,
      problem: `index illisible: ${(error as Error).message.slice(0, 120)}`,
      fixable: true,
      reason: null,
    };
  }
}

/**
 * Read-only integrity check on the ledger.
 *
 * It must not open through `openDb`: that migrates and prunes, which is a
 * write. A corrupted database is also not something to "fix" in place — it is
 * restored from a snapshot, so this row only reports.
 */
function checkLedger(home: string): RepairCheck {
  const label = "Ledger integrity";
  try {
    const spec = loadSpec(home);
    const file = dbPathFor(home, spec);
    if (!existsSync(file)) return { id: "ledger-integrity", label, problem: null, fixable: false, reason: null };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
      const verdict = String(row?.integrity_check ?? "inconnu");
      return verdict === "ok"
        ? { id: "ledger-integrity", label, problem: null, fixable: false, reason: null }
        : {
            id: "ledger-integrity",
            label,
            problem: `PRAGMA integrity_check: ${verdict.slice(0, 120)}`,
            fixable: false,
            reason: "une base corrompue se restaure depuis un instantane (novahiz backup restore), pas se reecrire a chaud",
          };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      id: "ledger-integrity",
      label,
      problem: `ledger illisible: ${(error as Error).message.slice(0, 120)}`,
      fixable: false,
      reason:
        "un ledger illisible se restaure depuis un instantane (novahiz backup restore) ou se diagnostique (novahiz doctor) ; il ne se reecrit pas a chaud",
    };
  }
}

function checkBackup(home: string): RepairCheck {
  const label = "Native baseline backup";
  const health = backupHealth(home);
  if (health.ok) return { id: "backup-missing", label, problem: null, fixable: true, reason: null };
  const natives = listBackups(home).filter((meta) => meta.kind === "native");
  return {
    id: "backup-missing",
    label,
    problem: natives.length === 0 ? "aucun instantane native" : health.detail,
    fixable: natives.length === 0,
    reason:
      natives.length === 0
        ? null
        : "un instantane existe mais ne se verifie pas : le remplacer effacerait la reference, donc decision humaine",
  };
}

function checkManifest(home: string): RepairCheck {
  const label = "Native manifest";
  if (existsSync(manifestPath(home))) {
    const health = manifestHealth(home);
    return {
      id: "manifest-missing",
      label,
      problem: health.ok ? null : health.detail,
      fixable: false,
      reason: health.ok ? null : "un fichier systeme manque : cela se diagnostique, pas se reecrire",
    };
  }
  // Writing a baseline now is only honest when nothing can contradict it.
  const hasSnapshot = listBackups(home).some((meta) => meta.kind === "native");
  return {
    id: "manifest-missing",
    label,
    problem: "aucun manifeste de reference",
    fixable: !hasSnapshot,
    reason: hasSnapshot
      ? "un instantane native existe : ecrire le manifeste maintenant declarerait l'etat courant comme natif et masquerait la derive"
      : null,
  };
}

/** Apply one whitelisted fix, then re-run its check to prove the effect. */
export function applyRepair(home: string, id: string, now: Date = new Date()): RepairOutcome {
  const check = repairChecks(home).find((entry) => entry.id === id);
  const unknown: RepairOutcome = {
    id,
    applied: false,
    ok: false,
    before: null,
    after: "",
    error: `reparation inconnue: ${id} (liste blanche: skills-index, ledger-integrity, backup-missing, manifest-missing)`,
  };
  if (!check) return unknown;
  if (check.problem === null) return { id, applied: false, ok: true, before: null, after: "deja sain", error: null };
  if (!check.fixable) {
    return { id, applied: false, ok: false, before: check.problem, after: "", error: check.reason ?? "non reparable automatiquement" };
  }

  try {
    switch (id) {
      case "skills-index":
        commandSync();
        break;
      case "backup-missing":
        createBackup(home, { kind: "native", note: "reparation: baseline absente", now });
        break;
      case "manifest-missing":
        writeManifest(home, { origin: "baseline", now });
        break;
      default:
        return unknown;
    }
  } catch (error) {
    return {
      id,
      applied: true,
      ok: false,
      before: check.problem,
      after: "",
      error: `la reparation a echoue: ${(error as Error).message.slice(0, 200)}`,
    };
  }

  const after = repairChecks(home).find((entry) => entry.id === id);
  if (!after) {
    return { id, applied: true, ok: false, before: check.problem, after: "", error: `le controle "${id}" a disparu apres reparation` };
  }
  if (after.problem !== null) {
    // The command ran, the symptom is still there: say exactly that rather
    // than reporting success because a function was called.
    return {
      id,
      applied: true,
      ok: false,
      before: check.problem,
      after: after.problem,
      error: `la reparation s'est executee mais le probleme persiste: ${after.problem}`,
    };
  }
  return { id, applied: true, ok: true, before: check.problem, after: "sain", error: null };
}

export type RepairReport = { checks: RepairCheck[]; outcomes: RepairOutcome[] };

/** `apply: false` reports only. `apply: true` fixes every healthy-whitelisted problem. */
export function repair(home: string, options: { apply?: boolean; now?: Date } = {}): RepairReport {
  const checks = repairChecks(home);
  if (options.apply !== true) return { checks, outcomes: [] };
  const outcomes: RepairOutcome[] = [];
  for (const check of checks) {
    if (check.problem === null || !check.fixable) continue;
    outcomes.push(applyRepair(home, check.id, options.now));
  }
  return { checks, outcomes };
}
