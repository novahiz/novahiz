import { join } from "node:path";
import { asString, dbPathFor, parse, readStdin, splitList, type Parsed } from "./context.ts";
import { loadSpec, novahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import { classify } from "../classify.ts";
import { changeText } from "../content.ts";
import { claudeDenyOutput, decideHook, missingMessage, normalizeTool, unmatchedMessage, type Harness } from "../hook.ts";
import { extractTargetPaths } from "../targets.ts";

export function commandHook(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const harness = (asString(parsed.flags.harness) || "claude") as Harness;
  const event = asString(parsed.flags.event) || "PreToolUse";
  const raw = readStdin().trim();
  let payload: Record<string, unknown> = {};
  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
  }

  const gateConfig = spec.config.gate;
  if (gateConfig.enabled === false) return;
  const escapeValue = (process.env[gateConfig.envEscape] || "").toLowerCase();
  if (["off", "0", "false", "no", "disabled"].includes(escapeValue)) return;

  const rawSession = payload.session_id ?? payload.sessionId;
  const hasSession = rawSession !== undefined && rawSession !== null && String(rawSession).length > 0;
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

  const db = openDb(dbPathFor(root, spec));
  const loadedRows = db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(sessionId) as {
    skill: string;
  }[];
  const loadedSkills = loadedRows.map((row) => row.skill);
  const decision = decideHook(spec, harness, toolName, toolInput, { loadedSkills, categories });

  if (decision.kind === "skill") {
    db.prepare("INSERT OR IGNORE INTO skill_invocations (session_id, skill, invoked_at) VALUES (?, ?, ?)").run(
      sessionId,
      decision.skill,
      new Date().toISOString()
    );
    db.close();
    return;
  }
  if (decision.kind === "pass") {
    db.close();
    return;
  }

  const mode = spec.config.gate.mode;
  const block = decision.block && mode === "block";
  db.prepare(
    "INSERT INTO enforcement_log (session_id, tool, file_path, file_class, decision, missing, matched_rules, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    sessionId,
    decision.tool,
    decision.paths.join(","),
    decision.results[0]?.fileClass ?? "other",
    block ? "block" : mode,
    JSON.stringify(decision.missing),
    JSON.stringify(decision.results.flatMap((entry) => entry.matchedRules)),
    new Date().toISOString()
  );
  db.close();

  if (decision.unmatched.length > 0) process.stderr.write(`${unmatchedMessage(decision)}\n`);

  if (harness === "claude" && event === "PreToolUse") {
    if (block) process.stdout.write(`${claudeDenyOutput(missingMessage(decision))}\n`);
    return;
  }
  if (decision.block) process.stdout.write(`Novahiz advisory: ${missingMessage(decision)}\n`);
}

