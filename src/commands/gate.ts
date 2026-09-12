import { join } from "node:path";
import { asString, dbPathFor, parse, print, readStdin, splitList, type Parsed } from "./context.ts";
import { loadSpec, novahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import { loadInstalledSkills } from "../catalog.ts";
import { changeText } from "../content.ts";
import { evaluateGate } from "../gate.ts";
import { extractTargetPaths } from "../targets.ts";
import { activeTask, recordEdit, reviewDue, traceCheck } from "../ledger.ts";

export function commandGate(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const gateConfig = spec.config.gate;
  const tool = asString(parsed.flags.tool) || "edit";
  const categories = splitList(parsed.flags.categories);
  let loaded = splitList(parsed.flags.loaded);
  const session = asString(parsed.flags.session);
  if (loaded.length === 0 && session.length > 0) {
    const db = openDb(dbPathFor(root, spec));
    const rows = db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(session) as { skill: string }[];
    db.close();
    loaded = rows.map((row) => row.skill);
  }

  if (gateConfig.enabled === false) {
    print({ allow: true, disabled: true, tool });
    return;
  }
  const escapeValue = (process.env[gateConfig.envEscape] || "").toLowerCase();
  if (["off", "0", "false", "no", "disabled"].includes(escapeValue)) {
    print({ allow: true, disabled: true, reason: `${gateConfig.envEscape} set`, tool });
    return;
  }

  const gated = gateConfig.tools.includes(tool);
  if (!gated) {
    print({ allow: true, tool, reason: "tool is not gated" });
    return;
  }

  const single = asString(parsed.flags.file);
  let content = asString(parsed.flags.content);
  let paths: string[];
  if (single.length > 0) {
    paths = [single];
  } else if (parsed.flags["args-stdin"]) {
    let args: unknown = {};
    const raw = readStdin().trim();
    if (raw.length > 0) {
      try {
        args = JSON.parse(raw);
      } catch {
        process.stderr.write("Novahiz: invalid JSON on stdin for --args-stdin\n");
        process.exitCode = 1;
        return;
      }
    }
    paths = extractTargetPaths(tool, args);
    if (content.length === 0) content = changeText(tool, args);
  } else {
    process.stderr.write("Novahiz: gate requires --file <path> or --args-stdin\n");
    process.exitCode = 1;
    return;
  }

  if (paths.length === 0) {
    const writeTools = ["edit", "write", "patch", "apply_patch"];
    if (writeTools.includes(tool)) {
      print({
        allow: false,
        tool,
        targets: [],
        requiredSkills: [],
        missingSkills: [],
        reasons: ["no target path for a write tool"]
      });
      if (gateConfig.mode === "block") process.exitCode = 2;
      return;
    }
    print({ allow: true, tool, targets: [], requiredSkills: [], missingSkills: [], reason: "no target path" });
    return;
  }

  const index = loadInstalledSkills(spec);
  const results = paths.map((filePath) => ({
    path: filePath,
    ...evaluateGate({
      tool,
      filePath,
      content,
      categories,
      loadedSkills: loaded,
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec
    })
  }));

  const reasons: string[] = [];
  const traceConfig = gateConfig.trace;
  const traceRequired =
    traceConfig?.enabled === true &&
    session.length > 0 &&
    categories.some((category) => traceConfig.categories.includes(category));
  if (traceRequired) {
    const db = openDb(dbPathFor(root, spec));
    for (const entry of results) {
      const trace = traceCheck(db, { sessionId: session, filePath: entry.path, required: true });
      if (!trace.ok) {
        entry.allow = false;
        reasons.push(trace.reason);
      }
    }
    db.close();
  }

  const ledgerConfig = spec.config.ledger;
  if (ledgerConfig?.enabled !== false) {
    const db = openDb(dbPathFor(root, spec));
    const task = activeTask(db, session || undefined);
    if (task) {
      if (["edit", "write", "patch", "apply_patch"].includes(tool)) recordEdit(db, task.id);
      const due = reviewDue(db, task.id, ledgerConfig.review);
      if (due.due) {
        for (const entry of results) entry.allow = false;
        reasons.push(due.reason);
      }
    }
    db.close();
  }

  const allow = results.every((entry) => entry.allow);
  const requiredSkills = [...new Set(results.flatMap((entry) => entry.requiredSkills))];
  const missingSkills = [...new Set(results.flatMap((entry) => entry.missingSkills))];
  const unmatchedRequired = [...new Set(results.flatMap((entry) => entry.unmatchedRequired))];
  const indexMissing = results.some((entry) => entry.indexMissing);

  const warnings: string[] = [];
  if (unmatchedRequired.length > 0) {
    warnings.push(
      `skills requises absentes de l'index, donc non appliquees : ${unmatchedRequired.join(", ")}. Relance novahiz sync pour realigner l'index.`
    );
  }
  if (indexMissing) {
    warnings.push("index des skills illisible : toutes les skills requises sont exigees.");
  }

  if (session.length > 0) {
    const db = openDb(dbPathFor(root, spec));
    db.prepare(
      "INSERT INTO enforcement_log (session_id, tool, file_path, file_class, decision, missing, matched_rules, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      session,
      tool,
      paths.join(","),
      results[0]?.fileClass ?? "other",
      allow ? "allow" : gateConfig.mode === "block" ? "block" : gateConfig.mode,
      JSON.stringify(missingSkills),
      JSON.stringify(results.flatMap((entry) => entry.matchedRules)),
      new Date().toISOString()
    );
    db.close();
  }

  print({
    allow,
    tool,
    mode: gateConfig.mode,
    indexMissing,
    requiredSkills,
    missingSkills,
    unmatchedRequired,
    warnings,
    reasons,
    targets: results.map((entry) => ({
      path: entry.path,
      fileClass: entry.fileClass,
      ignored: entry.ignored,
      roadmap: entry.roadmap,
      requiredSkills: entry.requiredSkills,
      missingSkills: entry.missingSkills,
      unmatchedRequired: entry.unmatchedRequired,
      placeholder: entry.placeholder,
      reasons: entry.reasons,
      matchedRules: entry.matchedRules
    }))
  });

  if (!allow && gateConfig.mode === "block") process.exitCode = 2;
}

