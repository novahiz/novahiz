import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { Spec } from "../src/spec.ts";
import {
  applyProposal,
  appliesInLastDay,
  detectMissingCategory,
  detectRepeatedFailure,
  detectUnusedSkill,
  listProposals,
  proposalId,
  readProposal,
  selectWithinBudget,
  setProposalStatus,
  skillEvidence,
  writeProposal,
  type DbSample,
  type ProposalDraft,
} from "../src/improve.ts";
import { listBackups } from "../src/backup.ts";
import { readEvolution, verifyEvolution } from "../src/evolution.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "novahiz-improve-"));
  made.push(home);
  mkdirSync(join(home, "catalog"), { recursive: true });
  writeFileSync(join(home, "package.json"), JSON.stringify({ name: "novahiz", version: "0.0.0" }), "utf8");
  return home;
}

const spec = {
  root: "",
  config: { classify: { fallbackCategory: "general" } },
  categories: [
    { id: "general", roadmap: { steps: [] } },
    { id: "code", roadmap: { steps: [{ id: "implement", requireSkills: ["novahiz-implement"] }] } },
  ],
  rules: [],
  overrides: {},
  providers: [],
} as unknown as Spec;

function emptySample(): DbSample {
  return { sessions: [], invocations: [], enforcement: [], evidence: [], todos: [] };
}

const long = "corrige le tunnel de paiement du formulaire de reservation";

describe("improve: detecter sans decider", () => {
  test("trois sessions dans la categorie de repli font une proposition", () => {
    const sample = emptySample();
    sample.sessions = [1, 2, 3].map((n) => ({
      id: `s${n}`,
      categories: ["general"],
      prompt: long,
      updated_at: "2026-10-29T10:00:00Z",
    }));
    const drafts = detectMissingCategory(sample, spec);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].kind, "missing-category");
    assert.equal(drafts[0].patch, null, "une categorie n'a pas d'ecriture mecanique");
    assert.ok(drafts[0].requires.some((entry) => /recherche web/.test(entry)));
  });

  test("deux sessions ne suffisent pas", () => {
    const sample = emptySample();
    sample.sessions = [1, 2].map((n) => ({ id: `s${n}`, categories: ["general"], prompt: long, updated_at: "x" }));
    assert.deepEqual(detectMissingCategory(sample, spec), []);
  });

  test("un skill charge trois fois sans aucune suite est propose en consultatif", () => {
    const sample = emptySample();
    sample.sessions = [1, 2, 3].map((n) => ({
      id: `s${n}`,
      categories: ["code"],
      prompt: long,
      updated_at: "x",
    }));
    sample.invocations = [1, 2, 3].map((n) => ({
      session_id: `s${n}`,
      skill: "novahiz-implement",
      invoked_at: "2026-10-29T10:00:00Z",
    }));

    const drafts = detectUnusedSkill(sample, spec);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].patch?.skill, "novahiz-implement");
    assert.equal(drafts[0].patch?.file, "catalog/categories.json");
  });

  test("une preuve posterieure au chargement disculpe le skill", () => {
    const sample = emptySample();
    sample.sessions = [1, 2, 3].map((n) => ({ id: `s${n}`, categories: ["code"], prompt: long, updated_at: "x" }));
    sample.invocations = [1, 2, 3].map((n) => ({
      session_id: `s${n}`,
      skill: "novahiz-implement",
      invoked_at: "2026-10-29T10:00:00Z",
    }));
    sample.evidence = [{ session_id: "s2", name: "typecheck", ok: 1, created_at: "2026-10-29T10:05:00Z" }];

    assert.deepEqual(detectUnusedSkill(sample, spec), []);
  });

  test("une preuve anterieure au chargement ne disculpe rien", () => {
    const sample = emptySample();
    sample.sessions = [1, 2, 3].map((n) => ({ id: `s${n}`, categories: ["code"], prompt: long, updated_at: "x" }));
    sample.invocations = [1, 2, 3].map((n) => ({
      session_id: `s${n}`,
      skill: "novahiz-implement",
      invoked_at: "2026-10-29T10:00:00Z",
    }));
    sample.evidence = [{ session_id: "s2", name: "typecheck", ok: 1, created_at: "2026-10-29T09:00:00Z" }];

    assert.equal(detectUnusedSkill(sample, spec).length, 1);
  });

  test("trois echecs de la meme verification font une proposition learned", () => {
    const sample = emptySample();
    sample.evidence = [1, 2, 3].map(() => ({ session_id: "s1", name: "typecheck", ok: 0, created_at: "x" }));
    const drafts = detectRepeatedFailure(sample);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].target, "typecheck");
    assert.ok(drafts[0].requires.some((entry) => /eval avant\/apres/.test(entry)));
  });

  test("deux echecs ne suffisent pas, une tache qui boucle oui", () => {
    const sample = emptySample();
    sample.evidence = [1, 2].map(() => ({ session_id: "s1", name: "typecheck", ok: 0, created_at: "x" }));
    assert.deepEqual(detectRepeatedFailure(sample), []);

    sample.todos = [{ id: "todo_1", label: "corriger le tunnel", iterations: 3, status: "pending" }];
    assert.equal(detectRepeatedFailure(sample).length, 1);
  });
});

