import { join } from "node:path";
import { asString, dbPathFor, flagOn, numberFlag, print, readStdin, safeJsonArray, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { getMeta, openDb, setMeta } from "../db.ts";
import { loadCatalog, loadInstalledSkills, persistCatalog, scanSkills, writeCatalog, writeSkillIndex } from "../catalog.ts";
import { rankSkills } from "../relevance.ts";
import { buildMcpEntries, enabledProviders, installCommands, pendingInstallCommands, updateCommands } from "../providers.ts";
import { spawnSync } from "node:child_process";
import { bootstrapFor, commandExists, coreBootstrap, dependencyReport, manualCoreBootstrap, missingPrerequisites, reloadPathFromRegistry, toolchainStatus } from "../deps.ts";
import { classify } from "../classify.ts";
import { isContinuation, isValidSessionId, readSessionClassification, writeSessionClassification } from "../session.ts";
import { bootstrapBinAllowed, runScript } from "../exec.ts";
import { activeTask, buildWorkPackets, getTask } from "../ledger.ts";

export function commandCheck(): void {
  const root = NovahizHome();
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
  const root = NovahizHome();
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
  const root = NovahizHome();
  const spec = loadSpec(root);
  // P0-B: --stdin keeps the prompt off argv — argv allowed option injection
  // (--home), broke past the Windows 32k limit, and leaked the prompt into
  // the process list. The slice bounds a hostile stdin (full fix in P2-C).
  const raw = flagOn(parsed, "stdin")
    ? readStdin().slice(0, 200_000)
    : parsed.positionals.slice(1).join(" ") || asString(parsed.flags.text);
  const text = raw.trim();
  if (text.length === 0) {
    throw new Error("classify needs a prompt: pass it as an argument or with --text");
  }
  const result = classify(spec, text, {
    minScore: numberFlag(parsed, "min-score", { min: 0 }),
    maxCategories: numberFlag(parsed, "max-categories", { min: 1, integer: true })
  });
  const session = asString(parsed.flags.session);
  if (!isValidSessionId(session)) {
    print({ prompt: text, ...result });
    return;
  }

  const db = openDb(dbPathFor(root, spec));
  try {
    const stored = readSessionClassification(db, session);
    // A trivial follow-up ("continue", "ok") inherits the last non-trivial
    // task of this session. Without this the plugin overwrote its categories
    // with general/trivial and the gate allowed every edit (missing: []).
    if (result.tier === "trivial" && stored && isContinuation(stored)) {
      const continued = classify(spec, stored.prompt, {
        minScore: numberFlag(parsed, "min-score", { min: 0 }),
        maxCategories: numberFlag(parsed, "max-categories", { min: 1, integer: true })
      });
      print({ prompt: text, ...continued, continuedFrom: stored.prompt });
      return;
    }
    if (result.tier !== "trivial") {
      writeSessionClassification(db, {
        session,
        categories: result.categories.map((entry) => entry.id),
        requiredSkills: result.enforcedSkills,
        tier: result.tier,
        prompt: text
      });
    }
  } finally {
    db.close();
  }
  print({ prompt: text, ...result });
}


export function commandSkills(parsed: Parsed): void {
  const root = NovahizHome();
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
  const root = NovahizHome();
  const spec = loadSpec(root);
  const session = asString(parsed.flags.session);
  const skill = asString(parsed.flags.skill);
  if (session.length === 0 || skill.length === 0) {
    print({ error: "session-load requires --session and --skill" });
    process.exitCode = 1;
    return;
  }
  // M12: basic session ID format validation (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) {
    print({ error: `invalid session ID format: "${session}" (expected alphanumeric, hyphens, underscores)` });
    process.exitCode = 1;
    return;
  }
  // P0-B: the plugin joins recorded names with commas and the gate re-splits
  // them — a loose name could inject extra "loaded" skills.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(skill)) {
    print({ error: `invalid skill name format: "${skill.slice(0, 64)}"` });
    process.exitCode = 1;
    return;
  }
  // P0-B: only skills present in the installed index may count as loaded.
  // An unreadable index cannot verify anything — accept the record (the gate
  // degrades on its own side via indexMissing).
  const installed = loadInstalledSkills(spec);
  if (installed.available && !installed.skills.has(skill)) {
    print({ error: `unknown skill "${skill}" — not in the installed index. Run "novahiz sync" to rebuild it.` });
    process.exitCode = 1;
    return;
  }
  const db = openDb(dbPathFor(root, spec));
  // H5: ensure session exists for FK compliance
  const ts = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(session, ts);
  db.prepare("INSERT OR IGNORE INTO skill_invocations (session_id, skill, invoked_at) VALUES (?, ?, ?)").run(
    session,
    skill,
    new Date().toISOString()
  );
  db.close();
  print({ session, loaded: skill });
}

