/**
 * Phase 1 of self-improvement: observe, propose, never change.
 *
 * Three things are worth proposing, because each one is measurable:
 *
 * 1. **A missing category** — sessions keep falling into the fallback category
 *    with a score of 0. That is an observation, not a decision: a new category
 *    changes how everything classifies, so the proposal carries the naming step
 *    (the web check for the idiomatic English term) and stays unapplied.
 * 2. **A skill that never did anything** — it was loaded, and in the same
 *    session nothing was edited and no evidence was recorded after it. Even so,
 *    one session proves nothing; three do. And "useless here" is not "useless":
 *    the proposal only demotes required → advisory, never deletes.
 * 3. **A failure that keeps repeating** — the same verification failed three
 *    times, or a todo exhausted its iterations. That is where "learned" starts:
 *    read the documentation, write or patch a skill.
 *
 * Nothing here writes to `catalog/`, `src/` or the gate. Proposals land in
 * `proposals/`, one JSON file each, and an unapplied proposal is a suggestion —
 * which is exactly what a single session's opinion deserves.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadSpec, type Spec } from "./spec.ts";
import { createBackup } from "./backup.ts";
import { appendEvolution, readEvolution } from "./evolution.ts";
import { hashText } from "./fingerprint.ts";
import { classify } from "./classify.ts";
import { evaluateGate } from "./gate.ts";
import { loadInstalledSkills } from "./catalog.ts";

export type ProposalKind = "missing-category" | "unused-skill" | "repeated-failure";

export type ProposalStatus = "proposed" | "applied" | "dismissed" | "rejected";

/** The mechanical edit an `unused-skill` proposal would make. Reviewable by design. */
export type ProposalPatch = { file: string; category: string; step: string; skill: string };

export type ProposalDraft = {
  kind: ProposalKind;
  target: string;
  reason: string;
  evidence: Record<string, number | string | string[]>;
  patch: ProposalPatch | null;
  /** What would prove the change is safe. Structural here, never behavioural. */
  test: string;
  rollback: string;
  requires: string[];
};

export type Proposal = ProposalDraft & {
  id: string;
  createdAt: string;
  status: ProposalStatus;
  note: string;
  /** When the status last moved. Absent on records written before 0.11.4. */
  decidedAt?: string;
};

/**
 * A dismissal is a decision, not a pause. Re-proposing the same observation on
 * every scan makes the command noise, and a noisy advisor gets ignored — which
 * is the same as having none. A rejection is different: the attempt failed, so
 * the observation may still be right, and it comes back after a week.
 */
export const REJECTED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type DbSample = {
  sessions: { id: string; categories: string[]; prompt: string | null; updated_at: string }[];
  invocations: { session_id: string; skill: string; invoked_at: string }[];
  enforcement: { session_id: string | null; logged_at: string }[];
  evidence: { session_id: string | null; name: string; ok: number; created_at: string }[];
  todos: { id: string; label: string; iterations: number; status: string }[];
};

export const MIN_SESSIONS = 3;
export const MIN_FAILURES = 3;

/**
 * Budget. A system that improves at every turn is a system nobody can audit:
 * five new proposals per scan, one applied change per 24 h. The cap is not a
 * performance knob, it is what keeps the registry readable.
 */
export const MAX_PROPOSALS_PER_SCAN = 5;
export const MAX_APPLIES_PER_DAY = 1;