describe("improve: efficacite d'un skill, mesuree comme une correlation", () => {
  function sample(): DbSample {
    const base = emptySample();
    base.sessions = Array.from({ length: 6 }, (_, index) => ({
      id: `s${index}`,
      categories: ["code"],
      prompt: long,
      updated_at: "x",
    }));
    base.invocations = base.sessions.map((session) => ({
      session_id: session.id,
      skill: "novahiz-implement",
      invoked_at: "2026-10-29T10:00:00Z",
    }));
    return base;
  }

  test("cinq sessions concluantes donnent un skill soutenu", () => {
    const data = sample();
    data.evidence = data.sessions.slice(0, 5).map((session) => ({
      session_id: session.id,
      name: "typecheck",
      ok: 1,
      created_at: "2026-10-29T10:05:00Z",
    }));
    const [row] = skillEvidence(data);
    assert.equal(row.sessions, 6);
    assert.equal(row.concluded, 5);
    assert.equal(row.silent, 1);
    assert.equal(row.verdict, "supported");
    assert.ok(row.rate !== null && row.rate >= 0.8);
  });

  test("moins de cinq sessions ne concluent rien", () => {
    const data = sample();
    data.sessions = data.sessions.slice(0, 3);
    data.invocations = data.invocations.slice(0, 3);
    data.evidence = data.sessions.map((session) => ({
      session_id: session.id,
      name: "typecheck",
      ok: 1,
      created_at: "2026-10-29T10:05:00Z",
    }));
    assert.equal(skillEvidence(data)[0].verdict, "unproven");
  });

  test("un skill jamais suivi d'une verification est suspect, pas prouve", () => {
    const data = sample();
    const [row] = skillEvidence(data);
    assert.equal(row.silent, 6);
    assert.equal(row.rate, null);
    assert.equal(row.verdict, "suspect");
  });

  test("une verification anterieure au chargement ne compte pas", () => {
    const data = sample();
    data.evidence = data.sessions.map((session) => ({
      session_id: session.id,
      name: "typecheck",
      ok: 1,
      created_at: "2026-10-29T09:00:00Z",
    }));
    const [row] = skillEvidence(data);
    assert.equal(row.concluded, 0);
    assert.equal(row.verdict, "suspect");
  });

  test("les echecs comptent contre le taux", () => {
    const data = sample();
    data.evidence = [
      ...data.sessions.slice(0, 2).map((session) => ({
        session_id: session.id,
        name: "typecheck",
        ok: 1 as const,
        created_at: "2026-10-29T10:05:00Z",
      })),
      ...data.sessions.slice(2).map((session) => ({
        session_id: session.id,
        name: "typecheck",
        ok: 0 as const,
        created_at: "2026-10-29T10:05:00Z",
      })),
    ];
    const [row] = skillEvidence(data);
    assert.equal(row.concluded, 2);
    assert.equal(row.failed, 4);
    assert.equal(row.verdict, "unproven");
  });
});

