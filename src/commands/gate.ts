import { join } from "node:path";
import { asString, dbPathFor, parse, print, readStdin, splitList, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import { loadInstalledSkills } from "../catalog.ts";
import { changeText } from "../content.ts";
import { enforceLedgerChecks, evaluateGate } from "../gate.ts";
import { extractTargetPaths } from "../targets.ts";

export function commandGate(parsed: Parsed): void {
  const root = NovahizHome();
  let spec;
  try {
    spec = loadSpec(root);
  } catch (error) {
    // C-Gate: fail-closed when spec is corrupt — returning allow:true is a
    // security boundary violation. Structured JSON on stderr for callers that
    // need to distinguish corruption from normal block.
    const msg = `loadSpec failed: ${String(error).slice(0, 200)}`;
    process.stderr.write(`novahiz: ${msg}\n`);
    print({ allow: false, error: msg, tool: asString(parsed.flags.tool) || "edit", missingSkills: [], reasons: [msg] });
    process.exitCode = 2;
    return;
  }
  const gateConfig = spec.config.gate;
  // MINEUR#5: normalize case — the plugin lowercases tool names (adapters
  // novahiz.ts), so a case-sensitive check here would treat "EDIT" as
  // un-gated and silently allow the call.
  const tool = (asString(parsed.flags.tool) || "edit").toLowerCase();
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
      process.stderr.write(`novahiz: session DB open failed: ${String(error).slice(0, 200)}\n`);
      print({ allow: false, error: `session DB error`, tool, missingSkills: [], reasons: [`session DB open failed`] });
      process.exitCode = 2;
      return;
    } finally {
      db?.close();
    }
  }

  // C2: a project-writable config must not silently switch enforcement off.
  // enabled:false is ignored on purpose; the only kill-switch is the external
  // env var NOVAHIZ_GATE (same philosophy as the hardcoded envEscape, H3/C5).
  if (gateConfig.enabled === false) {
    process.stderr.write(
      'novahiz: gate.enabled=false in novahiz.config.json is ignored; enforcement stays active. Use NOVAHIZ_GATE=off to disable the gate.\n'
    );
  }
  // H3: always use NOVAHIZ_GATE (legacy: NOVAHIZ_GATE) — ignore configurable
  // envEscape to prevent a writable config from redirecting the kill-switch.
  const escapeValue = (process.env.NOVAHIZ_GATE || "").toLowerCase();
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
  // C1: the prompt that triggered the edit drives the complexity tier.
  const prompt = asString(parsed.flags.prompt);
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
        process.stderr.write("novahiz: invalid JSON on stdin for --args-stdin\n");
        process.exitCode = 1;
        return;
      }
    }
    paths = extractTargetPaths(tool, args);
    if (content.length === 0) content = changeText(tool, args);
  } else {
    process.stderr.write("novahiz: gate requires --file <path> or --args-stdin\n");
    process.exitCode = 1;
    return;
  }

  const pathless = paths.length === 0;
  if (pathless) {
    const writeTools = ["edit", "write", "patch", "apply_patch"];
    if (writeTools.includes(tool)) {
      // MINEUR#6: warn/audit never exit non-zero — report the pass with a
      // wouldBlock marker instead of a contradictory allow:false + exit 0.
      const enforced = gateConfig.mode === "block";
      print({
        allow: !enforced,
        ...(enforced ? {} : { wouldBlock: true }),
        tool,
        targets: [],
        requiredSkills: [],
        missingSkills: [],
        reasons: ["no target path for a write tool"]
      });
      if (enforced) process.exitCode = 2;
      return;
    }
    // MAJEUR l.135: bash/shell/cron with no target path no longer pass
    // unconditionally — they fall through to a pathless evaluation so
    // prompt-scoped rules (supabase, browser, security, ...) still apply
    // to commands like `python -e`, `curl -o` or `git apply`.
  }

  const index = loadInstalledSkills(spec);
  const evalInput = {
    tool,
    content,
    prompt,
    categories,
    loadedSkills: loaded,
    installedSkills: index.skills,
    installedIndexAvailable: index.available,
    spec
  };
  const results = pathless
    ? [{ path: "", ...evaluateGate({ ...evalInput, filePath: "", pathless: true }) }]
    : paths.map((filePath) => ({ path: filePath, ...evaluateGate({ ...evalInput, filePath }) }));

  const reasons: string[] = [];
  let reviewWarning = "";
  const requiredSkills = [...new Set(results.flatMap((entry) => entry.requiredSkills))];
  const missingSkills = [...new Set(results.flatMap((entry) => entry.missingSkills))];
  const unmatchedRequired = [...new Set(results.flatMap((entry) => entry.unmatchedRequired))];
  const indexMissing = results.some((entry) => entry.indexMissing);

  // H4: single DB connection for trace, ledger checks, AND enforcement logging
  let db: ReturnType<typeof openDb> | null = null;
  let dbFailure = "";
  try {
    db = openDb(dbPathFor(root, spec));
  } catch (error) {
    dbFailure = String(error).slice(0, 200);
    process.stderr.write(`novahiz: DB open failed: ${dbFailure}\n`);
    if (gateConfig.mode === "block") {
      // block mode keeps fail-closed behaviour: no enforcement trace, no edits.
      print({ allow: false, error: `DB open failed`, tool, missingSkills: [], reasons: [`DB open failed`] });
      process.exitCode = 2;
      return;
    }
    // MINEUR#7: warn/audit are advisory — degrade gracefully instead of
    // locking every gated tool out; ledger checks are skipped and reported.
  }
  try {
    if (db) {
      // Shared with the MCP novahiz_gate tool (src/gate.ts enforceLedgerChecks)
      // so the two entry points enforce trace + ledger + the log identically.
      const enforced = enforceLedgerChecks(db, { session, tool, paths, categories, results, spec, gateConfig });
      reasons.push(...enforced.reasons);
      reviewWarning = enforced.reviewWarning;
    }
  } finally {
    db?.close();
  }

  const warnings: string[] = [];
  if (dbFailure.length > 0 && gateConfig.mode !== "block") {
    warnings.push(`enforcement trace unavailable (DB open failed): continuing without ledger checks in ${gateConfig.mode} mode.`);
  }
  if (reviewWarning.length > 0) warnings.push(reviewWarning);
  if (unmatchedRequired.length > 0) {
    warnings.push(
      `required skills missing from index, therefore not applied: ` + unmatchedRequired.join(", ") + `. Restart novahiz sync to realign the index.`
    );
  }
  if (indexMissing) {
    warnings.push("skills index unreadable: all required skills are enforced.");
  }

  const blocked = results.some((entry) => !entry.allow);
  const enforced = gateConfig.mode === "block";
  // MINEUR#6: allow mirrors the exit contract — warn/audit never block, so a
  // failing evaluation is reported as allow:true + wouldBlock:true (exit 0)
  // instead of a contradictory allow:false + exit 0.
  const allow = !blocked || !enforced;
  print({
    allow,
    ...(blocked && !enforced ? { wouldBlock: true } : {}),
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
      tier: entry.tier,
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

