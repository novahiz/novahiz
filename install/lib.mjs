import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
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
  return flags;
}

export function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

export function repoRoot(metaUrl) {
  return resolve(dirname(fileURLToPath(metaUrl)), "..");
}

function underHome(target) {
  const home = resolve(homedir());
  const resolved = resolve(target);
  return resolved === home || resolved.startsWith(home + sep);
}

export function opencodeConfigDir(env = process.env) {
  // P2-C (LOW): env-provided roots used to be trusted blindly, so a stray
  // OPENCODE_CONFIG_DIR/XDG_CONFIG_HOME could point the installer at any
  // directory on disk. Refuse anything outside home instead of writing there.
  const source = env.OPENCODE_CONFIG_DIR ? "OPENCODE_CONFIG_DIR" : env.XDG_CONFIG_HOME ? "XDG_CONFIG_HOME" : null;
  const candidate = env.OPENCODE_CONFIG_DIR
    ? resolve(env.OPENCODE_CONFIG_DIR)
    : env.XDG_CONFIG_HOME
      ? resolve(join(env.XDG_CONFIG_HOME, "opencode"))
      : join(homedir(), ".config", "opencode");
  if (source && !underHome(candidate)) {
    throw new Error(`refusing to use ${source}=${candidate}: path is outside ${homedir()}. Unset the variable to use the default ~/.config/opencode.`);
  }
  return candidate;
}

export function NovahizHome(flags = {}, env = process.env) {
  if (typeof flags.home === "string") return resolve(expandHome(flags.home));
  if (env.NOVAHIZ_HOME) return resolve(env.NOVAHIZ_HOME);
  if (env.NOVAHIZ_HOME) return resolve(env.NOVAHIZ_HOME);
  return join(homedir(), ".config", "novahiz");
}

export function listFiles(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const dir = rel ? join(root, rel) : root;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) stack.push(childRel);
      else out.push(childRel);
    }
  }
  return out;
}

export function skillNamesIn(roots) {
  const names = new Set();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(root, entry.name, "SKILL.md"))) names.add(entry.name);
    }
  }
  return names;
}

function sameContent(a, b) {
  try {
    return readFileSync(a, "utf8") === readFileSync(b, "utf8");
  } catch {
    return false;
  }
}

export function copyFileWithBackup(srcPath, destPath, useBackup = true) {
  mkdirSync(dirname(destPath), { recursive: true });
  if (!existsSync(destPath)) {
    cpSync(srcPath, destPath);
    return { created: destPath, backup: null };
  }
  if (sameContent(srcPath, destPath)) return { created: null, backup: null };
  let backup = null;
  if (useBackup) {
    backup = `${destPath}.novahiz-bak`;
    if (!existsSync(backup)) cpSync(destPath, backup);
  }
  cpSync(srcPath, destPath);
  return { created: null, backup: backup ? { path: destPath, backup } : null };
}

