/**
 * `novahiz improve` — the command surface of self-observation.
 *
 * `scan` reads the ledger and writes proposals; it changes nothing else.
 * `apply` refuses everything that is not a mechanical skill demotion, and even
 * that one goes through a snapshot, a disk re-read, a rollback and a registry
 * entry. There is no `apply --all`, on purpose: a system that rewrites its own
 * gate in a loop is not improving, it is drifting.
 */
import { existsSync } from "node:fs";
import { type Parsed, asString, dbPathFor, flagOn, print } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { autoImproveState } from "../autoimprove.ts";
import { openDb } from "../db.ts";
import {
  applyProposal,
  detect,
  listProposals,
  proposalId,
  readProposal,
  sampleDb,
  selectWithinBudget,
  setProposalStatus,
  skillEvidence,
  SKILL_EVIDENCE_MIN_SESSIONS,
  writeProposal,
} from "../improve.ts";

function usage(): void {
  process.stderr.write(
    [
      "usage:",
      "  novahiz improve scan [--dry]        Read the ledger, write proposals (nothing is applied)",
      "  novahiz improve evidence [--skill <id>]  Per skill: sessions, green/failed/silent, verdict (correlation, not causality)",
      "  novahiz improve list [--status proposed|applied|dismissed|rejected]",
      "  novahiz improve show --id <id>",
      "  novahiz improve dismiss --id <id> [--reason <text>]",
      "  novahiz improve apply --id <id> [--yes]   Mechanical kinds only; snapshot + rollback + registry",
      "",
    ].join("\n")
  );
}

export function commandImprove(parsed: Parsed): void {
  const sub = parsed.positionals[1] ?? "list";
  const home = NovahizHome();
  const gate = autoImproveState();

  // The switch covers what changes something: scanning (which writes proposals)
  // and applying. Reading the list or one proposal stays available, so a
  // disabled system can still be audited.
  if (!gate.enabled && (sub === "scan" || sub === "apply")) {
    print({ home, disabled: true, reason: gate.reason, action: sub });
    return;
  }

  if (sub === "scan") {
    const spec = loadSpec(home);
    const dbPath = dbPathFor(home, spec);
    if (!existsSync(dbPath)) {
      print({ home, scanned: false, reason: `aucun ledger: ${dbPath}`, proposals: [] });
      return;
    }
    const db = openDb(dbPath);
    const proposals: { id: string; created: boolean; kind: string; target: string }[] = [];
    const skippedDrafts: { kind: string; target: string }[] = [];
    try {
      const drafts = detect(sampleDb(db), spec);
      if (flagOn(parsed, "dry")) {
        print({ home, dry: true, candidates: drafts });
        return;
      }
      // Budget: other open proposals count against the five-a-scan cap, but a
      // draft already recorded is not new work and is not counted twice.
      const draftIds = new Set(drafts.map((draft) => proposalId(draft.kind, draft.target)));
      const otherOpen = listProposals(home).filter(
        (proposal) => proposal.status === "proposed" && !draftIds.has(proposal.id)
      ).length;
      const { accepted, skipped } = selectWithinBudget(drafts, otherOpen);
      for (const draft of accepted) {
        const { proposal, created } = writeProposal(home, draft);
        // A settled proposal (dismissed, or rejected less than a week ago) is
        // not reopened by a scan and not reported: repeating it is noise.
        if (!created && proposal.status !== "proposed") continue;
        proposals.push({ id: proposal.id, created, kind: proposal.kind, target: proposal.target });
      }
      if (skipped.length > 0) {
        skippedDrafts.push(...skipped.map((draft) => ({ kind: draft.kind, target: draft.target })));
      }
    } finally {
      db.close();
    }
    print({
      home,
      scanned: true,
      count: proposals.length,
      created: proposals.filter((p) => p.created).length,
      skippedByBudget: skippedDrafts,
      proposals,
    });
    return;
  }

  if (sub === "list") {
    const status = asString(parsed.flags.status);
    const all = listProposals(home);
    const filtered = status ? all.filter((proposal) => proposal.status === status) : all;
    print({
      home,
      count: filtered.length,
      proposals: filtered.map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        target: proposal.target,
        status: proposal.status,
        createdAt: proposal.createdAt,
        reason: proposal.reason,
      })),
    });
    return;
  }

  if (sub === "show") {
    const id = asString(parsed.flags.id);
    const proposal = id ? readProposal(home, id) : null;
    if (!proposal) {
      print({ error: `proposition inconnue: ${id || "(vide)"}` });
      process.exitCode = 1;
      return;
    }
    print(proposal);
    return;
  }

  if (sub === "dismiss") {
    const id = asString(parsed.flags.id);
    const updated = id ? setProposalStatus(home, id, "dismissed", asString(parsed.flags.reason)) : null;
    if (!updated) {
      print({ error: `proposition inconnue: ${id || "(vide)"}` });
      process.exitCode = 1;
      return;
    }
    print({ dismissed: updated.id, status: updated.status, note: updated.note });
    return;
  }

  if (sub === "evidence") {
    // Correlation, not causality: sessions where a skill was loaded and a
    // verification turned green afterwards. The threshold refuses to conclude
    // before 5 sessions, and the label says "unproven" instead of guessing.
    const spec = loadSpec(home);
    const dbPath = dbPathFor(home, spec);
    if (!existsSync(dbPath)) {
      print({ home, measured: false, reason: `aucun ledger: ${dbPath}`, skills: [] });
      return;
    }
    const db = openDb(dbPath);
    try {
      const all = skillEvidence(sampleDb(db));
      const only = asString(parsed.flags.skill);
      const rows = only ? all.filter((row) => row.skill === only) : all;
      print({
        home,
        measured: true,
        minSessions: SKILL_EVIDENCE_MIN_SESSIONS,
        note: "correlation entre chargement et verification verte, pas une mesure de qualite du skill",
        skills: rows,
      });
    } finally {
      db.close();
    }
    return;
  }

  if (sub === "reopen") {    // A dismissal is meant to stick, but a decision can be wrong. Reopening is
    // explicit, and the scan will not do it on its own.
    const id = asString(parsed.flags.id);
    const updated = id ? setProposalStatus(home, id, "proposed", asString(parsed.flags.reason)) : null;
    if (!updated) {
      print({ error: `proposition inconnue: ${id || "(vide)"}` });
      process.exitCode = 1;
      return;
    }
    print({ reopened: updated.id, status: updated.status });
    return;
  }

  if (sub === "apply") {
    const id = asString(parsed.flags.id);
    if (!id) {
      usage();
      process.exitCode = 2;
      return;
    }
    const proposal = readProposal(home, id);
    if (!proposal) {
      print({ error: `proposition inconnue: ${id}` });
      process.exitCode = 1;
      return;
    }
    if (!flagOn(parsed, "yes")) {
      print({
        proposal,
        applied: false,
        reason: "supervisee : relancer avec --yes apres lecture de la proposition",
      });
      return;
    }
    const result = applyProposal(home, id);
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  usage();
  process.exitCode = 2;
}