describe("improve: propositions stockees, jamais dupliquees", () => {
  const draft: ProposalDraft = {
    kind: "unused-skill",
    target: "novahiz-implement",
    reason: "charge dans 3 sessions sans aucune suite",
    evidence: { sessions: 3 },
    patch: { file: "catalog/categories.json", category: "code", step: "implement", skill: "novahiz-implement" },
    test: "structurel",
    rollback: "snapshot auto-improve",
    requires: ["confirmation"],
  };

  test("deux scans produisent une seule proposition ouverte", () => {
    const home = makeHome();
    assert.equal(writeProposal(home, draft).created, true);
    assert.equal(writeProposal(home, draft).created, false);
    assert.equal(listProposals(home).length, 1);
    assert.equal(listProposals(home)[0].id, proposalId("unused-skill", "novahiz-implement"));
  });

  test("dismiss change le statut et laisse une trace", () => {
    const home = makeHome();
    const { proposal } = writeProposal(home, draft);
    const updated = setProposalStatus(home, proposal.id, "dismissed", "le skill a servi hors ledger");
    assert.equal(updated?.status, "dismissed");
    assert.equal(updated?.note, "le skill a servi hors ledger");
    assert.equal(readProposal(home, proposal.id)?.status, "dismissed");
  });

  test("une proposition ecartee n'est pas ressuscitee par un scan", () => {    const home = makeHome();
    const { proposal } = writeProposal(home, draft);
    setProposalStatus(home, proposal.id, "dismissed", "artefact de test", new Date("2026-10-29T10:00:00Z"));

    const again = writeProposal(home, draft, new Date("2026-10-29T11:00:00Z"));
    assert.equal(again.created, false);
    assert.equal(again.proposal.status, "dismissed");
  });

  test("un rejet revient apres une semaine, pas avant", () => {
    const home = makeHome();
    const { proposal } = writeProposal(home, draft, new Date("2026-10-01T10:00:00Z"));
    setProposalStatus(home, proposal.id, "rejected", "test structurel en echec", new Date("2026-10-01T10:05:00Z"));

    const soon = writeProposal(home, draft, new Date("2026-10-03T10:00:00Z"));
    assert.equal(soon.created, false, "un rejet recent ne se represente pas tout de suite");

    const later = writeProposal(home, draft, new Date("2026-10-09T10:00:00Z"));
    assert.equal(later.created, true, "apres une semaine, l'observation peut revenir");
    assert.equal(later.proposal.status, "proposed");
  });

  test("reopen ramene une proposition ecartee, explicitement", () => {
    const home = makeHome();
    const { proposal } = writeProposal(home, draft);
    setProposalStatus(home, proposal.id, "dismissed", "erreur de jugement");
    const reopened = setProposalStatus(home, proposal.id, "proposed", "finalement pertinente");
    assert.equal(reopened?.status, "proposed");
    assert.equal(writeProposal(home, draft).created, false, "et elle n'est pas dupliquee");
  });
});