export function copyInto(srcDir, destDir, useBackup = true) {
  const created = [];
  const backups = [];
  if (!existsSync(srcDir)) return { created, backups, total: 0 };
  mkdirSync(destDir, { recursive: true });
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const src = rel ? join(srcDir, rel) : srcDir;
    for (const entry of readdirSync(src, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel ? join(rel, entry.name) : entry.name;
      const srcPath = join(srcDir, childRel);
      const destPath = join(destDir, childRel);
      if (entry.isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        stack.push(childRel);
      } else {
        const result = copyFileWithBackup(srcPath, destPath, useBackup);
        if (result.created) created.push(result.created);
        if (result.backup) backups.push(result.backup);
      }
    }
  }
  return { created, backups, total: listFiles(srcDir).length };
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// --browser flag for the generated Playwright MCP entry. Edge ships with
// Windows; on macOS/Linux omitting the flag silently launches Playwright's
// bundled Chromium (coreBundle: browserName ??= "chromium"), which the house
// rule (adapters/opencode/instructions.md) forbids — WebKit is the sanctioned
// non-Chromium fallback. Lives here so install.mjs, bootstrap.mjs and tests
// share one source of truth.
export function playwrightBrowserFlag(platform = process.platform) {
  return platform === "win32" ? "--browser=msedge" : "--browser=webkit";
}

// Config written on a fresh install. Lives here (not in install.mjs) so tests
// can assert it without executing the installer.
export function defaultConfig() {
  return {
    dbPath: "novahiz.sqlite",
    // Mirrors novahiz.config.example.json: bundled skills, the harness skills
    // dir, and the external packs (~/.agents/skills) must all be indexed, or
    // gate-required pack skills are invisible on fresh installs.
    skillRoots: ["./skills", "~/.config/opencode/skills", "~/.agents/skills"],
    gate: {
      enabled: true,
      mode: "block",
      // Kept for schema compatibility only — the kill-switch name is hardcoded
      // to NOVAHIZ_GATE in the CLI, MCP gate, and plugin (see src/spec.ts).
      envEscape: "NOVAHIZ_GATE",
      // Audit 2026-09-25 (P1): snap_restore rolls back files, clepsydre_enable_task
      // re-arms a disabled task — both carry, create or execute state too.
      tools: ["edit", "write", "patch", "apply_patch", "bash", "shell", "snap_restore", "clepsydre_add_task", "clepsydre_add_shell_task", "clepsydre_add_http_task", "clepsydre_add_prompt_task", "clepsydre_update_task", "clepsydre_remove_task", "clepsydre_run_task_now", "clepsydre_enable_task"]
    },
    classify: {
      minScore: 1,
      maxCategories: 3,
      fallbackCategory: "general"
    },
    providers: {
      autoRegister: true,
      autoInstall: true,
      // `clepsydre` is a local server (mcp/clepsydre) with no install step:
      // nothing needs to stay disabled by default.
      disabled: []
    }
  };
}

export function loadManifest(home) {
  return readJson(join(home, ".novahiz-install.json"), { created: [], backups: [] });
}

// npm/npx are .cmd shims on Windows: direct spawnSync throws ENOENT
// (post-CVE-2024-* Node refuses to run .cmd via CreateProcess), so they need
// cmd.exe. The line handed to cmd.exe is built only from tokens that pass
// SAFE_HOST_TOKEN — the install-side mirror of src/exec.ts SAFE_TOKEN, widened
// by a single character: "*" (cmd.exe performs no glob expansion, and the
// flutter-skills `--skill *` argument must reach npx literally). Everything a
// shell can reinterpret — & | < > ^ % ! ( ) " ' ` ; $ ? whitespace, newlines —
// stays banned, so the joined line can never grow a second command. Tokens are
// static today (catalog package names, fixed flags); this check keeps that
// true for any future argument instead of trusting it. Same cmd.exe spelling
// as src/exec.ts resolveSpawn — cmd.exe is spawned explicitly with argv, no
// deprecated shell flag (DEP0190), so the joined line is the only string cmd
// ever parses.
const SAFE_HOST_TOKEN = /^[A-Za-z0-9@._+*,/:=~-]+$/;

export function unsafeHostToken(tokens) {
  for (const token of tokens) {
    if (token.length === 0) return "";
    if (!SAFE_HOST_TOKEN.test(token)) return token;
  }
  return null;
}

function refusedHost(token) {
  return {
    status: 1,
    stdout: "",
    stderr: `refused unsafe token: ${token}\n`,
    error: new Error(`refused unsafe token: ${token}`),
  };
}

export function spawnHost(cmd, args, opts = {}) {
  if (process.platform === "win32") {
    const bad = unsafeHostToken([cmd, ...args]);
    if (bad !== null) return refusedHost(bad);
    const shell = process.env.ComSpec ?? "cmd.exe";
    const line = [cmd, ...args].join(" ");
    return spawnSync(shell, ["/d", "/s", "/c", line], { ...opts, encoding: "utf8" });
  }
  return spawnSync(cmd, args, { ...opts, encoding: "utf8" });
}

export function saveManifest(home, manifest) {
  writeJson(join(home, ".novahiz-install.json"), manifest);
}

export function mergeCreated(previous = [], next = []) {
  const set = new Set(previous);
  for (const item of next) set.add(item);
  return [...set].filter((item) => existsSync(item)).sort();
}

export function mergeBackups(previous = [], next = []) {
  const map = new Map();
  for (const entry of [...previous, ...next]) {
    if (entry && entry.path && entry.backup) map.set(entry.path, entry);
  }
  return [...map.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

export function pruneEmptyDirs(paths, stops = []) {
  const stopSet = new Set(stops.map((value) => resolve(value)));
  const candidates = new Set();
  for (const item of paths) candidates.add(dirname(item));
  const ordered = [...candidates].sort((a, b) => b.length - a.length);
  // One pass is not enough: a directory emptied by a later candidate is only
  // noticed on the next pass. Repeat until a full pass removes nothing.
  let removed = true;
  while (removed) {
    removed = false;
    for (const start of ordered) {
      let current = start;
      while (current && existsSync(current) && !stopSet.has(resolve(current))) {
        try {
          if (readdirSync(current).length !== 0) break;
          rmSync(current, { recursive: false });
          removed = true;
          const parent = dirname(current);
          if (parent === current) break;
          current = parent;
        } catch {
          break;
        }
      }
    }
  }
}

// The only supported harness: opencode is on PATH or has a config dir
// (desktop app, or a CLI that has already been launched once).
export function detectedHarnesses(dirs, whichFn = which) {
  return ["opencode"].filter((name) => whichFn(name) || existsSync(dirs[name]));
}

export function which(cmd) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [cmd + ext], { encoding: "utf8", stdio: "pipe" });
  if (result.status === 0) return true;
  if (process.platform === "win32") {
    const result2 = spawnSync("where", [cmd], { encoding: "utf8", stdio: "pipe" });
    return result2.status === 0;
  }
  return false;
}

export function nodeVersionOk(minimum = [22, 18, 0]) {
  const parts = process.versions.node.split(".").map((value) => Number.parseInt(value, 10));
  for (let index = 0; index < minimum.length; index += 1) {
    if ((parts[index] ?? 0) > minimum[index]) return true;
    if ((parts[index] ?? 0) < minimum[index]) return false;
  }
  return true;
}

// --- Phase opencode differee (postinstall npm) ------------------------------
//
// Bug reproduit le 2026-10-10 (enquete npm, memoire slot-005) : quand
// install.mjs tourne comme script postinstall, ses ecritures dans le dossier
// de config opencode (skills, plugin, agent, commands, opencode.jsonc) font
// redemarrer le serveur opencode, qui tue alors son arbre de processus —
// npm compris, encore en pleine transaction reify. Le remplacement en place
// est interrompu : rollback vers l'ancien paquet (version et mtimes
// preserves a la milliseconde) ou dossiers .novahiz-* orphelins.
//
// Le correctif se pose sur deux piliers :
//   1. la phase opencode part en processus detache (detached + unref) qui
//      attend la mort du postinstall puis de npm avant la moindre ecriture —
//      un redemarrage opencode arrive alors que la transaction est finie ;
//   2. le passage synchronise ne touche plus qu'au NOVAHIZ_HOME, seule zone
//      jamais observee comme declencheur lors des trois kills reproduits.

const deferDefaultLog = (message) => process.stdout.write(`${message}\n`);
const deferSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * La phase opencode doit-elle sortir du cycle de vie npm ?
 *
 * - `npm_lifecycle_event` present (postinstall) -> oui, sauf :
 * - `--deferred-opencode` / `NOVAHIZ_DEFERRED=1` (le passage detache
 *   lui-meme) -> non : la phase deferree ne se defererait pas a l'infini ;
 * - `--sync` (repli d'urgence vers l'ancien comportement) -> non ;
 * - hors npm (novahiz-install direct, bootstrap CLI) -> non : le
 *   comportement historique entierement synchrone est conserve.
 */
export function deferOpencodePhase(flags = {}, env = process.env) {
  if (flags.sync === true) return false;
  if (flags["deferred-opencode"] === true) return false;
  if (env.NOVAHIZ_DEFERRED === "1") return false;
  return Boolean(env.npm_lifecycle_event);
}

/** pid utilisable : entier strictement positif, sinon null. */
export function parsePid(value) {
  const pid = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Le processus existe-t-il encore ? EPERM = oui (proprietaire different). */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error) && error.code === "EPERM";
  }
}

