import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { dbPathFor, emit, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { openDb, SCHEMA_VERSION } from "../db.ts";
import { loadInstalledSkills } from "../catalog.ts";
import { evaluateGate } from "../gate.ts";
import { DEFAULT_LIMIT_CHARS, DEFAULT_LIMIT_LINES, MEMORY_DIR } from "../memory.ts";
import * as ui from "../render.ts";

type DoctorCheck = { id: string; label: string; ok: boolean; detail: string; blocking: boolean };

const SKILL_CLI: Record<string, string> = {};

function hasCommand(name: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [name], { encoding: "utf8", shell: false });
  return result.status === 0;
}

export function grantsQuestionIn(agentFile: string): boolean {
  return /^\s*question:\s*allow\s*$/m.test(agentFile);
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
  // Skill packs (kind: "skill") are delivery mechanisms, not index entries:
  // their id ("flutter-skills", "expo-skills") never matches a SKILL.md name,
  // so adding it made this check permanently red. Pack skills land in the
  // index individually and are referenced through categories and rules above.
  return [...ids].sort();
}

export function commandDoctor(parsed: Parsed): void {
  const root = NovahizHome();
  const spec = loadSpec(root);
  const checks: DoctorCheck[] = [];

  const parts = process.versions.node.split(".").map((value) => Number(value));
  const nodeOk = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 18);
  checks.push({ id: "node", label: "Node 22.18+", ok: nodeOk, detail: `v${process.versions.node}`, blocking: true });
  checks.push({ id: "npx", label: "npx available", ok: hasCommand("npx"), detail: "required by MCP providers", blocking: true });

  const index = loadInstalledSkills(spec);
  checks.push({
    id: "index",
    label: "Skills index",
    ok: index.available,
    detail: index.available ? `${index.skills.size} skills` : "build/installed-skills.json unreadable, run novahiz sync",
    blocking: true
  });

  const referenced = referencedSkills(spec);
  const absent = index.available ? referenced.filter((id) => !index.skills.has(id)) : [];
  checks.push({
    id: "referenced",
    label: "Referenced skills",
    ok: absent.length === 0,
    detail: absent.length === 0 ? `${referenced.length} present` : `missing from index: ${absent.join(", ")}`,
    blocking: absent.length > 0
  });

  // SKILL_CLI is intentionally empty: novahiz-web-extract replaced the external
  // defuddle CLI on the research roadmap (see MEMORY.md). Keep the check so a
  // future external dependency is wired here again.
  const cliEntries = Object.entries(SKILL_CLI);
  const missingCli = cliEntries
    .filter(([skill]) => referenced.includes(skill) && !hasCommand(skill))
    .map(([, cli]) => cli);
  checks.push({
    id: "cli",
    label: "Required external CLI",
    ok: missingCli.length === 0,
    detail:
      missingCli.length > 0
        ? `not found: ${missingCli.join(", ")}`
        : cliEntries.length === 0
          ? "none required (web-extract replaced defuddle)"
          : "all present",
    blocking: missingCli.length > 0
  });

  const probe = evaluateGate({
    tool: "edit",
    filePath: "README.md",
    content: "This README paragraph is long enough prose for the content rules to match and demand a loaded skill.",
    categories: [],
    loadedSkills: [],
    installedSkills: index.skills,
    installedIndexAvailable: index.available,
    spec
  });
  const gateOk = spec.rules.length === 0 || (probe.allow === false && probe.missingSkills.length > 0);
  checks.push({
    id: "gate",
    label: "Operational gate",
    ok: gateOk,
    detail: gateOk ? `blocks a write without a loaded skill (${probe.missingSkills.join(", ")})` : "did not block a write without a loaded skill",
    blocking: true
  });

  const dbFile = dbPathFor(root, spec);
  let dbOk = false;
  let dbDetail = "missing";
  try {
    const size = statSync(dbFile).size;
    const db = openDb(dbFile);
    db.prepare("SELECT COUNT(*) AS n FROM enforcement_log").get();
    db.close();
    dbOk = true;
    dbDetail = ui.bytes(size);
  } catch (error) {
    dbDetail = `unreadable: ${(error as Error).message}`;
  }
  checks.push({ id: "db", label: "Registry database", ok: dbOk, detail: dbDetail, blocking: false });

  // Informational only: openDb migrates on open, so the stored version always
  // matches by the time this reads it. The value is read so a future migration
  // has something to branch on, and so a database from an older build shows up.
  let schemaDetail = "database unreadable";
  try {
    const db = openDb(dbFile);
    const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
    const version = Number(row?.user_version ?? 0);
    db.close();
    schemaDetail = `version ${version} (expected ${SCHEMA_VERSION})`;
  } catch (error) {
    schemaDetail = `unreadable: ${(error as Error).message}`;
  }
  checks.push({ id: "schema", label: "Schema version", ok: true, detail: schemaDetail, blocking: false });

  const adapterSource = join(root, "adapters", "opencode", "novahiz.ts");
  const opencodeDir =
    process.env.OPENCODE_CONFIG_DIR && process.env.OPENCODE_CONFIG_DIR.length > 0
      ? process.env.OPENCODE_CONFIG_DIR
      : join(homedir(), ".config", "opencode");
  const adapterInstalled = join(opencodeDir, "plugins", "novahiz.ts");
  let adapterOk = true;
  let adapterDetail = "no installed copy";
  if (existsSync(adapterSource) && existsSync(adapterInstalled)) {
    adapterOk = readFileSync(adapterSource, "utf8") === readFileSync(adapterInstalled, "utf8");
    adapterDetail = adapterOk ? "plugin harness copy up to date" : "plugin harness copy outdated, rerun installer then restart opencode";
  }
  checks.push({ id: "adapter", label: "Plugin harness copy", ok: adapterOk, detail: adapterDetail, blocking: false });

  const memoryModule = join(root, "src", "memory.ts");
  const memoryOk = existsSync(memoryModule) && DEFAULT_LIMIT_CHARS === 8000 && DEFAULT_LIMIT_LINES === 200;
  checks.push({
    id: "memory",
    label: "Memory module",
    ok: memoryOk,
    detail: memoryOk
      ? `${MEMORY_DIR}/ slots ${DEFAULT_LIMIT_CHARS} chars / ${DEFAULT_LIMIT_LINES} lines`
      : "src/memory.ts missing or limits changed",
    blocking: false
  });

  const mcpEntry = join(root, "mcp", "novahiz-tools", "index.mjs");
  let memoryToolsOk = false;
  let memoryToolsDetail = "mcp entry missing";
  if (existsSync(mcpEntry)) {
    const source = readFileSync(mcpEntry, "utf8");
    const tools = ["memory_write", "memory_list", "memory_get", "memory_init", "memory_rebuild"];
    const missing = tools.filter((name) => !source.includes(`"${name}"`));
    memoryToolsOk = missing.length === 0;
    memoryToolsDetail = memoryToolsOk ? "5 memory_* tools registered" : `missing: ${missing.join(", ")}`;
  }
  checks.push({ id: "memory-tools", label: "MCP memory tools", ok: memoryToolsOk, detail: memoryToolsDetail, blocking: false });

  const agentSource = join(root, "adapters", "opencode", "agent", "novahiz.md");
  const agentInstalled = join(opencodeDir, "agent", "novahiz.md");
  let agentOk = true;
  let agentDetail = "no installed copy";
  if (existsSync(agentSource) && existsSync(agentInstalled)) {
    const installed = readFileSync(agentInstalled, "utf8");
    const inSync = installed === readFileSync(agentSource, "utf8");
    const grantsQuestion = grantsQuestionIn(installed);
    agentOk = inSync && grantsQuestion;
    agentDetail = !inSync
      ? "agent harness copy outdated, rerun installer then restart opencode"
      : grantsQuestion
        ? "agent harness copy up to date, question allowed"
        : "agent harness copy does not allow question: pipeline cannot query";
  }
  checks.push({ id: "agent", label: "Agent harness copy", ok: agentOk, detail: agentDetail, blocking: false });

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
        ["check", "status", "detail"],
        checks.map((check) => [check.label, check.ok ? ui.status(true) : ui.status(false), check.detail])
      ),
      "",
      blocking.length > 0
        ? ui.style("red", `${blocking.length} blocking anomaly/anomalies: ${blocking.map((check) => check.id).join(", ")}`)
        : ui.style("green", "No blocking anomaly.")
    ].join("\n")
  );

  if (blocking.length > 0) process.exitCode = 1;
}


