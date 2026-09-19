import { join } from "node:path";
import { asString, dbPathFor, parse, print, readStdin, splitList, type Parsed } from "./context.ts";
import { loadSpec, skillenforceHome } from "../spec.ts";
import { openDb } from "../db.ts";
import { loadInstalledSkills } from "../catalog.ts";
import { changeText } from "../content.ts";
import { evaluateGate } from "../gate.ts";
import { extractTargetPaths } from "../targets.ts";
import { activeTask, recordEdit, reviewDue, traceCheck } from "../ledger.ts";
import { autoCommit } from "../graft.ts";

export function commandGate(parsed: Parsed): void {
  const root = skillenforceHome();
  let spec;
  try {
    spec = loadSpec(root);
  } catch (error) {
    // C-Gate: fail-closed when spec is corrupt — returning allow:true is a
    // security boundary violation. Structured JSON on stderr for callers that
    // need to distinguish corruption from normal block.
    const msg = `loadSpec failed: ${String(error).slice(0, 200)}`;
    process.stderr.write(`Skillenforce: ${msg}\n`);
    print({ allow: false, error: msg, tool: asString(parsed.flags.tool) || "edit", missingSkills: [], reasons: [msg] });
    process.exitCode = 2;
    return;
  }
  const gateConfig = spec.config.gate;
  const tool = asString(parsed.flags.tool) || "edit";
  const categories = splitList(parsed.flags.categories);
  let loaded = splitList(parsed.flags.loaded);
  const session = asString(parsed.flags.session);
  if (loaded.length === 0 && session.length > 0) {
    let db: ReturnType<typeof openDb> | null = null;
    try {
      db = openDb(dbPathFor(root, spec));
      const rows = db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(session) as { skill: string }[];
      loaded = rows.map((row) => row.skill);
    } catch (error) {
      process.stderr.write(`Skillenforce: session DB open failed: ${String(error).slice(0, 200)}\n`);
      print({ allow: false, error: `session DB error`, tool, missingSkills: [], reasons: [`session DB open failed`] });
      process.exitCode = 2;
      return;
    } finally {
      db?.close();
    }
  }

  if (gateConfig.enabled === false) {
    print({ allow: true, disabled: true, tool });
    return;
  }
  const escapeValue = (process.env[gateConfig.envEscape] || "").toLowerCase();
  if (["off", "0", "false", "no", "disabled"].includes(escapeValue)) {
    print({ allow: true, disabled: true });
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
        process.stderr.write("Skillenforce: invalid JSON on stdin for --args-stdin\n");
        process.exitCode = 1;
        return;
      }
    }
    paths = extractTargetPaths(tool, args);
    if (content.length === 0) content = changeText(tool, args);
  } else {
    process.stderr.write("Skillenforce: gate requires --file <path> or --args-stdin\n");
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
  const requiredSkills = [...new Set(results.flatMap((entry) => entry.requiredSkills))];
  const missingSkills = [...new Set(results.flatMap((entry) => entry.missingSkills))];
  const unmatchedRequired = [...new Set(results.flatMap((entry) => entry.unmatchedRequired))];
  const indexMissing = results.some((entry) => entry.indexMissing);

  // H4: single DB connection for trace, ledger checks, AND enforcement logging
  let db: ReturnType<typeof openDb> | null = null;
  try {
    db = openDb(dbPathFor(root, spec));
  } catch (error) {
    process.stderr.write(`Skillenforce: DB open failed: ${String(error).slice(0, 200)}\n`);
    print({ allow: false, error: `DB open failed`, tool, missingSkills: [], reasons: [`DB open failed`] });
    process.exitCode = 2;
    return;
  }
  try {
    const traceConfig = gateConfig.trace;
    const traceRequired =
      traceConfig?.enabled === true &&
      session.length > 0 &&
      categories.some((category) => traceConfig.categories.includes(category));
    if (traceRequired) {
      for (const entry of results) {
        const trace = traceCheck(db, { sessionId: session, filePath: entry.path, required: true });
        if (!trace.ok) {
          entry.allow = false;
          reasons.push(trace.reason);
        }
      }
    }

    const ledgerConfig = spec.config.ledger;
    if (ledgerConfig?.enabled !== false) {
      const task = activeTask(db, session || undefined);
      if (task) {
        if (["edit", "write", "patch", "apply_patch"].includes(tool)) recordEdit(db, task.id);
        const due = reviewDue(db, task.id, ledgerConfig.review);
        if (due.due) {
          for (const entry of results) entry.allow = false;
          reasons.push(due.reason);
        }
      }
    }

    const currentAllow = results.every((entry) => entry.allow);
    if (session.length > 0) {
      db.prepare(
        "INSERT INTO enforcement_log (session_id, tool, file_path, file_class, decision, missing, matched_rules, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        session,
        tool,
        paths.join(","),
        results[0]?.fileClass ?? "other",
        currentAllow ? "allow" : gateConfig.mode === "block" ? "block" : gateConfig.mode,
        JSON.stringify(missingSkills),
        JSON.stringify(results.flatMap((entry) => entry.matchedRules)),
        new Date().toISOString()
      );
      try {
        autoCommit("enforcement", `${currentAllow ? "allow" : "block"} ${tool}`);
      } catch {
        // autoCommit failures are non-critical; the enforcement is logged regardless
      }
    }
  } finally {
    db?.close();
  }

  const warnings: string[] = [];
  if (unmatchedRequired.length > 0) {
    warnings.push(
      `required skills missing from index, therefore not applied: ` + unmatchedRequired.join(", ") + `. Restart skillenforce sync to realign the index.`
    );
  }
  if (indexMissing) {
    warnings.push("skills index unreadable: all required skills are enforced.");
  }

  const allow = results.every((entry) => entry.allow);
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