/**
 * PID du processus npm de l'installation en cours : on remonte la chaine des
 * ParentProcessId jusqu'au premier ancetre dont la ligne de commande
 * reference `npm-cli.js`. Le chemin de notre propre processus contient bien
 * `\npm\` (paquet installe globalement dans Roaming\npm), jamais
 * `npm-cli.js` : le filtre ne peut pas se retenir lui-meme.
 * null = pas de npm au-dessus (ou plateforme non interrogeable) — l'appelant
 * bascule alors sur une patience fixe.
 */
export function findNpmAncestorPid(startPid = process.pid) {
  if (process.platform === "win32") {
    const script =
      `$cur = Get-CimInstance Win32_Process -Filter "ProcessId=${startPid}"; ` +
      "while ($cur) { " +
      "if ($cur.CommandLine -and $cur.CommandLine -match 'npm-cli\\.js') { Write-Output $cur.ProcessId; break }; " +
      "if (-not $cur.ParentProcessId -or $cur.ParentProcessId -eq $cur.ProcessId) { break }; " +
      "$cur = Get-CimInstance Win32_Process -Filter \"ProcessId=$($cur.ParentProcessId)\" -ErrorAction SilentlyContinue; " +
      "}";
    const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
    if (result.status === 0) {
      const pid = parsePid((result.stdout ?? "").trim());
      if (pid !== null && pid !== startPid) return pid;
    }
    return null;
  }
  const result = spawnSync("ps", ["-o", "pid=", "-o", "ppid=", "-o", "command=", "-ax"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const rows = new Map();
  for (const line of String(result.stdout ?? "").split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\s\S]*)$/);
    if (match) rows.set(Number.parseInt(match[1], 10), { ppid: Number.parseInt(match[2], 10), cmd: match[3] });
  }
  let current = startPid;
  const seen = new Set();
  while (current && rows.has(current) && !seen.has(current)) {
    seen.add(current);
    const row = rows.get(current);
    if (current !== startPid && /npm-cli\.js/.test(row.cmd)) return current;
    current = row.ppid;
  }
  return null;
}

