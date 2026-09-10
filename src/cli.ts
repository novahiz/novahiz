import { resolve } from "node:path";
import { classify } from "./classify.ts";
import { evaluateGate, type FileClass } from "./gate.ts";
import { loadSpec, novahizHome } from "./spec.ts";
import { openDb, setMeta, getMeta } from "./db.ts";
import { persistCatalog, readInstalledSkills, scanSkills, writeSkillIndex } from "./catalog.ts";

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

function commandCheck(): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const installed = readInstalledSkills(spec);
  print({
    home: root,
    categories: spec.categories.length,
    rules: spec.rules.length,
    skillRoots: spec.config.skillRoots.length,
    installedSkills: installed.size,
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
  print({
    root,
    scanned: skills.length,
    index: indexFile,
    lastSync
  });
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
  const filePath = asString(parsed.flags.file);
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

  const result = evaluateGate({
    tool,
    filePath,
    categories,
    loadedSkills: loaded,
    installedSkills: readInstalledSkills(spec),
    spec
  });

  if (session.length > 0) {
    const db = openDb(dbPathFor(root, spec));
    db.prepare(
      "INSERT INTO enforcement_log (session_id, tool, file_path, file_class, decision, missing, matched_rules, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      session,
      tool,
      filePath,
      result.fileClass as FileClass,
      result.allow ? "allow" : "block",
      JSON.stringify(result.missingSkills),
      JSON.stringify(result.matchedRules),
      new Date().toISOString()
    );
    db.close();
  }

  print(result);
  if (!result.allow) process.exitCode = 2;
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
  const spec = loadSpec();
  print(spec.categories);
}

function commandRules(): void {
  const spec = loadSpec();
  print(spec.rules);
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
      "gate --file <path> --tool <tool> [--categories a,b] [--loaded a,b] [--session id]",
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