describe("improve: application supervisee, reversible", () => {
  function setup(): { home: string; id: string } {
    const home = makeHome();
    writeFileSync(
      join(home, "catalog", "categories.json"),
      JSON.stringify(
        [
          { id: "general", defaultSkills: ["novahiz-plan"], roadmap: { steps: [] } },
          { id: "code", defaultSkills: [], roadmap: { steps: [{ id: "implement", requireSkills: ["novahiz-implement", "novahiz-converge"] }] } },
        ],
        null,
        2
      ) + "\n",
      "utf8"
    );
    const { proposal } = writeProposal(home, {
      kind: "unused-skill",
      target: "novahiz-implement",
      reason: "charge dans 3 sessions sans aucune suite",
      evidence: { sessions: 3 },
      patch: { file: "catalog/categories.json", category: "code", step: "implement", skill: "novahiz-implement" },
      test: "structurel",
      rollback: "snapshot auto-improve",
      requires: ["confirmation"],
    });
    return { home, id: proposal.id };
  }

  test("l'application retire le skill requis, laisse une sauvegarde et une entree de registre", () => {
    const { home, id } = setup();
    const result = applyProposal(home, id, new Date("2026-10-29T12:00:00Z"));

    assert.equal(result.ok, true, result.reason);
    assert.equal(result.proof, "structural");
    const doc = JSON.parse(readFileSync(join(home, "catalog", "categories.json"), "utf8")) as {
      id: string;
      roadmap: { steps: { id: string; requireSkills: string[] }[] };
    }[];
    assert.deepEqual(doc.find((entry) => entry.id === "code")!.roadmap.steps[0].requireSkills, ["novahiz-converge"]);

    assert.ok(result.backup);
    assert.equal(listBackups(home).find((meta) => meta.id === result.backup)!.kind, "auto-improve");

    const { entries } = readEvolution(home);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, "skill-demotion");
    assert.equal(entries[0].provenance, "learned");
    assert.equal(entries[0].rollbackTo, result.backup);
    assert.equal(verifyEvolution(home).ok, true);
    assert.equal(readProposal(home, id)!.status, "applied");
  });

  test("la preuve comportementale rejoue le classifieur et le gate sur les prompts enregistres", () => {
    const home = makeHome();
    writeFileSync(
      join(home, "catalog", "categories.json"),
      JSON.stringify(
        [
          { id: "general", priority: 10, keywords: [], defaultSkills: [], roadmap: { steps: [] } },
          {
            id: "code",
            priority: 60,
            keywords: ["function", "implement", "code", "refactor", "module"],
            defaultSkills: [],
            roadmap: { steps: [{ id: "implement", requireSkills: ["novahiz-implement", "novahiz-converge"] }] },
          },
        ],
        null,
        2
      ) + "\n",
      "utf8"
    );
    writeFileSync(join(home, "catalog", "rules.json"), "[]\n", "utf8");
    writeFileSync(join(home, "catalog", "overrides.json"), "{}\n", "utf8");

    const prompt =
      "implemente la function de paiement dans le module de reservation, refactor le code et ajoute les tests";
    const { proposal } = writeProposal(home, {
      kind: "unused-skill",
      target: "novahiz-implement",
      reason: "charge dans 3 sessions sans aucune suite",
      evidence: { sessions: 3, prompts: [prompt] },
      patch: { file: "catalog/categories.json", category: "code", step: "implement", skill: "novahiz-implement" },
      test: "comportemental",
      rollback: "snapshot auto-improve",
      requires: ["confirmation"],
    });

    const result = applyProposal(home, proposal.id);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.proof, "behavioural", "les sondes ont exerce le skill : la preuve est comportementale");
    const { entries } = readEvolution(home);
    assert.match(entries[0].note, /preuve behavioural/);
  });

  test("le budget borne les nouvelles propositions d'un scan", () => {
    const draft = (target: string): ProposalDraft => ({
      kind: "repeated-failure",
      target,
      reason: "trois echecs de la meme verification",
      evidence: {},
      patch: null,
      test: "eval",
      rollback: "-",
      requires: [],
    });
    const drafts = ["a", "b", "c", "d", "e", "f", "g"].map(draft);
    const roomy = selectWithinBudget(drafts, 0);
    assert.equal(roomy.accepted.length, 5);
    assert.equal(roomy.skipped.length, 2);

    const tight = selectWithinBudget(drafts, 3);
    assert.equal(tight.accepted.length, 2);
    assert.equal(tight.skipped.length, 5);

    const full = selectWithinBudget(drafts, 9);
    assert.equal(full.accepted.length, 0);
    assert.equal(full.skipped.length, 7);
  });

  test("une seule application mecanique par 24 h", () => {
    const { home, id } = setup();
    const first = applyProposal(home, id, new Date("2026-10-29T12:00:00Z"));
    assert.equal(first.ok, true, first.reason);
    assert.equal(appliesInLastDay(home, new Date("2026-10-29T13:00:00Z")), 1);

    const { proposal: second } = writeProposal(home, {
      kind: "unused-skill",
      target: "novahiz-converge",
      reason: "charge dans 3 sessions sans aucune suite",
      evidence: { sessions: 3 },
      patch: { file: "catalog/categories.json", category: "code", step: "implement", skill: "novahiz-converge" },
      test: "structurel",
      rollback: "snapshot auto-improve",
      requires: ["confirmation"],
    });
    const refused = applyProposal(home, second.id, new Date("2026-10-29T13:00:00Z"));
    assert.equal(refused.ok, false);
    assert.match(String(refused.reason), /budget atteint/);

    // Le lendemain, le budget est revenu : la limite borne le rythme, pas le droit.
    const later = applyProposal(home, second.id, new Date("2026-10-30T13:00:00Z"));
    assert.equal(later.ok, true, later.reason);
  });

  test("une proposition deja appliquee ne s'applique pas deux fois", () => {    const { home, id } = setup();
    assert.equal(applyProposal(home, id).ok, true);
    const second = applyProposal(home, id);
    assert.equal(second.ok, false);
    assert.match(String(second.reason), /statut "applied"/);
  });

  test("une categorie manquante n'a pas d'application mecanique", () => {
    const home = makeHome();
    const { proposal } = writeProposal(home, {
      kind: "missing-category",
      target: "general",
      reason: "trois sessions dans la categorie de repli",
      evidence: { sessions: 3 },
      patch: null,
      test: "revue",
      rollback: "aucun ecrit",
      requires: ["validation humaine"],
    });
    const result = applyProposal(home, proposal.id);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /decision humaine/);
    assert.equal(readProposal(home, proposal.id)!.status, "proposed", "un refus ne ferme pas la proposition");
  });

  test("un fichier hors categories.json est refuse", () => {
    const home = makeHome();
    const { proposal } = writeProposal(home, {
      kind: "unused-skill",
      target: "x",
      reason: "proposition forgee pour tester le garde-fou de fichier",
      evidence: {},
      patch: { file: "src/gate.ts", category: "code", step: "implement", skill: "x" },
      test: "structurel",
      rollback: "-",
      requires: [],
    });
    const result = applyProposal(home, proposal.id);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /fichier non supporte/);
  });

  test("un skill deja absent ne provoque pas d'ecriture", () => {
    const { home, id } = setup();
    const path = join(home, "catalog", "categories.json");
    const doc = JSON.parse(readFileSync(path, "utf8"));
    doc[1].roadmap.steps[0].requireSkills = ["novahiz-converge"];
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");

    const result = applyProposal(home, id);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /n'est plus requis/);
    assert.equal(listBackups(home).length, 0, "aucune sauvegarde pour une application qui n'a pas commence");
  });
});