/**
 * Attend la mort de chaque pid (cadence pollMs, plafond timeoutMs par pid).
 * Le plafond est inclusif : la fonction rend TOUJOURS la main — un pid
 * rebelle ne doit jamais bloquer la phase differee indefiniment.
 */
export async function waitForPids(pids, opts = {}) {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const isAlive = opts.isAlive ?? pidAlive;
  const log = opts.log ?? deferDefaultLog;
  const wait = opts.sleep ?? deferSleep;
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!isAlive(pid)) {
      log(`novahiz defer: pid ${pid} already exited`);
      continue;
    }
    const deadline = Date.now() + timeoutMs;
    log(`novahiz defer: waiting for pid ${pid} to exit...`);
    while (isAlive(pid)) {
      if (Date.now() >= deadline) {
        log(`novahiz defer: pid ${pid} still alive after ${timeoutMs}ms - proceeding anyway`);
        break;
      }
      await wait(pollMs);
    }
  }
}

/**
 * Entree de la phase differee : attend que le postinstall (notre createur)
 * ET npm soient sortis avant d'ecrire la moindre chose, puis rend la main.
 * npm non identifie (chaine d'ancetres atypique, pnpm...) -> patience fixe :
 * npm sort quelques secondes apres la fin du script de lifecycle.
 */
export async function waitForDeferredPhase(env = process.env, opts = {}) {
  const log = opts.log ?? deferDefaultLog;
  const wait = opts.sleep ?? deferSleep;
  const parentPid = parsePid(env.NOVAHIZ_WAIT_PARENT_PID);
  const npmPid = parsePid(env.NOVAHIZ_WAIT_PID);
  log(`novahiz defer: opencode phase detached - parent ${parentPid ?? "(none)"}, npm ${npmPid ?? "(unknown)"}`);
  await waitForPids(parentPid === null ? [] : [parentPid], opts);
  if (npmPid !== null) {
    await waitForPids([npmPid], opts);
  } else {
    await wait(opts.graceMs ?? 30000);
  }
  log("novahiz defer: npm exited - running the full pass (opencode config included)");
}
