import { join } from "node:path";
import { asString, dbPathFor, numberFlag, print, safeJsonArray, type Parsed } from "./context.ts";
import { loadSpec, novahizHome } from "../spec.ts";
import { getMeta, openDb, setMeta } from "../db.ts";
import { loadCatalog, loadInstalledSkills, persistCatalog, scanSkills, writeCatalog, writeSkillIndex } from "../catalog.ts";
import { rankSkills } from "../relevance.ts";
import { buildMcpEntries, enabledProviders, installCommands } from "../providers.ts";
import { bootstrapFor, checkDependencies, missingPrerequisites } from "../deps.ts";
import { classify } from "../classify.ts";
import { runCommand, runScript } from "../exec.ts";
import { activeTask, buildWorkPackets, getTask } from "../ledger.ts";

export function commandCheck(): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const index = loadInstalledSkills(spec);
  const db = openDb(dbPathFor(root, spec));
  const lastSync = getMeta(db, "last_sync");
  db.close();
  print({
    home: root,
    categories: spec.categories.length,
    rules: spec.rules.length,
    skillRoots: spec.config.skillRoots.length,
    installedSkills: index.skills.size,
    indexAvailable: index.available,
    lastSync,
    gate: spec.config.gate,
    classify: spec.config.classify
  });
}

export function commandSync(): void {
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

export function commandClassify(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const text = (parsed.positionals.slice(1).join(" ") || asString(parsed.flags.text)).trim();
  if (text.length === 0) {
    throw new Error("classify needs a prompt: pass it as an argument or with --text");
  }
  const result = classify(spec, text, {
    minScore: numberFlag(parsed, "min-score", { min: 0 }),
    maxCategories: numberFlag(parsed, "max-categories", { min: 1, integer: true })
  });
  print({ prompt: text, ...result });
}


export function commandSkills(parsed: Parsed): void {
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

export function commandCategories(): void {
  print(loadSpec().categories);
}

export function commandRules(): void {
  print(loadSpec().rules);
}

export function commandSessionLoad(parsed: Parsed): void {
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

export function commandSessionState(parsed: Parsed): void {
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


export function commandCatalog(parsed: Parsed): void {
  const spec = loadSpec();
  const query = parsed.positionals.slice(1).join(" ") || asString(parsed.flags.query);
  const limitRaw = numberFlag(parsed, "limit", { min: 1, integer: true });
  const limit = limitRaw !== undefined && limitRaw > 0 ? limitRaw : 10;
  const catalog = loadCatalog(spec);
  const results = rankSkills(catalog, query, limit);
  const hint = catalog.length === 0 ? "catalog is empty; run `novahiz sync` to build it" : undefined;
  print({ query, total: catalog.length, results, ...(hint ? { hint } : {}) });
}

export function commandRoadmap(parsed: Parsed): void {
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

export function commandStep(parsed: Parsed): void {
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

export function commandProviders(parsed: Parsed): void {
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

export function commandDeps(parsed: Parsed): void {
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


export function commandDispatch(parsed: Parsed): void {
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

