import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { dbPathFor, emit, flagOn, type Parsed } from "./context.ts";
import { expandHome, loadSpec, NovahizHome, packageRoot } from "../spec.ts";
import { openDb, SCHEMA_VERSION } from "../db.ts";
import { loadInstalledSkills } from "../catalog.ts";
import { findContextFile } from "../impeccable.ts";
import { evaluateGate } from "../gate.ts";
import {
  DEFAULT_LIMIT_CHARS,
  DEFAULT_LIMIT_LINES,
  MEMORY_DIR,
  ensureMemoryRoot,
  getSlot,
  rebuildIndex,
  writeEntry
} from "../memory.ts";
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

// S5: probe reel du cycle memoire (init -> write -> get -> rebuild) sur une
// racine temporaire, nettoyee dans tous les cas. Opt-in via --deep, non
// bloquant: le CLI reste utilisable meme si la memoire est cassee.
function memoryLifecycleProbe(): DoctorCheck {
  const root = mkdtempSync(join(tmpdir(), "novahiz-doctor-"));
  try {
    const initialized = ensureMemoryRoot(root);
    const written = writeEntry({ root, title: "doctor deep probe", content: "ligne de probe doctor" });
    const fetched = getSlot("slot-001", root);
    const rebuilt = rebuildIndex(root);
    const ok =
      initialized.slots.length === 0 &&
      written.created === true &&
      written.confidence === "low" &&
      written.slot.id === "slot-001" &&
      fetched.body.details.includes("ligne de probe doctor") &&
      rebuilt.slots.length === 1;
    return {
      id: "memory-probe",
      label: "Memory lifecycle probe",
      ok,
      detail: ok
        ? "init -> write -> get -> rebuild ok (temp cleaned)"
        : `probe failed: init ${initialized.slots.length} slot(s), write ${written.slot.id} created=${written.created} confidence=${written.confidence}, rebuilt ${rebuilt.slots.length} slot(s)`,
      blocking: false
    };
  } catch (error) {
    return {
      id: "memory-probe",
      label: "Memory lifecycle probe",
      ok: false,
      detail: `probe error: ${(error as Error).message}`,
      blocking: false
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── MCP configuration health (0.3.6) ───────────────────────────────────────
// Three real incidents motivated this: a purged context7 npx shim, a broken
// graft install, and a security-mcp running without its auth secret. All were
// only discovered mid-session. These checks are read-only and non-blocking —
// the CLI must stay usable on machines without an OpenCode install.

/** JSONC → JSON: strips // and block comments plus trailing commas,
 *  string-aware so URLs and globs inside values survive. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  try {
    return JSON.parse(out);
  } catch {
    // Trailing comma pass, only when the strict parse already failed.
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  }
}

/** Resolve a command word or path to a full spawnable path, else null.
 *  PATH lookups must return the real file: CreateProcess appends .exe for a
 *  bare name but refuses .cmd/.bat (npx), so the probe needs the full path. */
function resolveExecutable(cmd: string): string | null {
  const looksPath = cmd.includes("/") || cmd.includes("\\") || cmd.startsWith("~");
  if (looksPath) {
    const full = expandHome(cmd);
    return existsSync(full) ? full : null;
  }
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [cmd], { encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  const lines = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  if (process.platform === "win32") {
    // `where` also matches extensionless Git-Bash scripts (nodejs\npx,
    // flutter\bin\dart) that CreateProcess refuses — prefer a real binary.
    return lines.find((line) => /\.(exe|cmd|bat|com)$/i.test(line)) ?? null;
  }
  return lines[0];
}

/** Pure per-server config problems (exported for tests). */
export function mcpEntryProblems(
  name: string,
  entry: Record<string, unknown>,
  catalogPackages: Map<string, string>,
  env: Record<string, string | undefined>
): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  if (entry.enabled === false) return { problems, notes };
  // ${VAR} references must resolve in the environment the CLI runs with.
  for (const match of JSON.stringify(entry).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    if (!env[match[1]]) problems.push(`${name}: env ${match[1]} not set`);
  }
  const command = Array.isArray(entry.command) ? (entry.command as unknown[]).map(String) : [];
  if (command.length === 0) {
    // Remote MCP servers (type: remote) are URL-based and legitimately carry
    // no command — validate the URL instead of failing them as broken locals.
    const url = typeof entry.url === "string" ? entry.url : "";
    if (!url) {
      problems.push(`${name}: no command`);
      return { problems, notes };
    }
    if (!/^https:\/\//.test(url)) problems.push(`${name}: remote url is not https`);
    else notes.push(`${name}: remote (${new URL(url).host})`);
    return { problems, notes };
  }
  if (!resolveExecutable(command[0])) problems.push(`${name}: executable not found (${command[0]})`);
  const configPkg = command.find((arg) => /@\d/.test(arg) && !arg.startsWith("-"));
  const catalogPkg = catalogPackages.get(name);
  if (catalogPkg && configPkg && configPkg !== catalogPkg) {
    problems.push(`${name}: pinned to ${configPkg}, catalog pins ${catalogPkg}`);
  } else if (catalogPkg && !configPkg) {
    // A bare shim can drift from the pinned catalog version — surface, don't fail.
    const catalogBase = catalogPkg.slice(0, catalogPkg.lastIndexOf("@")) || catalogPkg;
    if (command[0] !== "npx" && command[0] !== catalogBase) {
      problems.push(`${name}: runs ${command[0]}, catalog expects ${catalogBase}`);
    } else {
      notes.push(`${name}: unpinned (catalog: ${catalogPkg})`);
    }
  }
  if (command[0] === "npx") {
    if (!command.includes("-y")) notes.push(`${name}: npx without -y`);
    const pkg = command.slice(1).find((arg) => !arg.startsWith("-"));
    if (pkg && !/@\d/.test(pkg)) notes.push(`${name}: npx package unpinned (${pkg})`);
  }
  return { problems, notes };
}

/** Kill a probed server and its whole tree (cmd.exe → npx → node). */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { encoding: "utf8" });
  } else {
    child.kill("SIGTERM");
  }
}

/** One live JSON-RPC `initialize` probe per server. Opt-in via --deep, up to
 *  10 s per server, all servers probed in parallel. Local entries are spawned
 *  with stdin kept OPEN: mcp-cron reads stdin asynchronously and exits cleanly
 *  (status 0, no output) if the pipe closes before it starts reading. Remote
 *  entries (type: remote) get one HTTP initialize round-trip instead. */
export function probeMcpServer(entry: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  const command = Array.isArray(entry.command) ? (entry.command as unknown[]).map(String) : [];
  if (command.length === 0) {
    const url = typeof entry.url === "string" ? entry.url : "";
    if (!url) return Promise.resolve({ ok: false, detail: "no command" });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    };
    for (const [key, value] of Object.entries((entry.headers as Record<string, unknown> | undefined) ?? {})) {
      headers[key] = String(value);
    }
    const started = Date.now();
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "novahiz-doctor", version: "0" } }
      }),
      signal: AbortSignal.timeout(10_000)
    })
      .then((response) =>
        response.ok
          ? { ok: true, detail: `remote initialize ${response.status} (${Date.now() - started} ms)` }
          : { ok: false, detail: `remote initialize HTTP ${response.status}` }
      )
      .catch((error: unknown) => ({ ok: false, detail: `remote: ${(error as Error).message}` }));
  }
  return new Promise((resolve) => {
    const resolved = resolveExecutable(command[0]);
    if (!resolved) {
      resolve({ ok: false, detail: `executable not found (${command[0]})` });
      return;
    }
    const args = command.slice(1);
    const init = `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "novahiz-doctor", version: "0" } }
    })}\n`;
    const env = { ...process.env, ...((entry.environment as Record<string, string> | undefined) ?? {}) };
    const started = Date.now();
    // Node refuses to exec .cmd/.bat directly (EINVAL). Go through ComSpec
    // verbatim: the whole `"path" args` line gets one extra quote pair, which
    // `cmd /d /s /c` strips back off. No shell flag — tests/exec.test.ts bans
    // the shell option repo-wide — and no Node re-quoting layer
    // (windowsVerbatimArguments).
    const shellRequired = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);
    const quote = (arg: string) => (/\s|"/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);
    const inner = [`"${resolved}"`, ...args.map(quote)].join(" ");
    let child: ReturnType<typeof spawn>;
    try {
      child = shellRequired
        ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${inner}"`], {
            env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsVerbatimArguments: true
          })
        : spawn(resolved, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ ok: false, detail: `spawn failed: ${(error as Error).message}` });
      return;
    }
    let settled = false;
    let buffer = "";
    let errBuffer = "";
    const settle = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      resolve({ ok, detail });
    };
    const timer = setTimeout(() => {
      settle(false, `no initialize response in ${Date.now() - started} ms (timeout)`);
    }, 10_000);
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      for (const line of buffer.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const message = JSON.parse(trimmed) as {
            id?: number;
            result?: { serverInfo?: { name?: string; version?: string } };
            error?: unknown;
          };
          const elapsed = Date.now() - started;
          if (message.result?.serverInfo) {
            const info = message.result.serverInfo;
            settle(true, `${info.name ?? "?"}${info.version ? `@${info.version}` : ""} (${elapsed} ms)`);
            return;
          }
          if (message.id === 1) {
            settle(true, `initialize acknowledged (${elapsed} ms)`);
            return;
          }
          if (message.error) {
            settle(false, `initialize error: ${JSON.stringify(message.error).slice(0, 120)}`);
            return;
          }
        } catch {
          // stdout noise (logs) — keep scanning.
        }
      }
      // Keep memory bounded on chatty servers.
      if (buffer.length > 262_144) buffer = buffer.slice(-65_536);
    });
    child.stderr?.on("data", (chunk) => {
      if (errBuffer.length < 16_384) errBuffer += String(chunk);
    });
    child.on("error", (error) => {
      settle(false, `spawn failed: ${error.message}`);
    });
    child.on("close", (code) => {
      if (settled) return;
      const elapsed = Date.now() - started;
      const tail = errBuffer.trim() ? ` — ${errBuffer.trim().slice(0, 160)}` : "";
      settle(false, `exited (code ${code}) after ${elapsed} ms without responding${tail}`);
    });
    child.stdin?.on("error", () => {
      // Server closed its side first — the close handler reports it.
    });
    child.stdin?.write(init);
    // Intentionally no stdin.end(): keep the pipe open until we have a reply.
  });
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

