import { existsSync, readFileSync, readSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { classify } from "./classify.ts";
import { changeText } from "./content.ts";
import { evaluateGate } from "./gate.ts";
import { claudeDenyOutput, decideHook, missingMessage, normalizeTool, unmatchedMessage, type Harness } from "./hook.ts";
import { extractTargetPaths } from "./targets.ts";
import { runCommand, runScript } from "./exec.ts";
import { loadSpec, novahizHome, expandHome } from "./spec.ts";
import { openDb, setMeta, getMeta } from "./db.ts";
import { loadCatalog, loadInstalledSkills, persistCatalog, scanSkills, writeCatalog, writeSkillIndex } from "./catalog.ts";
import { rankSkills } from "./relevance.ts";
import { buildMcpEntries, enabledProviders, installCommands } from "./providers.ts";
import { bootstrapFor, checkDependencies, missingPrerequisites } from "./deps.ts";
import { buildCalibration, filterSavings, parseSavings, savingsPath, summarizeSavings } from "../adapters/opencode/tokens.ts";
import * as ui from "./render.ts";
import {
  activeTask,
  addTodos,
  amendTodo,
  blockTodo,
  buildWorkPackets,
  completeTodo,
  createTask,
  dropTodo,
  getTask,
  getTodo,
  insertTodo,
  ledgerSummary,
  recordEdit,
  recordTodoDone,
  reorderTodos,
  resume,
  reviewDue,
  reviewTask,
  revisionSignals,
  startTodo,
  traceCheck,
  type ReviewDiff,
  type TodoAmendment,
  type TodoInput,
  type TodoKind
} from "./ledger.ts";

type Parsed = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

function parse(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      index += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { positionals, flags };
}

function asString(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

function splitList(value: string | boolean | undefined): string[] {
  return asString(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function flagOn(parsed: Parsed, name: string): boolean {
  const value = parsed.flags[name];
  if (value === undefined || value === null) return false;
  if (value === true) return true;
  return !["false", "0", "no", "off", ""].includes(String(value).toLowerCase());
}

function humanMode(parsed: Parsed): boolean {
  if (flagOn(parsed, "json")) return false;
  if (flagOn(parsed, "pretty")) return true;
  return ui.isTty();
}

function emit(parsed: Parsed, value: unknown, render: () => string): void {
  if (humanMode(parsed)) {
    process.stdout.write(`${render()}\n`);
    return;
  }
  print(value);
}

function confirm(question: string): boolean {
  process.stdout.write(`${question} [o/N] `);
  const buffer = Buffer.alloc(64);
  try {
    const read = readSync(0, buffer, 0, buffer.length, null);
    const answer = buffer.subarray(0, read).toString("utf8").trim().toLowerCase();
    return ["o", "oui", "y", "yes"].includes(answer);
  } catch {
    return false;
  }
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function dbPathFor(root: string, spec: ReturnType<typeof loadSpec>): string {
  const configured = spec.config.dbPath;
  if (configured.length === 0) return resolve(root, "novahiz.sqlite");
  return resolve(root, configured);
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function commandCheck(): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const index = loadInstalledSkills(spec);
  print({
    home: root,
    categories: spec.categories.length,
    rules: spec.rules.length,
    skillRoots: spec.config.skillRoots.length,
    installedSkills: index.skills.size,
    indexAvailable: index.available,
    gate: spec.config.gate,
    classify: spec.config.classify
  });
}

function commandSync(): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const scanErrors: string[] = [];
  const skills = scanSkills(spec, scanErrors);
  const indexFile = writeSkillIndex(spec, skills);
  const catalogFile = writeCatalog(spec, skills);
  const db = openDb(dbPathFor(root, spec));
  persistCatalog(db, spec, skills);
  const lastSync = new Date().toISOString();
  setMeta(db, "last_sync", lastSync);
  db.close();
  print({ root, scanned: skills.length, index: indexFile, catalog: catalogFile, lastSync, scanErrors });
}

function commandClassify(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const text = parsed.positionals.slice(1).join(" ") || asString(parsed.flags.text);
  const minScore = Number(parsed.flags["min-score"]);
  const maxCategories = Number(parsed.flags["max-categories"]);
  const result = classify(spec, text, {
    minScore: Number.isFinite(minScore) ? minScore : undefined,
    maxCategories: Number.isFinite(maxCategories) ? maxCategories : undefined
  });
  print({ prompt: text, ...result });
}

function commandGate(parsed: Parsed): void {
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

function commandSkills(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const db = openDb(dbPathFor(root, spec));
  const rows = db.prepare("SELECT id, name, power, stars, tags, categories FROM skills ORDER BY power DESC, id ASC").all() as {
    id: string;
    name: string;
    power: number;
    stars: number | null;
    tags: string;
    categories: string;
  }[];
  db.close();
  const category = asString(parsed.flags.category);
  const filtered = category.length > 0 ? rows.filter((row) => safeJsonArray(row.categories).includes(category)) : rows;
  print(
    filtered.map((row) => ({
      id: row.id,
      name: row.name,
      power: row.power,
      stars: row.stars,
      tags: safeJsonArray(row.tags),
      categories: safeJsonArray(row.categories)
    }))
  );
}

function commandCategories(): void {
  print(loadSpec().categories);
}

function commandRules(): void {
  print(loadSpec().rules);
}

function commandSessionLoad(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const session = asString(parsed.flags.session);
  const skill = asString(parsed.flags.skill);
  if (session.length === 0 || skill.length === 0) {
    print({ error: "session-load requires --session and --skill" });
    process.exitCode = 1;
    return;
  }
  const db = openDb(dbPathFor(root, spec));
  db.prepare("INSERT OR IGNORE INTO skill_invocations (session_id, skill, invoked_at) VALUES (?, ?, ?)").run(
    session,
    skill,
    new Date().toISOString()
  );
  db.close();
  print({ session, loaded: skill });
}

function commandSessionState(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const session = asString(parsed.flags.session);
  const db = openDb(dbPathFor(root, spec));
  const loaded = (db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(session) as { skill: string }[]).map(
    (row) => row.skill
  );
  const state = db.prepare("SELECT categories, required_skills FROM sessions WHERE id = ?").get(session) as
    | { categories: string; required_skills: string }
    | undefined;
  db.close();
  print({ session, loaded, categories: state ? safeJsonArray(state.categories) : [], requiredSkills: state ? safeJsonArray(state.required_skills) : [] });
}

function commandHook(parsed: Parsed): void {
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

function commandReport(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const db = openDb(dbPathFor(root, spec));
  const total = (db.prepare("SELECT COUNT(*) AS n FROM enforcement_log").get() as { n: number }).n;
  const decisions = db.prepare("SELECT decision, COUNT(*) AS n FROM enforcement_log GROUP BY decision").all();
  const byTool = db.prepare("SELECT tool, COUNT(*) AS n FROM enforcement_log GROUP BY tool ORDER BY n DESC").all();
  const byClass = db.prepare("SELECT file_class, COUNT(*) AS n FROM enforcement_log GROUP BY file_class ORDER BY n DESC").all();
  const missingRows = db.prepare("SELECT missing FROM enforcement_log").all() as { missing: string }[];
  const invocations = (db.prepare("SELECT COUNT(*) AS n FROM skill_invocations").get() as { n: number }).n;
  const topSkills = db.prepare("SELECT skill, COUNT(*) AS n FROM skill_invocations GROUP BY skill ORDER BY n DESC LIMIT 10").all();
  const roadmapDone = (db.prepare("SELECT COUNT(*) AS n FROM roadmap_progress").get() as { n: number }).n;
  const roadmapBySession = db.prepare("SELECT session_id, COUNT(*) AS n FROM roadmap_progress GROUP BY session_id ORDER BY n DESC LIMIT 10").all();
  db.close();

  const counts: Record<string, number> = {};
  for (const row of missingRows) {
    let list: string[] = [];
    try {
      list = JSON.parse(row.missing) as string[];
    } catch {
      list = [];
    }
    for (const skill of list) counts[skill] = (counts[skill] ?? 0) + 1;
  }
  const topMissing = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([skill, n]) => ({ skill, n }));

  const report = { total, invocations, roadmapDone, providers: spec.providers.map((provider) => provider.id), decisions, byTool, byClass, topMissing, topSkills, roadmapBySession };

  if (asString(parsed.flags.format) === "markdown") {
    const lines = [
      "# Novahiz report",
      "",
      `Enforcement entries: ${total}`,
      `Skill invocations: ${invocations}`,
      `Roadmap steps done: ${roadmapDone}`,
      "",
      "## Decisions",
      ...decisions.map((row) => `- ${(row as { decision: string }).decision}: ${(row as { n: number }).n}`),
      "",
      "## Top missing skills",
      ...topMissing.map((entry) => `- ${entry.skill}: ${entry.n}`),
      "",
      "## Top loaded skills",
      ...topSkills.map((row) => `- ${(row as { skill: string }).skill}: ${(row as { n: number }).n}`),
      ""
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  emit(parsed, report, () =>
    [
      ui.heading("Novahiz report"),
      ui.kv([
        ["Journal d'enforcement", String(total)],
        ["Invocations de skills", String(invocations)],
        ["Etapes de roadmap faites", String(roadmapDone)],
        ["Providers", String(spec.providers.length)]
      ]),
      "",
      ui.heading("Decisions"),
      ui.table(["decision", "n"], decisions.map((row) => [(row as { decision: string }).decision, String((row as { n: number }).n)])),
      "",
      ui.heading("Outils"),
      ui.table(["outil", "n"], byTool.map((row) => [String((row as { tool: string }).tool), String((row as { n: number }).n)])),
      "",
      ui.heading("Skills les plus attendues"),
      ui.table(["skill", "n"], topMissing.map((entry) => [entry.skill, String(entry.n)])),
      "",
      ui.heading("Skills les plus chargees"),
      ui.table(["skill", "n"], topSkills.map((row) => [(row as { skill: string }).skill, String((row as { n: number }).n)]))
    ].join("\n")
  );
}

function commandCatalog(parsed: Parsed): void {
  const spec = loadSpec();
  const query = parsed.positionals.slice(1).join(" ") || asString(parsed.flags.query);
  const limitRaw = Number(parsed.flags.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10;
  const catalog = loadCatalog(spec);
  const results = rankSkills(catalog, query, limit);
  const hint = catalog.length === 0 ? "catalog is empty; run `novahiz sync` to build it" : undefined;
  print({ query, total: catalog.length, results, ...(hint ? { hint } : {}) });
}

function commandRoadmap(parsed: Parsed): void {
  const spec = loadSpec();
  const categoryId = asString(parsed.flags.category);
  const query = parsed.positionals.slice(1).join(" ") || asString(parsed.flags.query);
  let category = categoryId ? spec.categories.find((entry) => entry.id === categoryId) : undefined;
  if (!category && query.length > 0) {
    const result = classify(spec, query);
    category = spec.categories.find((entry) => entry.id === result.primary);
  }
  if (!category) {
    print({ error: "roadmap requires --category <id> or a query" });
    process.exitCode = 1;
    return;
  }
  print({ category: category.id, roadmap: category.roadmap ?? null });
}

function commandStep(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const session = asString(parsed.flags.session);
  const done = asString(parsed.flags.done);
  if (session.length === 0) {
    print({ error: "step requires --session <id>" });
    process.exitCode = 1;
    return;
  }
  const db = openDb(dbPathFor(root, spec));
  if (done.length > 0) {
    db.prepare(
      "INSERT INTO roadmap_progress (session_id, step_id, status, updated_at) VALUES (?, ?, 'done', ?) ON CONFLICT(session_id, step_id) DO UPDATE SET status = 'done', updated_at = excluded.updated_at"
    ).run(session, done, new Date().toISOString());
  }
  const steps = db.prepare("SELECT step_id, status, updated_at FROM roadmap_progress WHERE session_id = ? ORDER BY updated_at").all(session);
  db.close();
  print({ session, steps });
}

function commandProviders(parsed: Parsed): void {
  const spec = loadSpec();
  if (parsed.flags["mcp-json"]) {
    print(buildMcpEntries(spec));
    return;
  }
  if (parsed.flags.install) {
    const results: Record<string, unknown>[] = [];
    for (const entry of installCommands(spec)) {
      const [command, ...args] = entry.command;
      const result = runCommand(command, args);
      process.stdout.write(`${result.ok ? "ok  " : "fail"} ${entry.id} (${entry.kind}) ${entry.command.join(" ")}\n`);
      if (!result.ok && result.stderr) process.stderr.write(result.stderr);
      results.push({ id: entry.id, kind: entry.kind, source: entry.source, command: entry.command.join(" "), ok: result.ok, error: result.error ?? null });
    }
    print(results);
    return;
  }
  const category = asString(parsed.flags.category);
  const query = parsed.positionals.slice(1).join(" ") || asString(parsed.flags.query);
  let list = spec.providers;
  if (category.length > 0) {
    list = list.filter((provider) => (provider.categories ?? []).includes(category));
  } else if (query.length > 0) {
    const ids = new Set(classify(spec, query).providers);
    list = list.filter((provider) => ids.has(provider.id));
  }
  const enabled = new Set(enabledProviders(spec).map((provider) => provider.id));
  print(
    list.map((provider) => ({
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      transport: provider.transport ?? null,
      purpose: provider.purpose ?? "",
      categories: provider.categories ?? [],
      source: provider.source ?? "",
      enabled: enabled.has(provider.id)
    }))
  );
}

function commandDeps(parsed: Parsed): void {
  const spec = loadSpec();
  const status = checkDependencies(spec);
  if (!parsed.flags.install) {
    print({ node: process.version, platform: process.platform, dependencies: status });
    return;
  }

  const run = (command: string[], label: string): boolean => {
    const [bin, ...args] = command;
    const result = runCommand(bin, args);
    process.stdout.write(`${result.ok ? "ok  " : "fail"} ${label}\n`);
    if (!result.ok && result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${result.error}\n`);
    return result.ok;
  };

  const runBootstrap = (argv: string[], label: string): boolean => {
    const result = runScript(argv);
    process.stdout.write(`${result.ok ? "ok  " : "fail"} ${label}\n`);
    if (!result.ok && result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${result.error}\n`);
    return result.ok;
  };

  const results: Record<string, unknown>[] = [];
  for (const entry of missingPrerequisites(spec)) {
    const bootstrap = bootstrapFor(entry.provider);
    if (!bootstrap || bootstrap.length === 0) {
      results.push({ provider: entry.provider.id, step: "bootstrap", ok: false, note: `missing ${entry.missing.join(", ")}` });
      continue;
    }
    results.push({ provider: entry.provider.id, step: "bootstrap", command: bootstrap.join(" "), ok: runBootstrap(bootstrap, `bootstrap ${entry.provider.id}`) });
  }
  for (const entry of installCommands(spec)) {
    results.push({ provider: entry.id, step: "install", command: entry.command.join(" "), ok: run(entry.command, `install ${entry.id}`) });
  }
  print(results);
}

function normalizeTodoInput(item: unknown): TodoInput {
  const record = (item ?? {}) as Record<string, unknown>;
  const owners = Array.isArray(record.owner)
    ? record.owner.map(String)
    : typeof record.owner === "string"
      ? record.owner.split(",").map((part) => part.trim()).filter(Boolean)
      : [];
  const dependsRaw = record.dependsOn ?? record.depends_on;
  const dependsOn = Array.isArray(dependsRaw) ? dependsRaw.map(String) : [];
  const maxIterations = Number(record.maxIterations ?? record.max_iterations);
  return {
    label: String(record.label ?? record.title ?? "").trim(),
    kind: (record.kind ? String(record.kind) : "edit") as TodoKind,
    acceptance: record.acceptance ? String(record.acceptance) : undefined,
    owner: owners.length > 0 ? owners.join(",") : undefined,
    dependsOn,
    maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : undefined
  };
}

function commandTask(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const action = parsed.positionals[1] ?? "status";
  const session = asString(parsed.flags.session);
  const db = openDb(dbPathFor(root, spec));
  try {
    if (action === "new") {
      const title = (asString(parsed.flags.title) || parsed.positionals.slice(2).join(" ")).trim();
      if (title.length === 0) {
        print({ error: "task new requires --title" });
        process.exitCode = 1;
        return;
      }
      const id = asString(parsed.flags.id) || undefined;
      const task = createTask(db, { title, id, sessionId: session || undefined });
      print({ task, todos: [] });
      return;
    }

    if (action === "plan") {
      const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
      if (!taskId) {
        print({ error: "task plan requires --task or an active task" });
        process.exitCode = 1;
        return;
      }
      const raw = (asString(parsed.flags.json) || readStdin()).trim();
      let parsedItems: unknown;
      try {
        parsedItems = JSON.parse(raw.length > 0 ? raw : "[]");
      } catch {
        print({ error: "invalid JSON plan" });
        process.exitCode = 1;
        return;
      }
      if (!Array.isArray(parsedItems)) {
        print({ error: "plan must be a JSON array of todos" });
        process.exitCode = 1;
        return;
      }
      const todos = addTodos(db, taskId, parsedItems.map(normalizeTodoInput));
      print({ task: getTask(db, taskId), todos });
      return;
    }

    if (action === "todo") {
      const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
      if (!taskId) {
        print({ error: "task todo requires --task or an active task" });
        process.exitCode = 1;
        return;
      }
      const label = (asString(parsed.flags.label) || parsed.positionals.slice(2).join(" ")).trim();
      if (label.length === 0) {
        print({ error: "task todo requires --label" });
        process.exitCode = 1;
        return;
      }
      const maxIterations = Number(parsed.flags["max-iterations"]);
      const owners = splitList(parsed.flags.owner);
      const todos = addTodos(db, taskId, [
        {
          label,
          kind: (asString(parsed.flags.kind) || "edit") as TodoKind,
          acceptance: asString(parsed.flags.acceptance) || undefined,
          owner: owners.length > 0 ? owners.join(",") : undefined,
          maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : undefined
        }
      ]);
      print({ task: getTask(db, taskId), todos });
      return;
    }

    const id = asString(parsed.flags.id) || parsed.positionals[2] || "";
    if (action === "start") {
      if (!id) {
        print({ error: "task start requires --id" });
        process.exitCode = 1;
        return;
      }
      const target = getTodo(db, id);
      if (target && spec.config.ledger?.enabled !== false) {
        const due = reviewDue(db, target.task_id, spec.config.ledger.review);
        if (due.due) {
          print({ error: due.reason, task: target.task_id });
          process.exitCode = 1;
          return;
        }
      }
      print({ todo: startTodo(db, id) });
      return;
    }
    if (action === "done") {
      if (!id) {
        print({ error: "task done requires --id" });
        process.exitCode = 1;
        return;
      }
      const todo = completeTodo(db, id, asString(parsed.flags.proof));
      if (spec.config.ledger?.enabled !== false) recordTodoDone(db, todo.task_id);
      print({ todo });
      return;
    }
    if (action === "block") {
      if (!id) {
        print({ error: "task block requires --id" });
        process.exitCode = 1;
        return;
      }
      print({ todo: blockTodo(db, id, asString(parsed.flags.reason)) });
      return;
    }

    if (action === "signals") {
      const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
      if (!taskId) {
        print({ error: "task signals requires --task or an active task" });
        process.exitCode = 1;
        return;
      }
      print({ task: getTask(db, taskId), signals: revisionSignals(db, taskId) });
      return;
    }

    if (action === "review") {
      const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
      if (!taskId) {
        print({ error: "task review requires --task or an active task" });
        process.exitCode = 1;
        return;
      }
      const raw = (asString(parsed.flags.json) || readStdin()).trim();
      let diff: ReviewDiff = {};
      if (raw.length > 0) {
        try {
          diff = JSON.parse(raw) as ReviewDiff;
        } catch {
          print({ error: "invalid JSON review diff" });
          process.exitCode = 1;
          return;
        }
      }
      const outcome = reviewTask(db, { taskId, ...diff });
      print({ ...outcome, reason: asString(parsed.flags.reason) });
      return;
    }

    if (action === "amend") {
      if (!id) {
        print({ error: "task amend requires --id" });
        process.exitCode = 1;
        return;
      }
      const patch: TodoAmendment = {};
      const label = asString(parsed.flags.label);
      if (label) patch.label = label;
      const kind = asString(parsed.flags.kind);
      if (kind) patch.kind = kind as TodoKind;
      if (parsed.flags.acceptance !== undefined) patch.acceptance = asString(parsed.flags.acceptance);
      const owners = splitList(parsed.flags.owner);
      if (owners.length > 0) patch.owner = owners.join(",");
      const maxIterations = Number(parsed.flags["max-iterations"]);
      if (Number.isFinite(maxIterations) && maxIterations > 0) patch.maxIterations = maxIterations;
      print({ todo: amendTodo(db, id, patch) });
      return;
    }

    if (action === "insert") {
      const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
      if (!taskId) {
        print({ error: "task insert requires --task or an active task" });
        process.exitCode = 1;
        return;
      }
      const label = (asString(parsed.flags.label) || parsed.positionals.slice(2).join(" ")).trim();
      if (!label) {
        print({ error: "task insert requires --label" });
        process.exitCode = 1;
        return;
      }
      const item = normalizeTodoInput({
        label,
        kind: asString(parsed.flags.kind) || "edit",
        acceptance: asString(parsed.flags.acceptance) || undefined,
        owner: splitList(parsed.flags.owner),
        maxIterations: Number(parsed.flags["max-iterations"]) || undefined
      });
      const positionRaw = asString(parsed.flags.position);
      const position = positionRaw === "" ? "end" : /^\d+$/.test(positionRaw) ? Number(positionRaw) : (positionRaw as "start" | "end");
      print({ todo: insertTodo(db, taskId, item, position), task: getTask(db, taskId) });
      return;
    }

    if (action === "drop") {
      if (!id) {
        print({ error: "task drop requires --id" });
        process.exitCode = 1;
        return;
      }
      print({ todo: dropTodo(db, id, asString(parsed.flags.reason)) });
      return;
    }

    if (action === "reorder") {
      const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
      if (!taskId) {
        print({ error: "task reorder requires --task or an active task" });
        process.exitCode = 1;
        return;
      }
      const requested = splitList(parsed.flags.order);
      const order = requested.length > 0 ? requested : parsed.positionals.slice(2);
      print({ task: getTask(db, taskId), todos: reorderTodos(db, taskId, order) });
      return;
    }

    if (action === "current" || action === "status" || action === "resume") {
      const state = resume(db, session || undefined);
      const summary = ledgerSummary(state);
      let review = null as ReturnType<typeof reviewDue> | null;
      const signals = state.task ? revisionSignals(db, state.task.id) : [];
      if (state.task && spec.config.ledger?.enabled !== false) {
        review = reviewDue(db, state.task.id, spec.config.ledger.review);
        summary.push(
          `  review: ${review.due ? "DUE" : "ok"} (edits ${review.edits}/${review.policy.edits}, todos ${review.todos}/${review.policy.todos})`
        );
        if (review.due) summary.push(`  -> reconcile with: novahiz task review --task ${state.task.id} --reason "<what changed>"`);
        for (const signal of signals) summary.push(`  signal ${signal.type}: ${signal.detail}`);
      }
      print({ ...state, summary, review, signals });
      return;
    }

    print({ error: `unknown task action: ${action}`, actions: ["new", "plan", "todo", "start", "done", "block", "review", "amend", "insert", "drop", "reorder", "signals", "status", "resume", "current"] });
    process.exitCode = 1;
  } catch (error) {
    print({ error: String((error as Error)?.message ?? error) });
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

function commandDispatch(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const session = asString(parsed.flags.session);
  const db = openDb(dbPathFor(root, spec));
  try {
    const taskId = asString(parsed.flags.task) || activeTask(db, session || undefined)?.id;
    if (!taskId) {
      print({ error: "dispatch requires --task or an active task" });
      process.exitCode = 1;
      return;
    }
    const packets = buildWorkPackets(db, taskId);
    const ownership = new Map<string, string[]>();
    for (const packet of packets) {
      for (const file of packet.files) {
        ownership.set(file, [...(ownership.get(file) ?? []), packet.todo]);
      }
    }
    const conflicts = [...ownership.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([file, owners]) => ({ file, todos: owners }));
    print({ task: getTask(db, taskId), packets, conflicts });
  } catch (error) {
    print({ error: String((error as Error)?.message ?? error) });
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

function commandTokens(parsed: Parsed): void {
  const root = novahizHome();
  const path = savingsPath(root);
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  const entries = filterSavings(parseSavings(text), {
    since: asString(parsed.flags.since),
    session: asString(parsed.flags.session)
  });
  const summary = summarizeSavings(entries);
  const format = asString(parsed.flags.format) || "json";
  if (parsed.flags.calibrate === true) {
    const calibration = buildCalibration(entries);
    if (format === "text") {
      const lines = [
        `Novahiz token calibration (${path})`,
        `removed bytes: min ${calibration.removedBytes.min} / median ${calibration.removedBytes.median} / max ${calibration.removedBytes.max}`,
        `removed tokens: min ${calibration.removedTokens.min} / median ${calibration.removedTokens.median} / max ${calibration.removedTokens.max}`,
        `bytes/token: ${calibration.bytesPerToken === null ? "n/a" : calibration.bytesPerToken.toFixed(2)}`,
        `trims: ${calibration.trimEvents} (instrumented ${calibration.instrumentedTrims})  re-reads: ${calibration.reReads}`
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
      return;
    }
    print({ path, calibration });
    return;
  }
  if (format === "text") {
    const lines = [
      `Novahiz token savings (${path})`,
      `events: ${summary.events}`,
      `~tokens saved: ${summary.totalSaved}`,
      `bytes: ${summary.totalOriginalBytes} -> ${summary.totalKeptBytes}`,
      `trim: ${summary.byKind.trim}  dedupe: ${summary.byKind.dedupe}`,
      `sessions: ${summary.sessions}`
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }
  print({ path, ...summary });
}

type CleanScope = { table: string; column: string; where?: string; label: string };

const CLEAN_SCOPES: Record<string, CleanScope[]> = {
  logs: [
    { table: "enforcement_log", column: "logged_at", label: "journal d'enforcement" },
    { table: "skill_invocations", column: "invoked_at", label: "invocations de skills" }
  ],
  roadmap: [{ table: "roadmap_progress", column: "updated_at", label: "progression de roadmap" }],
  sessions: [{ table: "sessions", column: "updated_at", label: "sessions" }],
  tasks: [{ table: "tasks", column: "created_at", where: "status <> 'active'", label: "taches terminees" }]
};

const CLEAN_CHOICES = ["logs", "roadmap", "sessions", "tasks", "all"];

function commandClean(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const path = dbPathFor(root, spec);
  const daysRaw = Number(asString(parsed.flags.days));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : 30;
  const targetRaw = (asString(parsed.flags.target) || "logs").toLowerCase();
  if (!CLEAN_CHOICES.includes(targetRaw)) {
    print({ error: `cible inconnue: ${targetRaw}`, choices: CLEAN_CHOICES });
    process.exitCode = 1;
    return;
  }
  const scopes = targetRaw === "all" ? Object.values(CLEAN_SCOPES).flat() : CLEAN_SCOPES[targetRaw];
  const vacuum = flagOn(parsed, "vacuum");
  const apply = flagOn(parsed, "apply");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const db = openDb(path);
  const before = statSync(path).size;
  const plan = scopes.map((scope) => {
    const where = `${scope.column} < ?${scope.where ? ` AND ${scope.where}` : ""}`;
    const rows = (db.prepare(`SELECT COUNT(*) AS n FROM ${scope.table}`).get() as { n: number }).n;
    const deletable = (db.prepare(`SELECT COUNT(*) AS n FROM ${scope.table} WHERE ${where}`).get(cutoff) as { n: number }).n;
    return { table: scope.table, label: scope.label, rows, deletable };
  });
  const total = plan.reduce((sum, entry) => sum + entry.deletable, 0);

  const renderPlan = (): string => {
    const lines = [
      ui.heading("Novahiz clean"),
      ui.kv([
        ["Base", `${path} (${ui.bytes(before)})`],
        ["Cible", targetRaw],
        ["Anciennete", `plus de ${days} jours, anterieur a ${cutoff}`],
        ["A retirer", `${total} ligne(s)`]
      ]),
      "",
      ui.table(["table", "lignes", "a supprimer"], plan.map((entry) => [entry.table, String(entry.rows), String(entry.deletable)])),
      ""
    ];
    if (targetRaw === "tasks" || targetRaw === "all") {
      lines.push(ui.style("dim", "Les todos orphelins des taches supprimees partent avec elles."));
    }
    return lines.join("\n");
  };

  if (!apply) {
    const interactive = process.stdin.isTTY === true;
    const explicitDryRun = flagOn(parsed, "dry-run");
    if (!interactive) {
      db.close();
      emit(parsed, { path, days, cutoff, target: targetRaw, vacuum, applied: false, bytesBefore: before, bytesAfter: before, deleted: 0, tables: plan }, () =>
        [renderPlan(), ui.style("dim", "Mode plan. Relance avec --apply pour supprimer.")].join("\n")
      );
      if (!explicitDryRun) {
        process.stderr.write("Entree non interactive : ajoute --apply pour supprimer, ou --dry-run pour garder seulement l'apercu.\n");
        process.exitCode = 1;
      }
      return;
    }
    process.stdout.write(`${renderPlan()}\n`);
    if (!confirm("Supprimer ces lignes ?")) {
      db.close();
      process.stdout.write(`${ui.style("yellow", "Annule.")}\n`);
      return;
    }
  }

  let deleted = 0;
  for (const scope of scopes) {
    const where = `${scope.column} < ?${scope.where ? ` AND ${scope.where}` : ""}`;
    deleted += Number(db.prepare(`DELETE FROM ${scope.table} WHERE ${where}`).run(cutoff).changes);
  }
  if (targetRaw === "tasks" || targetRaw === "all") {
    deleted += Number(db.prepare("DELETE FROM todos WHERE task_id NOT IN (SELECT id FROM tasks)").run().changes);
  }
  if (vacuum) db.exec("VACUUM");
  db.close();
  const after = statSync(path).size;

  const value = { path, days, cutoff, target: targetRaw, vacuum, applied: true, bytesBefore: before, bytesAfter: after, deleted, tables: plan };
  emit(parsed, value, () =>
    [
      renderPlan(),
      ui.kv([
        ["Supprime", `${deleted} ligne(s)`],
        ["Taille", `${ui.bytes(before)} vers ${ui.bytes(after)}`],
        ["Vacuum", vacuum ? "oui" : "non"]
      ])
    ].join("\n")
  );
}

type DoctorCheck = { id: string; label: string; ok: boolean; detail: string; blocking: boolean };

const SKILL_CLI: Record<string, string> = { defuddle: "defuddle" };

function hasCommand(name: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [name], { encoding: "utf8", shell: false });
  return result.status === 0;
}

function referencedSkills(spec: ReturnType<typeof loadSpec>): string[] {
  const ids = new Set<string>();
  for (const category of spec.categories) {
    for (const skill of category.defaultSkills ?? []) ids.add(skill);
    for (const step of category.roadmap?.steps ?? []) {
      for (const skill of step.requireSkills ?? []) ids.add(skill);
    }
  }
  for (const rule of spec.rules) for (const skill of rule.require) ids.add(skill);
  for (const provider of spec.providers) if (provider.kind === "skill") ids.add(provider.id);
  return [...ids].sort();
}

function commandDoctor(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const checks: DoctorCheck[] = [];

  const parts = process.versions.node.split(".").map((value) => Number(value));
  const nodeOk = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 18);
  checks.push({ id: "node", label: "Node 22.18+", ok: nodeOk, detail: `v${process.versions.node}`, blocking: true });
  checks.push({ id: "npx", label: "npx disponible", ok: hasCommand("npx"), detail: "requis par les providers MCP", blocking: true });

  const index = loadInstalledSkills(spec);
  checks.push({
    id: "index",
    label: "Index des skills",
    ok: index.available,
    detail: index.available ? `${index.skills.size} skills` : "build/installed-skills.json illisible, lance novahiz sync",
    blocking: true
  });

  const referenced = referencedSkills(spec);
  const absent = index.available ? referenced.filter((id) => !index.skills.has(id)) : [];
  checks.push({
    id: "referenced",
    label: "Skills referencees",
    ok: absent.length === 0,
    detail: absent.length === 0 ? `${referenced.length} presentes` : `absentes de l'index: ${absent.join(", ")}`,
    blocking: absent.length > 0
  });

  const missingCli = Object.entries(SKILL_CLI)
    .filter(([skill]) => referenced.includes(skill) && !hasCommand(skill))
    .map(([, cli]) => cli);
  checks.push({
    id: "cli",
    label: "CLI externes requises",
    ok: missingCli.length === 0,
    detail: missingCli.length === 0 ? "toutes presentes" : `introuvables: ${missingCli.join(", ")}`,
    blocking: missingCli.length > 0
  });

  const probe = evaluateGate({
    tool: "edit",
    filePath: "README.md",
    content: "texte",
    categories: [],
    loadedSkills: [],
    installedSkills: index.skills,
    installedIndexAvailable: index.available,
    spec
  });
  const gateOk = spec.rules.length > 0 && probe.allow === false && probe.missingSkills.length > 0;
  checks.push({
    id: "gate",
    label: "Gate operationnel",
    ok: gateOk,
    detail: gateOk ? `bloque une ecriture sans skill chargee (${probe.missingSkills.join(", ")})` : "n'a pas bloque une ecriture sans skill chargee",
    blocking: true
  });

  const dbFile = dbPathFor(root, spec);
  let dbOk = false;
  let dbDetail = "absente";
  try {
    const size = statSync(dbFile).size;
    const db = openDb(dbFile);
    db.prepare("SELECT COUNT(*) AS n FROM enforcement_log").get();
    db.close();
    dbOk = true;
    dbDetail = ui.bytes(size);
  } catch (error) {
    dbDetail = `illisible: ${(error as Error).message}`;
  }
  checks.push({ id: "db", label: "Base du registre", ok: dbOk, detail: dbDetail, blocking: false });

  const adapterSource = join(root, "adapters", "opencode", "novahiz.ts");
  const opencodeDir =
    process.env.OPENCODE_CONFIG_DIR && process.env.OPENCODE_CONFIG_DIR.length > 0
      ? process.env.OPENCODE_CONFIG_DIR
      : join(homedir(), ".config", "opencode");
  const adapterInstalled = join(opencodeDir, "plugins", "novahiz.ts");
  let adapterOk = true;
  let adapterDetail = "aucune copie installee";
  if (existsSync(adapterSource) && existsSync(adapterInstalled)) {
    adapterOk = readFileSync(adapterSource, "utf8") === readFileSync(adapterInstalled, "utf8");
    adapterDetail = adapterOk ? "copie harnais a jour" : "copie harnais perimee, relance l'installeur puis redemarre opencode";
  }
  checks.push({ id: "adapter", label: "Copie harnais du plugin", ok: adapterOk, detail: adapterDetail, blocking: false });

  const failing = checks.filter((check) => !check.ok);
  const blocking = failing.filter((check) => check.blocking);
  const value = {
    home: root,
    node: process.versions.node,
    platform: process.platform,
    checks,
    failing: failing.map((check) => check.id),
    blocking: blocking.map((check) => check.id)
  };

  emit(parsed, value, () =>
    [
      ui.heading("Novahiz doctor"),
      ui.kv([
        ["Maison", root],
        ["Plateforme", process.platform]
      ]),
      "",
      ui.table(
        ["controle", "etat", "detail"],
        checks.map((check) => [check.label, check.ok ? ui.status(true) : ui.status(false), check.detail])
      ),
      "",
      blocking.length > 0
        ? ui.style("red", `${blocking.length} anomalie(s) bloquante(s): ${blocking.map((check) => check.id).join(", ")}`)
        : ui.style("green", "Aucune anomalie bloquante.")
    ].join("\n")
  );

  if (blocking.length > 0) process.exitCode = 1;
}

function usage(): void {
  print({
    name: "novahiz",
    commands: [
      "check",
      "sync",
      "classify <text> [--min-score N] [--max-categories N]",
      "gate --tool <tool> (--file <path> | --args-stdin) [--categories a,b] [--loaded a,b] [--session id]",
      "skills [--category id]",
      "categories",
      "rules",
      "session-load --session id --skill name",
      "session-state --session id",
      "hook --harness claude|codex [--event PreToolUse] [--categories a,b]",
      "report [--format markdown]",
      "catalog <query> [--limit N]",
      "roadmap --category id | <query>",
      "step --session id --done <step>",
      "providers [--category id] [--mcp-json] [--install]",
      "deps [--install]",
      "task new --title <title> [--id id] [--session id]",
      "task plan [--task id] [--session id] (JSON array on stdin or --json '<...>')",
      "task todo --label <label> [--task id] [--kind read|edit|verify|delegate] [--owner a,b] [--acceptance ...] [--max-iterations N]",
      "task start|done|block --id <todo> [--proof ...|--reason ...]",
      "task review [--task id] [--reason ...] [--json '<additions|amendments|removals|order>'] (or JSON on stdin)",
      "task amend --id <todo> [--label ...] [--kind ...] [--acceptance ...] [--owner a,b] [--max-iterations N]",
      "task insert --label <label> [--task id] [--kind ...] [--owner a,b] [--acceptance ...] [--position start|end|N]",
      "task drop --id <todo> [--reason ...]",
      "task reorder [--task id] --order <id,id,...>",
      "task signals [--task id]",
      "task status|resume|current [--session id]",
      "dispatch [--task id] [--session id]",
      "tokens [--format json|text] [--since <Nd|Nh|ISO>] [--session id] [--calibrate]",
      "clean [--target logs|roadmap|sessions|tasks|all] [--days N] [--dry-run|--apply] [--vacuum] [--json]",
      "doctor [--json]"
    ]
  });}

function main(argv: string[]): void {
  const parsed = parse(argv);
  if (typeof parsed.flags.home === "string" && parsed.flags.home.length > 0) {
    process.env.NOVAHIZ_HOME = resolve(expandHome(parsed.flags.home));
  }
  const command = parsed.positionals[0];
  switch (command) {
    case "check":
      return commandCheck();
    case "sync":
      return commandSync();
    case "classify":
      return commandClassify(parsed);
    case "gate":
      return commandGate(parsed);
    case "skills":
      return commandSkills(parsed);
    case "categories":
      return commandCategories();
    case "rules":
      return commandRules();
    case "session-load":
      return commandSessionLoad(parsed);
    case "session-state":
      return commandSessionState(parsed);
    case "hook":
      return commandHook(parsed);
    case "report":
      return commandReport(parsed);
    case "clean":
      return commandClean(parsed);
    case "doctor":
      return commandDoctor(parsed);
    case "catalog":
      return commandCatalog(parsed);
    case "roadmap":
      return commandRoadmap(parsed);
    case "step":
      return commandStep(parsed);
    case "providers":
      return commandProviders(parsed);
    case "deps":
      return commandDeps(parsed);
    case "task":
      return commandTask(parsed);
    case "dispatch":
      return commandDispatch(parsed);
    case "tokens":
      return commandTokens(parsed);
    default:
      return usage();
  }
}

main(process.argv.slice(2));
