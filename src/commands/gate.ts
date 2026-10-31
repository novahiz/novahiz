import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { asString, dbPathFor, parse, print, readStdin, splitList, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { seedForClassification } from "../seed.ts";
import { openDb } from "../db.ts";
import { loadInstalledSkills } from "../catalog.ts";
import { changeText } from "../content.ts";
import { classify } from "../classify.ts";
import { enforceLedgerChecks, evaluateGate, mergeTargetReasons } from "../gate.ts";
import { extractTargetPaths } from "../targets.ts";
import { isReadOnlyCommand } from "../readonly.ts";
import { isValidSessionId, readSessionClassification } from "../session.ts";
import { recordProjectSession, isProjectRoot, projectRootForPath } from "../sessions.ts";

/**
 * Paths whose prose describes work rather than being the work.
 *
 * The rule itself lives in `src/seed.ts`: the MCP gate server asks the same
 * question, and two copies drifted apart once already (the CLI was fixed while
 * the tool kept the old behaviour).
 */
export { isDocumentationPath, seedForClassification } from "../seed.ts";

export function commandGate(parsed: Parsed): void {  const root = NovahizHome();
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
  // MINEUR#5: normalize case — the plugin passes event.tool as-is on --tool
  // (adapters opencode/novahiz-plugin.ts lowercases only for its own in-memory
  // check), so a case-sensitive check here would treat "EDIT" as un-gated and
  // silently allow the call.
  const tool = (asString(parsed.flags.tool) || "edit").toLowerCase();
  let categories = splitList(parsed.flags.categories);
  let loaded = splitList(parsed.flags.loaded);
  const session = asString(parsed.flags.session);
  // Union, not fallback: skills recorded in the DB (previous plugin run,
  // resumed session, explicit session-load) stay visible even when the
  // in-memory --loaded list is partially filled after a hot reload — a
  // non-empty in-memory list must never hide durable rows.
  if (session.length > 0) {
    let db: ReturnType<typeof openDb> | null = null;
    try {
      db = openDb(dbPathFor(root, spec));
      const rows = db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(session) as { skill: string }[];
      const merged = new Set(loaded);
      for (const row of rows) merged.add(row.skill);
      loaded = [...merged];
    } catch (error) {
      // A-DB-SOFT (2026-09-13): this read only WIDENS the in-memory `loaded` set
      // with skills recorded by earlier sessions; it never removes one. Opened
      // here and again on the main path, both fail together (openDb
      // materialises the schema), so this never lets an edit through that the
      // DB-open check below would refuse: measured 2026-10-14 against HEAD, both
      // paths return allow:false and exit 2 on an unusable ledger. Falling
      // through keeps the accurate "DB open failed" reason instead of blaming
      // the session, and skips a second openDb for a set the main path
      // rebuilds anyway.
      process.stderr.write(`novahiz: session DB read skipped: ${String(error).slice(0, 200)}\n`);
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

  // Audit 2026-09-25 (P1-1): the plugin passes its frozen GATE_TOOLS snapshot
  // via --tools, so a live edit of gate.tools in novahiz.config.json cannot
  // weaken enforcement before the required opencode restart. Standalone CLI
  // calls (no flag) still fall back to the config file.
  const toolsFlag = splitList(parsed.flags.tools).map((entry) => entry.toLowerCase());
  const gated = (toolsFlag.length > 0 ? toolsFlag : gateConfig.tools).includes(tool);
  if (!gated) {
    print({ allow: true, tool, reason: "tool is not gated" });
    return;
  }

  const single = asString(parsed.flags.file);
  let content = asString(parsed.flags.content);
  // C1: the prompt that triggered the edit drives the complexity tier.
  let prompt = asString(parsed.flags.prompt);
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
    // P0: a read-only shell command (status/log/diff/ls/...) is not an edit.
    // It is exempted before any prompt rule, category or ledger check runs —
    // the gate's job is to guard writes, not to make `git status` cost five
    // skill loads. Unrecognised or chained commands fall through unchanged.
    if ((tool === "bash" || tool === "shell") && args !== null && typeof args === "object") {
      const record = args as Record<string, unknown>;
      const command =
        typeof record.command === "string" ? record.command : typeof record.cmd === "string" ? record.cmd : "";
      if (isReadOnlyCommand(command)) {
        print({ allow: true, tool, readonly: true, reason: "read-only shell command" });
        return;
      }
    }
    paths = extractTargetPaths(tool, args);
    if (content.length === 0) content = changeText(tool, args);

    // P0.2: NOVAHIZ_GATE_REPAIR permet de faire exécuter les commandes de
    // réparation du gate (sync, install, doctor, status) même quand le gate
    // est verrouillé par des skills manquantes. Ce contournement ne s'applique
    // qu'aux commandes meta novahiz, jamais à l'édition de fichiers utilisateur.
    const gateRepair = (process.env.NOVAHIZ_GATE_REPAIR || "").toLowerCase();
    if (["1", "true", "yes", "on"].includes(gateRepair) && (tool === "shell" || tool === "bash")) {
      const isNovahizMeta = /^novahiz\s+(sync|install|doctor|status|gate)\b/.test(content.trim());
      if (isNovahizMeta) {
        print({ allow: true, tool, readonly: true, reason: "NOVAHIZ_GATE_REPAIR: commande de réparation du gate autorisée" });
        return;
      }
    }
  } else {
    process.stderr.write("novahiz: gate requires --file <path> or --args-stdin\n");
    process.exitCode = 1;
    return;
  }

  // P0: after a plugin restart the in-memory categories are gone and the
  // caller sends neither categories nor prompt. Read the last non-trivial
  // classification back from the session instead of classifying an empty seed
  // into general/trivial — which allowed every edit with missing: [].
  if (categories.length === 0 && prompt.length === 0 && session.length > 0 && isValidSessionId(session)) {
    let stateDb: ReturnType<typeof openDb> | null = null;
    try {
      stateDb = openDb(dbPathFor(root, spec));
      const state = readSessionClassification(stateDb, session);
      if (state) {
        categories = state.categories;
        prompt = state.prompt;
      }
    } catch (error) {
      process.stderr.write(`novahiz: session state read skipped: ${String(error).slice(0, 200)}\n`);
    } finally {
      stateDb?.close();
    }
  }

  // Audit 2026-09-25 (P1-3): empty categories no longer fall through to an
  // unscoped evaluation — the CLI classifies the seed itself (same contract as
  // the MCP gate) and fails closed only when classification itself is broken.
  //
  // Measured 2026-10-29: a one-line edit to novahiz/CHANGELOG.md demanded 11
  // design skills (R8 + R11 + R13 + R14 + R17) because the *content* of the
  // changelog was used as the classification seed, and that changelog talks
  // about design skills. Documentation describes work; it is not the task. For
  // a documentation path the seed is therefore the prompt or nothing, never the
  // prose, and the path-based rules (R8-docs) still apply.
  if (categories.length === 0) {
    const seed = seedForClassification({ prompt, content, paths });
    if (seed.length > 0) {
      try {
        categories = classify(spec, seed).categories.map((entry) => entry.id);
      } catch (error) {
        const msg = `classify failed: ${String(error).slice(0, 200)}`;
        process.stderr.write(`novahiz: ${msg}\n`);
        print({ allow: false, error: msg, tool, missingSkills: [], reasons: [msg] });
        process.exitCode = 2;
        return;
      }
    }
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
      // NX-42: the shell command itself goes in, because a migration command
      // carries no path for the claim check to see.
      const gateProjectRoot =
        paths.length > 0 ? projectRootForPath(paths[0]) : isProjectRoot(process.cwd()) ? process.cwd() : null;
      const enforced = enforceLedgerChecks(db, {
        session,
        tool,
        paths,
        categories,
        results,
        spec,
        gateConfig,
        command: content,
        projectRoot: gateProjectRoot
      });
      reasons.push(...enforced.reasons);
      reviewWarning = enforced.reviewWarning;

      // Where the gate always runs, the project must learn its session exists.
      // The MCP server recorded it, but the plugin path (the normal one) goes
      // through this command, never through that server: measured on
      // 2026-10-29, `project_sessions` was empty for a project with live
      // sessions, so `resume`, `otherSessions` and `defaultSessionForProject`
      // all read "no session". Recording is best effort and never decides a
      // verdict.
      if (isValidSessionId(session)) {
        try {
          // The edited path names the project; the daemon's cwd does not. A
          // pathless call (a shell command) has no project to attach to, so
          // nothing is recorded rather than a parent directory invented as one.
          const projectRoot =
            paths.length > 0
              ? projectRootForPath(paths[0])
              : isProjectRoot(process.cwd())
                ? process.cwd()
                : null;
          if (projectRoot) recordProjectSession(db, projectRoot, session);
        } catch {
          // housekeeping only: a failure here must not turn an allow into a deny
        }
      }
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
  // NX-04 : les raisons de blocage vivaient par cible, et le message court ne
  // publiait que les globales. Un refus nommait donc les skills à charger sans
  // jamais dire quel fichier l'avait déclenché. On les remonte, dédoublonnées,
  // avec le chemin seulement quand elles ne concernent pas toutes les cibles.
  const finalReasons = mergeTargetReasons(
    results.map((entry) => ({ path: entry.path, reasons: entry.reasons })),
    reasons,
  );
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
    reasons: finalReasons,
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

// --- novahiz gate on|off -----------------------------------------------------
// Persistance du kill-switch NOVAHIZ_GATE au niveau utilisateur, pour un
// utilisateur final qui ne touche jamais au code :
//  - Windows : registre HKCU\Environment (lu par tout nouveau process) ;
//  - Linux/macOS : bloc marque dans ~/.profile (OpenCode lance depuis un
//    terminal ; un lanceur GUI doit export la variable lui-meme).
// Le changement ne prend effet qu'apres restart complet d'OpenCode : le plugin
// lit la variable une seule fois, a l'import.

export const GATE_PROFILE_BEGIN = "# >>> novahiz-gate >>>";
export const GATE_PROFILE_END = "# <<< novahiz-gate <<<";

/** Fonction pure (testee) : ajoute/remplace ou retire le bloc marque. */
export function upsertGateProfile(profile: string, off: boolean): string {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRe = new RegExp(`${escape(GATE_PROFILE_BEGIN)}[\\s\\S]*?${escape(GATE_PROFILE_END)}\\n?`);
  const stripped = profile.replace(blockRe, "");
  if (!off) return stripped;
  const base = stripped.length > 0 && !stripped.endsWith("\n") ? `${stripped}\n` : stripped;
  return `${base}${GATE_PROFILE_BEGIN}\nexport NOVAHIZ_GATE=off\n${GATE_PROFILE_END}\n`;
}

export function commandGateToggle(parsed: Parsed): void {
  const mode = (parsed.positionals[1] ?? "").toLowerCase();
  const off = mode === "off";
  if (process.platform === "win32") {
    const result = off
      ? spawnSync("reg", ["add", "HKCU\\Environment", "/v", "NOVAHIZ_GATE", "/t", "REG_SZ", "/d", "off", "/f"], { encoding: "utf8" })
      : spawnSync("reg", ["delete", "HKCU\\Environment", "/v", "NOVAHIZ_GATE", "/f"], { encoding: "utf8" });
    if (result.status !== 0) {
      // `reg delete` echoue aussi quand la valeur n'existe pas : dans ce cas
      // "on" est deja l'etat voulu, ce n'est pas une erreur.
      if (off) {
        process.stderr.write(`novahiz gate: registre inaccessible (${(result.stderr ?? "").trim() || `exit ${result.status}`}).\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write("NOVAHIZ_GATE deja absente du registre : le gate est actif.\n");
    } else {
      process.stdout.write(off ? "NOVAHIZ_GATE=off ecrite (HKCU\\Environment).\n" : "NOVAHIZ_GATE retiree du registre : gate actif.\n");
    }
  } else {
    const profile = join(homedir(), ".profile");
    const current = existsSync(profile) ? readFileSync(profile, "utf8") : "";
    const next = upsertGateProfile(current, off);
    if (next !== current) writeFileSync(profile, next, "utf8");
    process.stdout.write(off ? `NOVAHIZ_GATE=off ecrite dans ${profile}.\n` : `Bloc NOVAHIZ_GATE retire de ${profile}.\n`);
  }
  process.stdout.write("Restart OpenCode completely for the change to take effect.\n");
}