/** Referenced-skills row. Exported for tests.
 *  `indexSkills` is null when the index is unreadable — the index check already
 *  reports that, so the row stays quiet instead of double-failing.
 *  Only skills the package ships (packageRoot/skills) can make a fresh install
 *  broken. The remaining references — the dart/eas/expo/flutter packs and
 *  impeccable — are optional delivery downloaded on request and are simply not
 *  present on a machine that never asked for them; the gate already degrades
 *  them to "not enforced". Blocking on them turned every healthy fresh install
 *  red (`missing from index: dart-...` right after novahiz-install --yes). */
export function referencedSkillsCheck(
  spec: ReturnType<typeof loadSpec>,
  indexSkills: Set<string> | null,
  packageRootDir: string
): DoctorCheck {
  const referenced = referencedSkills(spec);
  const absent = indexSkills ? referenced.filter((id) => !indexSkills.has(id)) : [];
  const shipped = new Set<string>();
  const shippedDir = join(packageRootDir, "skills");
  if (existsSync(shippedDir)) {
    for (const entry of readdirSync(shippedDir, { withFileTypes: true })) {
      if (entry.isDirectory()) shipped.add(entry.name);
    }
  }
  const absentShipped = absent.filter((id) => shipped.has(id));
  const absentPack = absent.length - absentShipped.length;
  return {
    id: "referenced",
    label: "Referenced skills",
    ok: absentShipped.length === 0,
    detail:
      absent.length === 0
        ? `${referenced.length} present`
        : absentShipped.length > 0
          ? `missing from index: ${absent.join(", ")}`
          : `${referenced.length - absent.length} present, ${absentPack} pack skills not installed (novahiz-install --dart-skills --flutter-skills)`,
    blocking: absentShipped.length > 0
  };
}

