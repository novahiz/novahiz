import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classify } from "./classify.ts";
import { evaluateGate } from "./gate.ts";
import { extractTargetPaths } from "./targets.ts";
import { loadSpec, novahizHome } from "./spec.ts";
import { openDb, setMeta, getMeta } from "./db.ts";
import { loadInstalledSkills, persistCatalog, scanSkills, writeSkillIndex } from "./catalog.ts";

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
  const db = openDb(dbPathFor(root, spec));
  persistCatalog(db, spec, skills);
  const lastSync = new Date().toISOString();
  setMeta(db, "last_sync", lastSync);
  db.close();
  print({ root, scanned: skills.length, index: indexFile, lastSync });
}

function commandClassify(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const text = parsed.positionals.slice(1).join(" ") || asString(parsed.flags.text);
  const result = classify(spec, text, {
    minScore: parsed.flags["min-score"] ? Number(parsed.flags["min-score"]) : undefined,
    maxCategories: parsed.flags["max-categories"] ? Number(parsed.flags["max-categories"]) : undefined
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

  const single = asString(parsed.flags.file);
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
  } else {
    process.stderr.write("Novahiz: gate requires --file <path> or --args-stdin\n");
    process.exitCode = 1;
    return;
  }

  const gated = gateConfig.tools.includes(tool);
  if (paths.length === 0) {
    const result = {
      allow: !gated,
      tool,
      targets: [],
      requiredSkills: [],
      missingSkills: [],
      reason: gated ? "no target path could be derived for a gated tool" : "tool is not gated"
    };
    print(result);
    if (gated && gateConfig.mode === "block") process.exitCode = 2;
    return;
  }

  const index = loadInstalledSkills(spec);
  const results = paths.map((filePath) => ({
    path: filePath,
    ...evaluateGate({
      tool,
      filePath,
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

function usage(): void {
  print({
    name: "novahiz",
    commands: [
      "check",
      "sync",
      "classify <text> [--min-score N] [--max-categories N]",
      "gate --tools <tool> (--file <path> | --args-stdin) [--categories a,b] [--loaded a,b] [--session id]",
      "skills [--category id]",
      "categories",
      "rules",
      "session-load --session id --skill name",
      "session-state --session id"
    ]
  });
}

function main(argv: string[]): void {
  const parsed = parse(argv);
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
    default:
      return usage();
  }
}

main(process.argv.slice(2));