export function proposalsDir(home: string): string {
  return join(home, "proposals");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function proposalId(kind: ProposalKind, target: string): string {
  return `${kind}-${slug(target)}`;
}

/** Read the ledger once, defensively: an older database may miss a table. */
export function sampleDb(db: DatabaseSync): DbSample {
  const rows = <T>(sql: string): T[] => {
    try {
      return db.prepare(sql).all() as T[];
    } catch {
      return [];
    }
  };
  const sessions = rows<{ id: string; categories: string; prompt: string | null; updated_at: string }>(
    "SELECT id, categories, prompt, updated_at FROM sessions"
  ).map((row) => ({
    id: row.id,
    categories: safeArray(row.categories),
    prompt: row.prompt,
    updated_at: row.updated_at,
  }));
  return {
    sessions,
    invocations: rows<{ session_id: string; skill: string; invoked_at: string }>(
      "SELECT session_id, skill, invoked_at FROM skill_invocations"
    ),
    enforcement: rows<{ session_id: string | null; logged_at: string }>(
      "SELECT session_id, logged_at FROM enforcement_log"
    ),
    evidence: rows<{ session_id: string | null; name: string; ok: number; created_at: string }>(
      "SELECT session_id, name, ok, created_at FROM evidence"
    ),
    todos: rows<{ id: string; label: string; iterations: number; status: string }>(
      "SELECT id, label, iterations, status FROM todos"
    ),
  };
}

function safeArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Skill ids a roadmap step *requires* (the ones the gate blocks on). */
function requiredSkills(spec: Spec): { skill: string; category: string; step: string }[] {
  const found: { skill: string; category: string; step: string }[] = [];
  for (const category of spec.categories) {
    for (const step of category.roadmap?.steps ?? []) {
      for (const skill of step.requireSkills ?? []) {
        found.push({ skill, category: category.id, step: step.id });
      }
    }
  }
  return found;
}

export function detectMissingCategory(sample: DbSample, spec: Spec): ProposalDraft[] {
  const fallback = spec.config.classify.fallbackCategory || "general";
  const orphan = sample.sessions.filter(
    (session) => session.categories.length === 1 && session.categories[0] === fallback && (session.prompt ?? "").length >= 20
  );
  if (orphan.length < MIN_SESSIONS) return [];
  return [
    {
      kind: "missing-category",
      target: fallback,
      reason:
        `${orphan.length} sessions sont tombees dans la categorie de repli "${fallback}" avec un score nul : ` +
        `la taxonomie ne couvre pas ce type de demande.`,
      evidence: {
        sessions: orphan.length,
        fallback,
        prompts: orphan.slice(0, 5).map((session) => (session.prompt ?? "").slice(0, 120)),
      },
      patch: null,
      test:
        "aucun test mecanique possible : une nouvelle categorie change toute la classification. " +
        "Le test est une revue du catalogue (categories.json) et des roadmaps avant ecriture.",
      rollback: "aucun ecrit, donc rien a annuler : la proposition est un document.",
      requires: [
        "validation humaine (creer une categorie est une decision de conception)",
        "recherche web du nom anglais idiomatique avant toute creation",
        "roadmap et skills associes seulement si honnetement necessaires",
      ],
    },
  ];
}

export function detectUnusedSkill(sample: DbSample, spec: Spec): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  // A skill counts as "cited" when the session that loaded it produced an edit
  // or a recorded proof afterwards. Counting from the invocation time matters:
  // a skill loaded at 10:00 and used at 10:05 is not unused.
  const cited = new Map<string, boolean>();
  for (const invocation of sample.invocations) {
    const after = (stamp: string | null): boolean => stamp !== null && stamp >= invocation.invoked_at;
    const edited = sample.enforcement.some((row) => row.session_id === invocation.session_id && after(row.logged_at));
    const proved = sample.evidence.some((row) => row.session_id === invocation.session_id && after(row.created_at));
    const key = `${invocation.session_id}::${invocation.skill}`;
    cited.set(key, (cited.get(key) ?? false) || edited || proved);
  }

  for (const entry of requiredSkills(spec)) {
    const sessions = sample.invocations.filter((row) => row.skill === entry.skill);
    if (sessions.length < MIN_SESSIONS) continue;
    const useless = sessions.filter((row) => cited.get(`${row.session_id}::${row.skill}`) === false);
    if (useless.length < sessions.length) continue;
    // The prompts are kept: they are what a behavioural before/after proof
    // replays, and the sessions themselves may be pruned before apply runs.
    const prompts = sessions
      .map((row) => sample.sessions.find((session) => session.id === row.session_id)?.prompt ?? "")
      .filter((prompt) => prompt.trim().length >= 10)
      .slice(0, 5)
      .map((prompt) => prompt.slice(0, 200));
    drafts.push({
      kind: "unused-skill",
      target: entry.skill,
      reason:
        `"${entry.skill}" a ete charge dans ${sessions.length} sessions et n'a produit ni edition ni preuve ` +
        `dans aucune d'elles. Il est requis par l'etape "${entry.step}" de "${entry.category}".`,
      evidence: { sessions: sessions.length, useless: useless.length, category: entry.category, step: entry.step, prompts },
      patch: { file: "catalog/categories.json", category: entry.category, step: entry.step, skill: entry.skill },
      test:
        "comportemental : les prompts enregistres sont rejoues dans le classifieur et le gate avant/apres. " +
        "La classification doit rester identique et le seul skill qui disparait des exigences doit etre celui-ci. " +
        "Sans prompt disponible, la preuve retombe en structurelle et le dit.",
      rollback: "snapshot auto-improve pris juste avant l'ecriture, plus l'entree du registre d'evolution.",
      requires: [
        `confirmation apres ${MIN_SESSIONS} occurrences (jamais sur une seule session)`,
        "passage de requis a consultatif, jamais suppression",
      ],
    });
  }
  return drafts;
}