/** Impeccable design-context checks: PRODUCT.md and DESIGN.md resolution
 *  (root -> .agents/context -> docs/). Rows appear only when the impeccable
 *  skill is installed (opt-in) and are never blocking: a missing record is a
 *  command to run
 *  (`/impeccable init`, `/impeccable document`), not an anomaly. Exported for tests. */
export function impeccableChecks(cwd: string, installed: boolean): DoctorCheck[] {
  if (!installed) return [];
  const rel = (path: string): string => relative(cwd, path).split("\\").join("/");
  const product = findContextFile(cwd, "PRODUCT.md");
  const design = findContextFile(cwd, "DESIGN.md");
  return [
    {
      id: "impeccable-context",
      label: "Impeccable product context",
      ok: product !== null,
      detail: product ? `${rel(product)} present` : "no PRODUCT.md - run /impeccable init to capture audience, goals and constraints",
      blocking: false
    },
    {
      id: "impeccable-design",
      label: "Impeccable design record",
      ok: design !== null,
      detail: design ? `${rel(design)} present` : "no DESIGN.md - run /impeccable document to record an existing visual system",
      blocking: false
    }
  ];
}

export async function commandDoctor(parsed: Parsed): Promise<void> {
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

  checks.push(referencedSkillsCheck(spec, index.available ? index.skills : null, packageRoot() ?? root));

  // SKILL_CLI is intentionally empty: novahiz-web-extract replaced the external
  // defuddle CLI on the research roadmap (see MEMORY.md). Keep the check so a
  // future external dependency is wired here again.
  const referenced = referencedSkills(spec);
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

  // Two probes, one per live enforcement layer, both deterministic against the
  // current ruleset (the old single probe fed README.md with empty categories,
  // which matches no rule since the prose content rules were removed):
  // - path probe: R13/R14 match a style file through pathGlobs alone.
  // - category probe: R6 matches a classified code prompt; tier is set
  //   explicitly because probe text is file content, not a prompt, and
  //   determineTier would call it trivial and skip R6.
  const probeInput = {
    tool: "edit",
    content: "",
    categories: [] as string[],
    loadedSkills: [] as string[],
    installedSkills: index.skills,
    installedIndexAvailable: index.available,
    spec
  };
  const pathProbe = evaluateGate({ ...probeInput, filePath: "src/hero.css" });
  const classProbe = evaluateGate({
    ...probeInput,
    filePath: "README.md",
    categories: ["code"],
    tier: "full"
  });
  const blocked = (r: typeof pathProbe) => r.allow === false && r.missingSkills.length > 0;
  const gateOk = spec.rules.length === 0 || (blocked(pathProbe) && blocked(classProbe));
  const probeSkills = [...new Set([...pathProbe.missingSkills, ...classProbe.missingSkills])];
  checks.push({
    id: "gate",
    label: "Operational gate",
    ok: gateOk,
    detail: gateOk ? `blocks a write without a loaded skill (${probeSkills.join(", ")})` : "did not block a write without a loaded skill",
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
    const tools = ["memory_write", "memory_update", "memory_archive", "memory_list", "memory_get", "memory_search", "memory_init", "memory_rebuild"];
    const missing = tools.filter((name) => !source.includes(`"${name}"`));
    memoryToolsOk = missing.length === 0;
    memoryToolsDetail = memoryToolsOk ? "8 memory_* tools registered" : `missing: ${missing.join(", ")}`;
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

  // Impeccable rows appear only when the skill is installed (opt-in) and only
  // reflect this project's context files.
  checks.push(...impeccableChecks(process.cwd(), index.available && index.skills.has("impeccable")));

  const opencodeConfigPath = join(opencodeDir, "opencode.jsonc");
  const catalogPackages = new Map<string, string>();
  for (const provider of spec.providers) {
    if (provider.kind !== "mcp" || !provider.command) continue;
    const pkg = provider.command.find((arg) => /@\d/.test(arg) && !arg.startsWith("-"));
    if (pkg) catalogPackages.set(provider.id, pkg);
  }
  const disabledProviders = spec.config.providers?.disabled ?? [];
  let mcpEntries: Array<{ name: string; entry: Record<string, unknown> }> = [];
  const mcpProblems: string[] = [];
  const mcpNotes: string[] = [];
  if (!existsSync(opencodeConfigPath)) {
    mcpNotes.push(`no ${opencodeConfigPath}`);
  } else {
    try {
      const document = parseJsonc(readFileSync(opencodeConfigPath, "utf8")) as {
        mcp?: Record<string, unknown>;
        mcpServers?: Record<string, unknown>;
      };
      const servers = document.mcp ?? document.mcpServers ?? {};
      mcpEntries = Object.entries(servers).map(([name, entry]) => ({ name, entry: (entry ?? {}) as Record<string, unknown> }));
      for (const { name, entry } of mcpEntries) {
        const result = mcpEntryProblems(name, entry, catalogPackages, process.env);
        mcpProblems.push(...result.problems);
        mcpNotes.push(...result.notes);
      }
      const configured = new Set(mcpEntries.map(({ name }) => name));
      for (const provider of spec.providers) {
        if (provider.kind !== "mcp" || disabledProviders.includes(provider.id) || configured.has(provider.id)) continue;
        mcpNotes.push(`${provider.id}: not in opencode.jsonc (registered by the plugin at startup)`);
      }
      if (!disabledProviders.includes("security") && !process.env.SECURITY_MCP_SHARED_SECRET) {
        mcpProblems.push("security: SECURITY_MCP_SHARED_SECRET not set — security-mcp runs unauthenticated");
      }
    } catch (error) {
      mcpProblems.push(`opencode.jsonc unreadable: ${(error as Error).message}`);
    }
  }
  checks.push({
    id: "mcp-config",
    label: "MCP config",
    ok: mcpProblems.length === 0,
    detail:
      mcpProblems.length > 0
        ? mcpProblems.join("; ")
        : mcpEntries.length === 0
          ? "no server entries"
          : `${mcpEntries.length} servers${mcpNotes.length > 0 ? ` — ${mcpNotes.join("; ")}` : ""}`,
    blocking: false
  });

  // Live probe: explicit opt-in, because npx cold caches can exceed the 10 s
  // per-server budget and a false negative would be worse than no probe.
  if (flagOn(parsed, "deep")) {
    const targets = mcpEntries.filter(({ entry }) => entry.enabled !== false);
    const results = await Promise.all(
      targets.map(async ({ name, entry }) => ({ name, probe: await probeMcpServer(entry) }))
    );
    const probes: string[] = [];
    const probeFailures: string[] = [];
    for (const { name, probe } of results) {
      (probe.ok ? probes : probeFailures).push(`${name}: ${probe.detail}`);
    }
    checks.push({
      id: "mcp-probe",
      label: "MCP live probe",
      ok: probeFailures.length === 0 && probes.length > 0,
      detail:
        probeFailures.length > 0
          ? probeFailures.join("; ")
          : probes.length > 0
            ? probes.join(", ")
            : "no enabled servers to probe",
      blocking: false
    });
    // S5: meme opt-in --deep, cycle memoire reel sur racine temporaire.
    checks.push(memoryLifecycleProbe());
  }

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


