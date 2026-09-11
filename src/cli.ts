import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classify } from "./classify.ts";
import { changeText } from "./content.ts";
import { evaluateGate } from "./gate.ts";
import { claudeDenyOutput, decideHook, missingMessage, type Harness } from "./hook.ts";
import { extractTargetPaths } from "./targets.ts";
import { loadSpec, novahizHome, expandHome } from "./spec.ts";
import { openDb, setMeta, getMeta } from "./db.ts";
import { loadCatalog, loadInstalledSkills, persistCatalog, scanSkills, writeCatalog, writeSkillIndex } from "./catalog.ts";
import { rankSkills } from "./relevance.ts";

type Parsed = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

function parse(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
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
  const skills = scanSkills(spec);
  const indexFile = writeSkillIndex(spec, skills);
  const catalogFile = writeCatalog(spec, skills);
  const db = openDb(dbPathFor(root, spec));
  persistCatalog(db, spec, skills);
  const lastSync = new Date().toISOString();
  setMeta(db, "last_sync", lastSync);
  db.close();
  print({ root, scanned: skills.length, index: indexFile, catalog: catalogFile, lastSync });
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

  const gated = gateConfig.tools.includes(tool);
  const shellTool = tool === "bash" || tool === "shell";
  if (paths.length === 0) {
    const allow = shellTool ? true : !gated;
    const reason = shellTool
      ? "no file write detected in shell command"
      : gated
        ? "no target path could be derived for a gated tool"
        : "tool is not gated";
    print({ allow, tool, targets: [], requiredSkills: [], missingSkills: [], reason });
    if (!allow && gateConfig.mode === "block") process.exitCode = 2;
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

  const allow = results.every((entry) => entry.allow);
  const requiredSkills = [...new Set(results.flatMap((entry) => entry.requiredSkills))];
  const missingSkills = [...new Set(results.flatMap((entry) => entry.missingSkills))];
  const indexMissing = results.some((entry) => entry.indexMissing);

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
    targets: results.map((entry) => ({
      path: entry.path,
      fileClass: entry.fileClass,
      ignored: entry.ignored,
      roadmap: entry.roadmap,
      requiredSkills: entry.requiredSkills,
      missingSkills: entry.missingSkills,
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
  const filtered = category.length > 0 ? rows.filter((row) => (JSON.parse(row.categories) as string[]).includes(category)) : rows;
  print(
    filtered.map((row) => ({
      id: row.id,
      name: row.name,
      power: row.power,
      stars: row.stars,
      tags: JSON.parse(row.tags),
      categories: JSON.parse(row.categories)
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
  print({ session, loaded, categories: state ? JSON.parse(state.categories) : [], requiredSkills: state ? JSON.parse(state.required_skills) : [] });
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

  const sessionId = String(payload.session_id ?? payload.sessionId ?? "default");
  const toolName = String(payload.tool_name ?? payload.toolName ?? "");
  const toolInput = payload.tool_input ?? payload.toolInput ?? {};

  if (event === "Stop") {
    const stopDb = openDb(dbPathFor(root, spec));
    const stepsDone = (
      stopDb.prepare("SELECT step_id FROM roadmap_progress WHERE session_id = ?").all(sessionId) as { step_id: string }[]
    ).map((row) => row.step_id);
    stopDb.close();
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
  const decision = decideHook(spec, harness, toolName, toolInput, { loadedSkills });

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

  const report = { total, invocations, roadmapDone, decisions, byTool, byClass, topMissing, topSkills, roadmapBySession };

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

  print(report);
}

function commandCatalog(parsed: Parsed): void {
  const spec = loadSpec();
  const query = parsed.positionals.slice(1).join(" ") || asString(parsed.flags.query);
  const limitRaw = Number(parsed.flags.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10;
  const catalog = loadCatalog(spec);
  const results = rankSkills(catalog, query, limit);
  print({ query, total: catalog.length, results });
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
      "hook --harness claude|codex [--event PreToolUse]",
      "report [--format markdown]",
      "catalog <query> [--limit N]",
      "roadmap --category id | <query>",
      "step --session id --done <step>"
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
    case "catalog":
      return commandCatalog(parsed);
    case "roadmap":
      return commandRoadmap(parsed);
    case "step":
      return commandStep(parsed);
    default:
      return usage();
  }
}

main(process.argv.slice(2));