export function detectRepeatedFailure(sample: DbSample): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const failures = new Map<string, number>();
  for (const row of sample.evidence) {
    if (row.ok === 0) failures.set(row.name, (failures.get(row.name) ?? 0) + 1);
  }
  for (const [name, count] of failures) {
    if (count < MIN_FAILURES) continue;
    drafts.push({
      kind: "repeated-failure",
      target: name,
      reason: `La verification "${name}" a echoue ${count} fois : la documentation ou le skill associe ne couvre pas ce cas.`,
      evidence: { failures: count, verification: name },
      patch: null,
      test:
        "un patch de skill ne se croit pas : eval avant/apres sur les prompts qui ont echoue. " +
        "Un patch qui ne fait pas progresser l'eval est rejete.",
      rollback: "le skill d'origine est conserve (copie dans le snapshot auto-improve pris avant ecriture).",
      requires: [
        "lire la documentation (novahiz-docs puis web) avant d'ecrire",
        "eval avant/apres : sans progres mesure, pas d'application",
      ],
    });
  }
  for (const todo of sample.todos) {
    if (todo.status === "done" || todo.iterations < MIN_FAILURES) continue;
    drafts.push({
      kind: "repeated-failure",
      target: `todo:${todo.id}`,
      reason: `La tache "${todo.label}" a tourne ${todo.iterations} fois sans aboutir.`,
      evidence: { iterations: todo.iterations, todo: todo.id },
      patch: null,
      test: "reformuler la tache en etapes verifiables, puis prouver la premiere.",
      rollback: "aucun ecrit : la tache reste dans le ledger.",
      requires: ["diagnostic manuel : le blocage est peut-etre dans le projet, pas dans le systeme"],
    });
  }
  return drafts;
}

export function detect(sample: DbSample, spec: Spec): ProposalDraft[] {
  return [
    ...detectMissingCategory(sample, spec),
    ...detectUnusedSkill(sample, spec),
    ...detectRepeatedFailure(sample),
  ];
}

// ── P1: skill effectiveness, measured as a correlation ─────────────────────
// What this can and cannot say: it counts, per skill, the sessions where the
// skill was loaded and a verification turned green afterwards. That is a
// correlation between "loaded" and "the work got proven", not a causal measure
// of the skill's prose — nothing deterministic can score instruction quality.
// The label says exactly that, and the threshold refuses to conclude early.

export type SkillEvidence = {
  skill: string;
  /** Sessions where the skill was invoked. */
  sessions: number;
  /** Of those, sessions with a green verification created after the load. */
  concluded: number;
  /** Sessions with only red verifications after the load. */
  failed: number;
  /** Sessions with no verification at all after the load. */
  silent: number;
  /** concluded / (concluded + failed), null when nothing was proven either way. */
  rate: number | null;
  verdict: "supported" | "suspect" | "unproven";
};

export const SKILL_EVIDENCE_MIN_SESSIONS = 5;
const SUPPORTED_RATE = 0.8;

