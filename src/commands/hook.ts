import { asString, dbPathFor, readStdin, splitList, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome, type Spec } from "../spec.ts";
import { openDb } from "../db.ts";
import { classify } from "../classify.ts";
import { changeText } from "../content.ts";
import { enforceLedgerChecks } from "../gate.ts";
import { buildRepairDirective, type GateFailure } from "../gate-repair.ts";
import { loadInstalledSkills } from "../catalog.ts";
import {
  claudeDenyOutput,
  decideHook,
  missingMessage,
  normalizeTool,
  unmatchedMessage,
  type Harness
} from "../hook.ts";
import { extractTargetPaths } from "../targets.ts";

type Db = ReturnType<typeof openDb>;

// Fail-closed emission: a Claude PreToolUse denial is a structured deny
// payload; every other harness/event only ever gets an advisory line (Codex
// still receives an advisory verdict, not a block — see docs/HARNESSES.md).
function emitDeny(harness: Harness, event: string, reason: string): void {
  if (harness === "claude" && event === "PreToolUse") {
    process.stdout.write(`${claudeDenyOutput(reason)}\n`);
    return;
  }
  process.stdout.write(`Novahiz advisory: ${reason}\n`);
}

// AUTO-REPAIR attempt tracking: how many consecutive denials for this
// session+tool since the last allow. attempt 1 = first block (repair
// directive), attempt 2+ = loads did not register (escalation). Computed
// BEFORE enforceLedgerChecks logs the current row.
function repairAttempt(db: Db, session: string, tool: string): number {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM enforcement_log
         WHERE session_id = ? AND tool = ? AND decision = 'block'
           AND id > COALESCE((SELECT MAX(id) FROM enforcement_log
                              WHERE session_id = ? AND tool = ? AND decision = 'allow'), 0)`
      )
      .get(session, tool, session, tool) as { n?: number } | undefined;
    return (row?.n ?? 0) + 1;
  } catch {
    return 1;
  }
}

// P0-B parity with `novahiz session-load`: only well-formed skill names that
// exist in the installed index count as loaded. An unreadable index cannot
// verify anything — accept the record (the gate degrades via indexMissing).
// Unlike session-load, the hook never rejects with an error: it notes on
// stderr and continues, because a load signal is only ever an aid.
function recordSkillLoad(spec: Spec, db: Db, session: string, skill: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(skill)) {
    process.stderr.write(`novahiz: invalid skill name format: "${skill.slice(0, 64)}" — load not recorded.\n`);
    return;
  }
  try {
    const installed = loadInstalledSkills(spec);
    if (installed.available && !installed.skills.has(skill)) {
      process.stderr.write(
        `novahiz: unknown skill "${skill}" — not in the installed index; run "novahiz sync" to realign it.\n`
      );
      return;
    }
  } catch {
    // index unreadable → accept the record, matching session-load (P0-B)
  }
  const ts = new Date().toISOString();
  // H5: ensure the session row exists for the skill_invocations FK
  db.prepare("INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(
    session,
    ts
  );
  db.prepare("INSERT OR IGNORE INTO skill_invocations (session_id, skill, invoked_at) VALUES (?, ?, ?)").run(
    session,
    skill,
    new Date().toISOString()
  );
}

export function commandHook(parsed: Parsed): void {
  const harness = (asString(parsed.flags.harness) || "claude") as Harness;
  const event = asString(parsed.flags.event) || "PreToolUse";
  const root = NovahizHome();

  const raw = readStdin().trim();
  let payload: Record<string, unknown> = {};
  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Fail-closed: a payload that cannot be evaluated must not silently allow.
      emitDeny(harness, event, "Novahiz gate: malformed JSON payload on stdin — fail-closed.");
      return;
    }
  }

  let spec: ReturnType<typeof loadSpec>;
  try {
    spec = loadSpec(root);
  } catch (error) {
    // C-Gate parity: a corrupt spec must never grant the call.
    const msg = `loadSpec failed: ${String(error).slice(0, 200)}`;
    process.stderr.write(`novahiz: ${msg}\n`);
    emitDeny(harness, event, `Novahiz gate: ${msg}`);
    return;
  }

  const gateConfig = spec.config.gate;
  // C2 parity: a project-writable config must not silently switch enforcement
  // off. enabled:false is warned about and ignored.
  if (gateConfig.enabled === false) {
    process.stderr.write(
      'novahiz: gate.enabled=false in novahiz.config.json is ignored; enforcement stays active. Use NOVAHIZ_GATE=off to disable the gate.\n'
    );
  }
  // H3 parity: the kill-switch is the hardcoded NOVAHIZ_GATE env var; the
  // configurable envEscape field is deliberately ignored.
  const escapeValue = (process.env.NOVAHIZ_GATE || "").toLowerCase();
  if (["off", "0", "false", "no", "disabled"].includes(escapeValue)) return;

  const rawSession = payload.session_id ?? payload.sessionId;
  const hasSession = rawSession !== undefined && rawSession !== null && String(rawSession).length > 0;
  // H6 note: unlike session-load, the fallback `cwd:...` id cannot satisfy the
  // session-id regex — no format validation here, the id is never re-parsed.
  const sessionId = hasSession ? String(rawSession) : `cwd:${process.cwd()}`;
  const toolName = String(payload.tool_name ?? payload.toolName ?? "");
  const toolInput = payload.tool_input ?? payload.toolInput ?? {};

  const tool = normalizeTool(harness, toolName);
  let categories = splitList(parsed.flags.categories);
  if (categories.length === 0) {
    const text = `${extractTargetPaths(tool, toolInput).join(" ")} ${changeText(tool, toolInput)}`.trim();
    if (text.length > 0) categories = classify(spec, text).categories.map((entry) => entry.id);
  }

  if (event === "Stop") {
    if (!hasSession) return;
    let stepsDone: string[] = [];
    try {
      const stopDb = openDb(dbPathFor(root, spec));
      stepsDone = (
        stopDb.prepare("SELECT step_id FROM roadmap_progress WHERE session_id = ?").all(sessionId) as { step_id: string }[]
      ).map((row) => row.step_id);
      stopDb.close();
    } catch {
      stepsDone = [];
    }
    process.stdout.write(
      `Novahiz: roadmap steps done${stepsDone.length > 0 ? ` (${stepsDone.join(", ")})` : ""}: ${stepsDone.length}\n`
    );
    return;
  }

  // H4 parity: a single DB connection for the skill loads, trace, ledger
  // checks and the enforcement log.
  let db: Db | null = null;
  let dbFailure = "";
  try {
    db = openDb(dbPathFor(root, spec));
  } catch (error) {
    dbFailure = String(error).slice(0, 200);
    process.stderr.write(`novahiz: DB open failed: ${dbFailure}\n`);
    if (gateConfig.mode === "block") {
      emitDeny(harness, event, "Novahiz gate: DB open failed — fail-closed.");
      return;
    }
    // MINEUR#7: warn/audit are advisory — continue without ledger checks.
  }

  const loadedSkills = db
    ? (
        db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(sessionId) as { skill: string }[]
      ).map((row) => row.skill)
    : [];
  const decision = decideHook(spec, harness, toolName, toolInput, { loadedSkills, categories });

  if (decision.kind === "skill") {
    if (db) recordSkillLoad(spec, db, sessionId, decision.skill);
    db?.close();
    return;
  }
  if (decision.kind === "pass") {
    db?.close();
    return;
  }

  let attempt = 1;
  let enforced: { reasons: string[]; reviewWarning: string } = { reasons: [], reviewWarning: "" };
  if (db) {
    attempt = repairAttempt(db, sessionId, decision.tool);
    enforced = enforceLedgerChecks(db, {
      session: sessionId,
      tool: decision.tool,
      paths: decision.paths,
      categories,
      results: decision.results,
      spec,
      gateConfig
    });
    db.close();
  }

  // The block is computed AFTER enforceLedgerChecks: trace/ledger checks may
  // have flipped results[].allow, exactly like `novahiz gate` does it.
  const blocked = decision.results.some((entry) => !entry.allow);
  const block = blocked && gateConfig.mode === "block";

  if (dbFailure.length > 0 && gateConfig.mode !== "block") {
    process.stderr.write(
      `novahiz: enforcement trace unavailable (DB open failed): continuing without ledger checks in ${gateConfig.mode} mode.\n`
    );
  }
  if (enforced.reviewWarning.length > 0) process.stderr.write(`novahiz: ${enforced.reviewWarning}\n`);
  if (decision.unmatched.length > 0) process.stderr.write(`${unmatchedMessage(decision)}\n`);
  if (decision.results.some((entry) => entry.indexMissing)) {
    process.stderr.write("novahiz: skills index unreadable: all required skills are enforced.\n");
  }

  if (harness === "claude" && event === "PreToolUse") {
    if (block) {
      const failure: GateFailure = {
        tool: decision.tool,
        missingSkills: decision.missing,
        reasons: [...new Set([...decision.results.flatMap((entry) => entry.reasons), ...enforced.reasons])],
        error: null
      };
      process.stdout.write(`${claudeDenyOutput(buildRepairDirective(failure, attempt))}\n`);
    }
    return;
  }
  if (blocked) process.stdout.write(`Novahiz advisory: ${missingMessage(decision)}\n`);
}
