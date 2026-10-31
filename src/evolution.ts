/**
 * The evolution registry: what changed in Novahiz, when, why, and on whose say.
 *
 * Answering "is this feature native?" needs a durable record. Without one, a
 * learned skill, a user edit and a shipped rule look identical on disk, and a
 * restore cannot tell which of the three it should bring back.
 *
 * The file is append-only JSON Lines. Each record carries the hash of the
 * previous one, so removing, reordering or editing a line breaks the chain and
 * `verify` says so — which is the whole point: a registry that can be quietly
 * rewritten proves nothing.
 *
 * Provenance is part of the contract:
 * - `native`  — shipped with the release
 * - `learned` — derived by the system from observed failures
 * - `user`    — decided by the person at the keyboard
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { hashText } from "./fingerprint.ts";

export type Provenance = "native" | "learned" | "user";
export type Verdict = "proposed" | "applied" | "verified" | "rolled-back" | "rejected";

export type EvolutionEntry = {
  id: string;
  at: string;
  /** What kind of object changed: "category", "rule", "skill", "gate", "doc"… */
  kind: string;
  /** The object itself: a category id, a skill id, a file path. */
  target: string;
  /** Why it changed, in prose a human can judge. Required. */
  reason: string;
  provenance: Provenance;
  before: string | null;
  after: string | null;
  evidence: string[];
  verdict: Verdict;
  rollbackTo: string | null;
  note: string;
};

export type StoredEntry = EvolutionEntry & { prev: string; hash: string };

export type EvolutionInput = Partial<Omit<EvolutionEntry, "id" | "at">> & { kind: string; target: string; reason: string };

export const GENESIS = "0".repeat(64);

const PROVENANCES: Provenance[] = ["native", "learned", "user"];
const VERDICTS: Verdict[] = ["proposed", "applied", "verified", "rolled-back", "rejected"];

export function evolutionPath(home: string): string {
  return join(home, "evolution", "evolution.jsonl");
}

/**
 * Length-prefixed canonical form: the digest covers every field, in a fixed
 * order, plus the previous hash. Any edit to any field changes it.
 */
export function digestEntry(entry: EvolutionEntry, prev: string): string {
  return hashText(
    JSON.stringify([
      entry.id,
      entry.at,
      entry.kind,
      entry.target,
      entry.reason,
      entry.provenance,
      entry.before,
      entry.after,
      entry.evidence,
      entry.verdict,
      entry.rollbackTo,
      entry.note,
      prev,
    ])
  );
}

function validate(input: EvolutionInput): void {
  if (typeof input.kind !== "string" || input.kind.trim().length === 0) throw new Error("evolution: kind is required");
  if (typeof input.target !== "string" || input.target.trim().length === 0) throw new Error("evolution: target is required");
  if (typeof input.reason !== "string" || input.reason.trim().length < 8) {
    // A reason shorter than a sentence is a label, and a label cannot be
    // reviewed. The registry exists to be judged, so it asks for a real reason.
    throw new Error("evolution: reason must be a sentence (8+ characters)");
  }
  if (input.provenance !== undefined && !PROVENANCES.includes(input.provenance)) {
    throw new Error(`evolution: unknown provenance "${String(input.provenance)}" (native, learned, user)`);
  }
  if (input.verdict !== undefined && !VERDICTS.includes(input.verdict)) {
    throw new Error(`evolution: unknown verdict "${String(input.verdict)}"`);
  }
}

/** Last stored hash, or GENESIS when the registry is empty. */
export function lastHash(home: string): string {
  const { entries } = readEvolution(home);
  return entries.length > 0 ? entries[entries.length - 1].hash : GENESIS;
}

/** Append one record. Never rewrites: the file is opened in append mode. */
export function appendEvolution(home: string, input: EvolutionInput, now: Date = new Date()): StoredEntry {
  validate(input);
  const entry: EvolutionEntry = {
    id: `evo_${now.getTime().toString(36)}_${randomBytes(3).toString("hex")}`,
    at: now.toISOString(),
    kind: input.kind,
    target: input.target,
    reason: input.reason,
    provenance: input.provenance ?? "user",
    before: input.before ?? null,
    after: input.after ?? null,
    evidence: input.evidence ?? [],
    verdict: input.verdict ?? "applied",
    rollbackTo: input.rollbackTo ?? null,
    note: input.note ?? "",
  };
  const prev = lastHash(home);
  const stored: StoredEntry = { ...entry, prev, hash: digestEntry(entry, prev) };
  const path = evolutionPath(home);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(stored) + "\n", "utf8");
  return stored;
}

/** Read every record. Malformed lines are reported, not silently dropped. */
export function readEvolution(home: string): { entries: StoredEntry[]; problems: string[] } {
  const path = evolutionPath(home);
  if (!existsSync(path)) return { entries: [], problems: [] };
  const entries: StoredEntry[] = [];
  const problems: string[] = [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as StoredEntry;
      if (typeof parsed.hash !== "string" || typeof parsed.prev !== "string") {
        problems.push(`line ${index + 1}: missing hash chain fields`);
        continue;
      }
      entries.push(parsed);
    } catch {
      problems.push(`line ${index + 1}: not valid JSON`);
    }
  }
  return { entries, problems };
}

/** Recompute the chain. Any edit, removal or reorder shows up here. */
export function verifyEvolution(home: string): { ok: boolean; count: number; problems: string[] } {
  const { entries, problems } = readEvolution(home);
  const failures = [...problems];
  let expected = GENESIS;
  entries.forEach((entry, index) => {
    if (entry.prev !== expected) {
      failures.push(`line ${index + 1} (${entry.id}): chain broken — prev ${entry.prev.slice(0, 12)}… expected ${expected.slice(0, 12)}…`);
    }
    const recomputed = digestEntry(entry, entry.prev);
    if (recomputed !== entry.hash) {
      failures.push(`line ${index + 1} (${entry.id}): content altered — hash does not match`);
    }
    expected = entry.hash;
  });
  return { ok: failures.length === 0, count: entries.length, problems: failures };
}

export type HealthCheck = { id: string; label: string; ok: boolean; detail: string; blocking: boolean };

export function evolutionHealth(home: string): HealthCheck {
  const path = evolutionPath(home);
  if (!existsSync(path)) {
    return {
      id: "evolution",
      label: "Evolution registry",
      ok: false,
      detail: "absent — no change recorded yet (novahiz evolution append --kind … --target … --reason …)",
      blocking: false,
    };
  }
  const { entries } = readEvolution(home);
  const verdict = verifyEvolution(home);
  const last = entries[entries.length - 1];
  return {
    id: "evolution",
    label: "Evolution registry",
    ok: verdict.ok,
    detail: verdict.ok
      ? `${verdict.count} entr(y/ies), chain intact, last ${last ? `${last.kind}/${last.target} (${last.provenance})` : "—"}`
      : `chain broken: ${verdict.problems.slice(0, 3).join("; ")}`,
    blocking: false,
  };
}