export function skillEvidence(sample: DbSample): SkillEvidence[] {
  const bySkill = new Map<string, { concluded: number; failed: number; silent: number; sessions: number }>();
  const seen = new Set<string>();
  for (const invocation of sample.invocations) {
    const key = `${invocation.session_id}::${invocation.skill}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = bySkill.get(invocation.skill) ?? { concluded: 0, failed: 0, silent: 0, sessions: 0 };
    bucket.sessions += 1;
    const after = sample.evidence.filter(
      (row) => row.session_id === invocation.session_id && row.created_at >= invocation.invoked_at
    );
    if (after.some((row) => row.ok === 1)) bucket.concluded += 1;
    else if (after.some((row) => row.ok === 0)) bucket.failed += 1;
    else bucket.silent += 1;
    bySkill.set(invocation.skill, bucket);
  }

  return [...bySkill.entries()]
    .map(([skill, bucket]) => {
      const outcomes = bucket.concluded + bucket.failed;
      const rate = outcomes > 0 ? bucket.concluded / outcomes : null;
      const verdict: SkillEvidence["verdict"] =
        bucket.sessions < SKILL_EVIDENCE_MIN_SESSIONS
          ? "unproven"
          : bucket.silent === bucket.sessions
            ? "suspect"
            : rate !== null && rate >= SUPPORTED_RATE
              ? "supported"
              : "unproven";
      return { skill, sessions: bucket.sessions, concluded: bucket.concluded, failed: bucket.failed, silent: bucket.silent, rate, verdict };
    })
    .sort((a, b) => b.sessions - a.sessions || a.skill.localeCompare(b.skill));
}

/**
 * Keep at most `limit` *new* proposals per scan. Already-open proposals are not
 * counted: seeing the same observation again is not a new proposal, and the
 * budget exists to bound new work, not to silence what is already recorded.
 */
export function selectWithinBudget(
  drafts: ProposalDraft[],
  alreadyOpen: number,
  limit: number = MAX_PROPOSALS_PER_SCAN
): { accepted: ProposalDraft[]; skipped: ProposalDraft[] } {
  const room = Math.max(limit - alreadyOpen, 0);
  return { accepted: drafts.slice(0, room), skipped: drafts.slice(room) };
}

/** How many mechanical changes were applied in the last 24 h. */
export function appliesInLastDay(home: string, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return readEvolution(home).entries.filter((entry) => entry.kind === "skill-demotion" && entry.at >= cutoff).length;
}

export function readProposal(home: string, id: string): Proposal | null {
  try {
    return JSON.parse(readFileSync(join(proposalsDir(home), `${id}.json`), "utf8")) as Proposal;
  } catch {
    return null;
  }
}

export function listProposals(home: string): Proposal[] {
  const dir = proposalsDir(home);
  if (!existsSync(dir)) return [];
  const found: Proposal[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const proposal = readProposal(home, entry.slice(0, -5));
    if (proposal) found.push(proposal);
  }
  return found.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Persist a draft. A proposal already open for the same kind and target is not
 * duplicated: the same observation twice is one proposal, not two. A dismissed
 * one stays dismissed; a rejected one returns after a week.
 */
export function writeProposal(
  home: string,
  draft: ProposalDraft,
  now: Date = new Date()
): { proposal: Proposal; created: boolean } {
  const id = proposalId(draft.kind, draft.target);
  const existing = readProposal(home, id);
  if (existing) {
    if (existing.status === "proposed" || existing.status === "dismissed") return { proposal: existing, created: false };
    if (existing.status === "rejected") {
      const decided = Date.parse(existing.decidedAt ?? existing.createdAt);
      if (Number.isFinite(decided) && now.getTime() - decided < REJECTED_COOLDOWN_MS) {
        return { proposal: existing, created: false };
      }
    }
  }
  const proposal: Proposal = {
    ...draft,
    id,
    createdAt: now.toISOString(),
    status: "proposed",
    note: "",
    decidedAt: now.toISOString(),
  };
  const dir = proposalsDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(proposal, null, 2) + "\n", "utf8");
  return { proposal, created: true };
}

export function setProposalStatus(
  home: string,
  id: string,
  status: ProposalStatus,
  note = "",
  now: Date = new Date()
): Proposal | null {
  const proposal = readProposal(home, id);
  if (!proposal) return null;
  const updated: Proposal = { ...proposal, status, note: note || proposal.note, decidedAt: now.toISOString() };
  writeFileSync(join(proposalsDir(home), `${id}.json`), JSON.stringify(updated, null, 2) + "\n", "utf8");
  return updated;
}

// ── Phase 2: supervised application ────────────────────────────────────────
// Exactly one proposal kind is mechanical enough to apply: demoting a required
// skill to advisory. A category is a design decision, and a skill patch needs
// an eval — neither can be produced by a template, so both stay manual.
//
// The order is the safety contract: snapshot, patch, verify from disk, and put
// the original bytes back at the first sign of doubt. An apply that leaves the
// system different from both the before and the intended-after state is a bug.

export type ApplyResult = {
  ok: boolean;
  id: string;
  reason?: string;
  backup: string | null;
  evolution: string | null;
  proof: "structural" | "behavioural" | null;
  changed: string[];
};

export const APPLICABLE_KINDS: ProposalKind[] = ["unused-skill"];

type CategoryDoc = {
  id: string;
  roadmap?: { steps?: { id: string; requireSkills?: string[]; [key: string]: unknown }[]; [key: string]: unknown };
  [key: string]: unknown;
};

export function applyProposal(home: string, id: string, now: Date = new Date()): ApplyResult {
  const base: ApplyResult = { ok: false, id, backup: null, evolution: null, proof: null, changed: [] };
  const proposal = readProposal(home, id);
  if (!proposal) return { ...base, reason: `proposition inconnue: ${id}` };
  if (proposal.status !== "proposed") return { ...base, reason: `statut "${proposal.status}" : seule une proposition ouverte s'applique` };
  if (!APPLICABLE_KINDS.includes(proposal.kind) || !proposal.patch) {
    return {
      ...base,
      reason:
        `"${proposal.kind}" demande une decision humaine : ${proposal.requires.join("; ")}. ` +
        `Seul "unused-skill" a une ecriture mecanique sure.`,
    };
  }
  const patch = proposal.patch;
  if (patch.file !== "catalog/categories.json") {
    return { ...base, reason: `fichier non supporte: ${patch.file}` };
  }

  const used = appliesInLastDay(home, now);
  if (used >= MAX_APPLIES_PER_DAY) {
    return {
      ...base,
      reason:
        `budget atteint : ${used} application(s) sur 24 h (max ${MAX_APPLIES_PER_DAY}). ` +
        `Une modification par jour, pour que le registre reste relisible et la regression attribuable.`,
    };
  }

  const target = join(home, patch.file);
  if (!existsSync(target)) return { ...base, reason: `fichier absent: ${patch.file}` };
  const original = readFileSync(target, "utf8");
  let doc: CategoryDoc[];
  try {
    const parsed = JSON.parse(original);
    if (!Array.isArray(parsed)) throw new Error("categories.json doit etre un tableau");
    doc = parsed as CategoryDoc[];
  } catch (error) {
    return { ...base, reason: `categories.json illisible: ${(error as Error).message}` };
  }

  const category = doc.find((entry) => entry.id === patch.category);
  const step = category?.roadmap?.steps?.find((entry) => entry.id === patch.step);
  const skills = step?.requireSkills;
  if (!category || !step || !Array.isArray(skills)) {
    return { ...base, reason: `cible introuvable: ${patch.category}/${patch.step}` };
  }
  if (!skills.includes(patch.skill)) {
    return { ...base, reason: `le skill "${patch.skill}" n'est plus requis par ${patch.category}/${patch.step}` };
  }

  // Reference copy of everything that must not move.
  const untouched = JSON.stringify(doc.map((entry) => (entry.id === patch.category ? { ...entry, roadmap: undefined } : entry)));

  // Behavioural baseline, captured on the real classifier and the real gate
  // before the file moves. If a probe cannot run, the proof stays structural
  // and says so — a claim without a measurement is not upgraded silently.
  const prompts = (Array.isArray(proposal.evidence.prompts) ? proposal.evidence.prompts : []).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length >= 10
  );
  let beforeProbes: Probe[] | null = null;
  if (prompts.length > 0) {
    try {
      beforeProbes = runProbes(loadSpec(home), prompts);
    } catch {
      beforeProbes = null;
    }
  }

  const backup = createBackup(home, { kind: "auto-improve", note: `avant application de ${id}`, now });
  step.requireSkills = skills.filter((skill) => skill !== patch.skill);
  writeFileSync(target, JSON.stringify(doc, null, 2) + "\n", "utf8");

  const failure = structuralCheck(target, patch, untouched);
  if (failure) {
    writeFileSync(target, original, "utf8");
    setProposalStatus(home, id, "rejected", `test structurel en echec: ${failure}`);
    return { ...base, backup: backup.id, reason: `test structurel en echec (${failure}) — fichier restaure` };
  }

  let proof: "structural" | "behavioural" = "structural";
  let proofNote = beforeProbes === null ? "aucun prompt rejoue" : "";
  if (beforeProbes !== null) {
    try {
      const afterProbes = runProbes(loadSpec(home), prompts);
      const exercised = beforeProbes.some((probe) => probe.missing.includes(patch.skill));
      const drift = compareProbes(beforeProbes, afterProbes, patch.skill);
      if (drift) {
        writeFileSync(target, original, "utf8");
        setProposalStatus(home, id, "rejected", `preuve comportementale en echec: ${drift}`);
        return { ...base, backup: backup.id, reason: `preuve comportementale en echec (${drift}) — fichier restaure` };
      }
      if (exercised) proof = "behavioural";
      else proofNote = "les sondes n'ont pas exerce ce skill";
    } catch (error) {
      proofNote = `sondes impossibles (${(error as Error).message.slice(0, 80)})`;
    }
  }

  const evolution = appendEvolution(
    home,
    {
      kind: "skill-demotion",
      target: patch.skill,
      reason: proposal.reason,
      provenance: "learned",
      before: hashText(original),
      after: hashText(readFileSync(target, "utf8")),
      evidence: [proposal.id],
      verdict: "applied",
      rollbackTo: backup.id,
      note: `proposition ${id} — preuve ${proof}${proofNote ? ` (${proofNote})` : ""}`,
    },
    now
  );
  setProposalStatus(home, id, "applied", `applique sur ${patch.category}/${patch.step}`);
  return {
    ok: true,
    id,
    backup: backup.id,
    evolution: evolution.id,
    proof,
    changed: [`${patch.category}/${patch.step}: ${patch.skill} requis -> consultatif`],
  };
}