export function commandSessionState(parsed: Parsed): void {
  const root = NovahizHome();
  const spec = loadSpec(root);
  const session = asString(parsed.flags.session);
  if (session.length === 0) {
    print({ error: "session-state requires --session <id>" });
    process.exitCode = 1;
    return;
  }
  // H6: validate session ID format
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) {
    print({ error: `invalid session ID format: "${session}" (expected alphanumeric, hyphens, underscores)` });
    process.exitCode = 1;
    return;
  }
  const db = openDb(dbPathFor(root, spec));
  const loaded = (db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(session) as { skill: string }[]).map(
    (row) => row.skill
  );
  const state = db.prepare("SELECT categories, required_skills, prompt, tier, updated_at FROM sessions WHERE id = ?").get(session) as
    | { categories: string; required_skills: string; prompt: string | null; tier: string | null; updated_at: string }
    | undefined;
  db.close();
  print({
    session,
    loaded,
    categories: state ? safeJsonArray(state.categories) : [],
    requiredSkills: state ? safeJsonArray(state.required_skills) : [],
    prompt: state?.prompt ?? "",
    tier: state?.tier ?? null,
    updatedAt: state?.updated_at ?? null
  });
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
  const root = NovahizHome();
  const spec = loadSpec(root);
  const session = asString(parsed.flags.session);
  const done = asString(parsed.flags.done);
  if (session.length === 0) {
    print({ error: "step requires --session <id>" });
    process.exitCode = 1;
    return;
  }
  // H6: validate session ID format
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) {
    print({ error: `invalid session ID format: "${session}" (expected alphanumeric, hyphens, underscores)` });
    process.exitCode = 1;
    return;
  }
  // WS3: the step id follows the roadmap naming pattern (plan, write,
  // impeccable-critique) — reject anything else before it reaches the database.
  if (done.length > 0 && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(done)) {
    print({ error: `invalid step id format: "${done}" (expected alphanumeric, hyphens, underscores, dots)` });
    process.exitCode = 1;
    return;
  }
  const db = openDb(dbPathFor(root, spec));
  if (done.length > 0) {
    const ts = new Date().toISOString();
    // roadmap_progress.session_id has a foreign key to sessions(id):
    // ensure the session row exists before recording a step.
    db.prepare("INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(session, ts);
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
    const entries = installCommands(spec);
    if (!flagOn(parsed, "yes")) {
      // Dry run by default: the catalog is not signed, so the plan is shown
      // and nothing executes until --yes is passed explicitly.
      print({
        plan: entries.map((entry) => ({ id: entry.id, kind: entry.kind, command: entry.command.join(" "), source: entry.source })),
        note: "dry run: pass --yes to execute"
      });
      return;
    }
    const results: Record<string, unknown>[] = [];
    for (const entry of entries) {
      // runScript applies the binary allowlist and the code-runner guard:
      // catalog argv may only start a known packager/interpreter.
      const result = runScript(entry.command);
      process.stdout.write(`${result.ok ? "ok  " : "fail"} ${entry.id} (${entry.kind}) ${entry.command.join(" ")}\n`);
      if (!result.ok && result.stderr) process.stderr.write(result.stderr);
      if (result.error) process.stderr.write(`${result.error}\n`);
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
  const root = NovahizHome();
  const spec = loadSpec();
  const report = dependencyReport(spec, root);
  if (!parsed.flags.install) {
    print({ node: process.version, platform: process.platform, ...report });
    return;
  }

  // --core-only: the installer's path when the user declined providers —
  // system dependencies (toolchain + npm health) still install automatically.
  const coreOnly = flagOn(parsed, "core-only");
  const corePlan = coreBootstrap()
    .filter((entry) => report.toolchain.find((tool) => tool.id === entry.id)?.ok === false)
    .map((entry) => ({
      ...entry,
      command: entry.argv.join(" "),
      // Un bootstrap sudo ou un script telecharge execute par un shell n'est
      // jamais lance : affiche, il reste une etape manuelle.
      manual: manualCoreBootstrap(entry.argv) || !commandExists(entry.argv[0])
    }));
  const npmPlan = report.npm.ok ? [] : [{ step: "npm", missing: report.npm.missing, note: report.npm.note }];
  const bootstrapPlan = missingPrerequisites(spec).map((entry) => {
    const bootstrap = bootstrapFor(entry.provider);
    return bootstrap && bootstrap.length > 0
      ? {
          provider: entry.provider.id,
          step: "bootstrap",
          command: bootstrap.join(" "),
          // Hors allowlist de runScript (sudo, brew, winget, shell) : la
          // commande est affichee, pas executee.
          manual: !bootstrapBinAllowed(bootstrap[0])
        }
      : { provider: entry.provider.id, step: "bootstrap", note: `missing ${entry.missing.join(", ")}` };
  });
  const installed = new Set(scanSkills(spec, []).map((skill) => skill.id));
  // --update: refresh every pack from upstream instead of skipping the ones
  // already present. Without it, pendingInstallCommands drops installed packs,
  // so /novahiz-skills-update could never bring flutter/dart/expo up to date.
  const updating = flagOn(parsed, "update");
  const pending = updating ? updateCommands(spec) : pendingInstallCommands(spec, installed);
  const installPlan = pending.map((entry) => ({
    provider: entry.id,
    step: updating ? "update" : "install",
    command: entry.command.join(" "),
    // Present in the dry run too: a shared `skills update -g` collapsed onto a
    // single plan line must still name every pack it will refresh, otherwise
    // the plan hides three of the four providers it actually covers.
    ...(entry.covers ? { covers: entry.covers } : {})
  }));

  if (!flagOn(parsed, "yes")) {
    // Dry run by default: show what would run without touching the machine;
    // --yes opts into execution explicitly.
    print({ core: corePlan, npm: npmPlan, bootstrap: bootstrapPlan, install: installPlan, note: "dry run: pass --yes to execute" });
    return;
  }

  const results: Record<string, unknown>[] = [];

  // 1. Core toolchain — argv source-owned (deps.ts coreBootstrap), executed
  // through a plain spawn: runScript's catalog allowlist deliberately refuses
  // shells and package managers, and this argv never comes from the catalog.
  for (const entry of corePlan) {
    if (entry.manual) {
      process.stdout.write(`manual core ${entry.id} - run: ${entry.command}\n`);
      results.push({ step: "core", tool: entry.id, command: entry.command, ok: false, manual: true });
      continue;
    }
    const result = spawnSync(entry.argv[0], entry.argv.slice(1), { encoding: "utf8", windowsHide: true });
    const ok = result.status === 0;
    process.stdout.write(`${ok ? "ok  " : "fail"} core ${entry.id}\n`);
    if (!ok && result.stderr) process.stderr.write(result.stderr);
    results.push({ step: "core", tool: entry.id, command: entry.argv.join(" "), ok });
  }

  // A fresh install lands outside the current PATH (uv in ~/.local/bin, the
  // Python installer under %LocalAppData%): reload the PATH from the registry
  // before re-probing, or the verification reports a false "still missing"
  // for something that just installed fine.
  if (process.platform === "win32" && corePlan.length > 0) {
    reloadPathFromRegistry();
    const still = toolchainStatus().filter((tool) => !tool.ok).map((tool) => tool.id);
    const ok = still.length === 0;
    process.stdout.write(`${ok ? "ok  " : "warn"} core verify: ${ok ? "all present" : `still missing ${still.join(", ")}`}\n`);
    results.push({ step: "core", verify: ok ? "all present" : `still missing: ${still.join(", ")}`, ok });
  }

  if (coreOnly) {
    print(results);
    return;
  }

  // 2. npm health: a declared package without its node_modules folder, or a
  // missing lockfile -> npm install, scoped to the home (never the global
  // prefix) and --ignore-scripts so nothing in home re-enters the installer.
  if (!report.npm.ok) {
    const result = spawnSync("npm", ["install", "--ignore-scripts"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, npm_config_global: "false" }
    });
    const ok = result.status === 0;
    process.stdout.write(`${ok ? "ok  " : "fail"} npm install (${report.npm.missing.length} missing)\n`);
    if (!ok && result.stderr) process.stderr.write(result.stderr);
    results.push({ step: "npm", ok, missing: report.npm.missing, note: report.npm.note });
  }

  // 3. Catalog bootstrap (provider requires) — runScript applies the binary
  // allowlist and the code-runner guard: catalog argv may only start a known
  // packager/interpreter.
  for (const entry of missingPrerequisites(spec)) {
    const bootstrap = bootstrapFor(entry.provider);
    if (!bootstrap || bootstrap.length === 0) {
      results.push({ provider: entry.provider.id, step: "bootstrap", ok: false, note: `missing ${entry.missing.join(", ")}` });
      continue;
    }
    if (!bootstrapBinAllowed(bootstrap[0])) {
      // sudo, brew, winget, shell : hors de l'allowlist, jamais executes.
      process.stdout.write(`manual bootstrap ${entry.provider.id} - run: ${bootstrap.join(" ")}\n`);
      results.push({ provider: entry.provider.id, step: "bootstrap", command: bootstrap.join(" "), ok: false, manual: true });
      continue;
    }
    const result = runScript(bootstrap);
    process.stdout.write(`${result.ok ? "ok  " : "fail"} bootstrap ${entry.provider.id}\n`);
    if (!result.ok && result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${result.error}\n`);
    results.push({ provider: entry.provider.id, step: "bootstrap", command: bootstrap.join(" "), ok: result.ok });
  }

  // 4. Provider installs — pendingInstallCommands already dropped the packs
  // whose installedWhen skills are all on disk: a re-run installs nothing.
  // In --update mode nothing is skipped: refreshing an installed pack is the
  // requested behaviour, so every update command runs and reports as "update".
  const pendingIds = new Set(pending.map((entry) => entry.id));
  const skipped = updating ? [] : installCommands(spec).filter((entry) => !pendingIds.has(entry.id)).map((entry) => entry.id);
  if (skipped.length > 0) {
    results.push({ step: "install", skipped, note: "already installed (installedWhen satisfied)" });
  }
  for (const entry of pending) {
    const result = runScript(entry.command);
    const step = updating ? "update" : "install";
    process.stdout.write(`${result.ok ? "ok  " : "fail"} ${step} ${entry.id}\n`);
    if (!result.ok && result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${result.error}\n`);
    results.push({
      provider: entry.id,
      step,
      command: entry.command.join(" "),
      ...(entry.covers ? { covers: entry.covers } : {}),
      ok: result.ok
    });
  }
  print(results);
}


export function commandDispatch(parsed: Parsed): void {
  const root = NovahizHome();
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