/**
 * Replay the recorded prompts through the real classifier and the real gate.
 * Same conditions both times: nothing loaded, same probe file, same index.
 */
function runProbes(spec: Spec, prompts: string[]): Probe[] {
  const index = loadInstalledSkills(spec);
  return prompts.map((prompt) => {
    const classification = classify(spec, prompt);
    const categories = classification.categories.map((entry) => entry.id);
    const result = evaluateGate({
      tool: "edit",
      filePath: "src/probe.ts",
      content: "export const probe = 1;\n",
      prompt,
      categories,
      loadedSkills: [],
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec,
    });
    return {
      prompt,
      categories: categories.join(","),
      missing: [...result.missingSkills].sort(),
    };
  });
}

type Probe = { prompt: string; categories: string; missing: string[] };

/**
 * What a demotion is allowed to change: the demoted skill disappears from the
 * missing set, and nothing else moves. A category shift means the change is not
 * scoped to one step — the whole task now reads differently.
 */
function compareProbes(before: Probe[], after: Probe[], skill: string): string | null {
  if (before.length !== after.length) return "nombre de sondes different";
  for (let index = 0; index < before.length; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left.categories !== right.categories) {
      return `sonde ${index + 1}: classification "${left.categories}" -> "${right.categories}"`;
    }
    const added = right.missing.filter((entry) => !left.missing.includes(entry));
    if (added.length > 0) return `sonde ${index + 1}: le gate exige desormais ${added.join(", ")}`;
    const removed = left.missing.filter((entry) => !right.missing.includes(entry) && entry !== skill);
    if (removed.length > 0) return `sonde ${index + 1}: ${removed.join(", ")} n'est plus exige`;
  }
  return null;
}

/** Independent re-read: valid JSON, the skill gone, every other category identical. */
function structuralCheck(target: string, patch: ProposalPatch, untouched: string): string | null {
  let doc: CategoryDoc[];
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    if (!Array.isArray(parsed)) return "le fichier n'est plus un tableau";
    doc = parsed as CategoryDoc[];
  } catch (error) {
    return `JSON invalide apres ecriture: ${(error as Error).message}`;
  }
  const after = JSON.stringify(doc.map((entry) => (entry.id === patch.category ? { ...entry, roadmap: undefined } : entry)));
  if (after !== untouched) return "une autre categorie a bouge";
  const skills = doc.find((entry) => entry.id === patch.category)?.roadmap?.steps?.find((entry) => entry.id === patch.step)
    ?.requireSkills;
  if (!Array.isArray(skills)) return `etape ${patch.step} illisible`;
  if (skills.includes(patch.skill)) return `le skill est toujours requis`;
  return null;
}
