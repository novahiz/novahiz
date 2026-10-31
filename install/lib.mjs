import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
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
  // H16: `if (env.NOVAHIZ_HOME) ...` was written twice - a copy-paste leftover
  // from an earlier variable name. Anyone who exported that older name silently
  // fell through to the default home while believing they had redirected it.
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
// non-Chromium fallback. Lives here so install.mjs and the tests share one
// source of truth.
export function playwrightBrowserFlag(platform = process.platform) {
  return platform === "win32" ? "--browser=msedge" : "--browser=webkit";
}

/**
 * NX-37 : le profil du navigateur de verification.
 *
 * Sans `--user-data-dir`, chaque demarrage du serveur Playwright cree un profil
 * neuf (onze dossiers `mcp-msedge-*` mesures le 2026-10-31) : une session qui
 * se connecte dans l'un n'existe plus dans l'autre, et deux sessions qui
 * partagent l'outil se marchent dessus sans un mot. Le dossier vit sous le home
 * de l'utilisateur, jamais dans le paquet. `NOVAHIZ_PLAYWRIGHT_PROFILE` permet
 * de le deplacer, par exemple vers un disque chiffre.
 */
export function playwrightProfileDir(env = process.env) {
  const override = env.NOVAHIZ_PLAYWRIGHT_PROFILE;
  if (typeof override === "string" && override.length > 0) return resolve(expandHome(override));
  return join(homedir(), ".opencode", "playwright-profile");
}

export function playwrightProfileFlag(env = process.env) {
  return `--user-data-dir=${playwrightProfileDir(env)}`;
}

/**
 * Aligne une configuration existante sur la politique du navigateur.
 *
 * L'installateur n'ecrase jamais un `opencode.jsonc` deja present : sans ce
 * passage, une installation anterieure garde son entree Playwright sans profil
 * pour toujours, et le correctif NX-37 ne profite qu'aux installations neuves.
 * Le fichier est relu en JSON strict : un fichier qui porte des commentaires
 * n'est pas reecrit, il est signale. Aucune ecriture quand rien ne manque.
 */
export function reconcilePlaywrightCommand(
  configPath,
  platform = process.platform,
  env = process.env,
) {
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return { state: "absent" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return { state: "illisible" };
  }
  const command = parsed?.mcp?.playwright?.command;
  if (!Array.isArray(command) || command.length === 0) return { state: "absent" };

  const wantedBrowser = playwrightBrowserFlag(platform);
  const wantedProfile = playwrightProfileFlag(env);
  const next = [...command];
  const changes = [];

  const browserIndex = next.findIndex((token) => typeof token === "string" && token.startsWith("--browser="));
  if (browserIndex === -1) {
    next.push(wantedBrowser);
    changes.push(`+ ${wantedBrowser}`);
  } else if (next[browserIndex] !== wantedBrowser) {
    changes.push(`${next[browserIndex]} -> ${wantedBrowser}`);
    next[browserIndex] = wantedBrowser;
  }

  const hasProfile = next.some((token) => typeof token === "string" && token.startsWith("--user-data-dir"));
  if (!hasProfile) {
    next.push(wantedProfile);
    changes.push(`+ ${wantedProfile}`);
  }

  if (changes.length === 0) return { state: "inchange" };
  parsed.mcp.playwright.command = next;
  writeFileSync(configPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  return { state: "corrige", changes };
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

/** `dir` englobe `value` (egalite comprise), insensible a la casse sous Windows. */
export function withinDir(value, dir) {
  const normalize = (item) => (process.platform === "win32" ? item.toLowerCase() : item);
  const base = normalize(resolve(dir));
  const target = normalize(resolve(value));
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/**
 * Fichiers que novahiz a poses et qui n'ont plus de source.
 *
 * Le manifeste d'installation (.novahiz-install.json, champ `created`) est la
 * seule preuve de propriete : un fichier ecrit par un pack ou par l'utilisateur
 * n'y figure pas et n'est donc jamais retenu. Trois gardes, dans l'ordre :
 *   1. le chemin est sous une racine declaree source -> destination,
 *   2. sa contrepartie dans la source n'existe plus,
 *   3. ce n'est ni la config de l'utilisateur ni une sauvegarde seule.
 * Un `.novahiz-bak` part avec le fichier dont il est la copie : une sauvegarde
 * dont le fichier d'origine existe toujours reste en place.
 */
export function staleOwnedPaths(created, roots, exists = existsSync) {
  const out = [];
  for (const item of created ?? []) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (item.endsWith("novahiz.config.json")) continue;
    const root = roots.find((entry) => withinDir(item, entry.dest));
    if (!root) continue;
    const rel = relative(root.dest, item);
    if (!rel || rel.startsWith("..")) continue;
    if (exists(join(root.src, rel))) continue;
    // Un manifeste peut nommer un fichier deja parti (supprime a la main).
    // Il ne compte pas : `removed` doit ne lister que ce qui a vraiment bouge.
    const backup = `${item}.novahiz-bak`;
    if (exists(item)) out.push(item);
    if (exists(backup)) out.push(backup);
  }
  return [...new Set(out)];
}

/**
 * Empreinte d'un fichier, fins de ligne normalisees en LF.
 *
 * Le paquet est livre en LF, l'installation ecrit en CRLF sous Windows : sans
 * normalisation, le meme fichier ne se reconnait plus lui-meme d'une machine a
 * l'autre. C'est cette empreinte, et pas les octets bruts, qui sert de preuve
 * de propriete aux fichiers retires.
 */
export function normalisedSha256(content) {
  return createHash("sha256").update(content.toString("utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/**
 * Fichiers retires du paquet et encore presents dans le home.
 *
 * Le manifeste ne peut pas les connaitre : un fichier copie par une version
 * anterieure a l'invention du champ `created` n'y figure pas, et rien ne le
 * reference plus cote source. La preuve de propriete devient donc le contenu :
 * l'entree ne part que si le fichier sur disque porte exactement l'empreinte
 * publiee dans `retired.json`. Un fichier modifie a la main ne correspond plus
 * et n'est jamais supprime ; il ressort dans `kept` pour etre dit a l'utilisateur.
 */
export function retiredOwnedPaths(retired, home, readFile = readFileSync, exists = existsSync) {
  const removed = [];
  const kept = [];
  for (const entry of retired?.files ?? []) {
    if (!entry || typeof entry.path !== "string" || typeof entry.sha256 !== "string") continue;
    if (entry.path.length === 0 || entry.path.startsWith("..")) continue;
    const target = join(home, entry.path);
    if (!exists(target)) continue;
    let digest;
    try {
      digest = normalisedSha256(readFile(target));
    } catch {
      continue;
    }
    if (digest === entry.sha256.toLowerCase()) removed.push(target);
    else kept.push(target);
  }
  return { removed: [...new Set(removed)], kept: [...new Set(kept)] };
}

/**
 * Decide et applique le nettoyage de l'installation precedente.
 *
 * Renvoie `{ status, detail, removed, kept }`, `status` etant la valeur attendue
 * par ui.finishStep ("done" ou "skip"). Deux preuves de propriete, selon l'age
 * du fichier : le manifeste d'installation (`created`, `backups`) pour ce que
 * les versions recentes ont ecrit, et l'empreinte de `retired.json` pour ce que
 * les versions anterieures ont pose sans jamais l'enregistrer. Un fichier de
 * pack, de l'utilisateur, ou modifie a la main ne satisfait ni l'une ni l'autre
 * et reste en place. Cas de sortie :
 *   - `--clean` absent, ou echec d'une etape precedente : skip, rien ne bouge ;
 *   - rien de retire : done ;
 *   - au moins un fichier retire : done, manifeste mis a jour.
 *
 * Vit ici et non dans install.mjs : ce module est sans effet de bord a
 * l'import, l'installateur execute main() au chargement.
 */
export function cleanupPreviousInstall({
  home,
  configDir,
  roots,
  clean,
  dryRun = false,
  stepFailure = null,
  retired = null
}) {
  if (!clean) {
    return { status: "skip", detail: "pass --clean to remove files from a previous install", removed: [], kept: [] };
  }
  if (stepFailure) {
    return { status: "skip", detail: `an earlier step failed (${stepFailure}), cleanup aborted`, removed: [], kept: [] };
  }
  const manifest = loadManifest(home);
  // Deux preuves de propriete, pas une. `created` ne liste que les fichiers
  // poses pour la premiere fois : sur une installation qui existait deja,
  // chaque copie renvoyait `created: null` et rien n'etait enregistre, ce qui
  // rendait le nettoyage inerte. `backups[].path` liste les fichiers ecrases,
  // donc ecrits par novahiz — c'est la preuve qui manquait.
  const owned = [
    ...(manifest.created ?? []),
    ...(manifest.backups ?? []).map((entry) => (entry && entry.path) || "").filter((path) => path.length > 0)
  ];
  const retiredScan = retiredOwnedPaths(retired, home);
  const stale = [...new Set([...staleOwnedPaths(owned, roots), ...retiredScan.removed])];
  const kept = retiredScan.kept.filter((item) => !stale.includes(item));
  if (stale.length === 0) {
    return { status: "done", detail: "no leftover file from a previous install", removed: [], kept };
  }
  if (dryRun) {
    return {
      status: "skip",
      detail: `${stale.length} file(s) would be removed by a real run with --clean`,
      removed: [],
      kept,
      stale
    };
  }
  const removed = [];
  for (const item of stale) {
    rmSync(item, { force: true });
    removed.push(item);
  }
  pruneEmptyDirs(removed, [configDir, ...roots.map((entry) => entry.dest)]);
  saveManifest(home, {
    ...manifest,
    created: (manifest.created ?? []).filter((item) => !removed.includes(item)),
    backups: (manifest.backups ?? []).filter(
      (entry) => !removed.includes(entry.path) && !removed.includes(entry.backup)
    ),
    cleanedAt: new Date().toISOString()
  });
  return { status: "done", detail: `${removed.length} file(s) from a previous install removed`, removed, kept };
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
          // recursive:false leve ERR_FS_EISDIR sur un repertoire : rm ne
          // supprime qu'un fichier avec cet option, et le catch ci-dessous
          // avalait l'erreur en faisant passer la fonction pour silencieuse.
          // Le repertoire est deja vide ici, recursion sans effet de bord.
          rmSync(current, { recursive: true });
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

// PATH scan plutot qu'un appel a `which`/`where` : ces binaires ne sont pas
// garantis (Debian minimal, conteneurs, Alpine sans which) et le spawn
// ajoutait un echec silencieux a chaque detection. Meme semantique, sans
// dependance externe. `PATHEXT` est respecte sous Windows pour les shims .cmd.
export function which(cmd, env = process.env, platform = process.platform) {
  const separator = platform === "win32" ? ";" : ":";
  const dirs = String(env.PATH ?? env.Path ?? env.path ?? "")
    .split(separator)
    .filter(Boolean);
  if (dirs.length === 0) return false;
  const hasExtension = /\.(exe|cmd|bat|com)$/i.test(cmd);
  const extensions =
    platform === "win32" && !hasExtension
      ? String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      try {
        if (existsSync(join(dir, cmd + extension))) return true;
      } catch {
        // une entree de PATH invalide ne doit pas casser la detection
      }
    }
  }
  return false;
}

/**
 * Shell a declarer dans la configuration opencode. Windows n'a pas de bash
 * garanti (powershell.exe l'est, pwsh non) ; sur macOS le shell par defaut est
 * zsh, pas bash. Forcer "bash" partout donnait a un utilisateur macOS un shell
 * qui n'est pas le sien.
 */
export function shellSetting(env = process.env, platform = process.platform, whichFn = which) {
  if (platform === "win32") return whichFn("pwsh", env) ? "pwsh" : "powershell";
  const shell = String(env.SHELL ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  return ["bash", "zsh", "sh"].includes(shell) ? shell : "bash";
}

/**
 * Mode de l'installateur.
 *
 * - `--core` : la partie locale et sure (copie du core, skills, plugin, agent,
 *   commandes, catalogue, configuration). Aucun reseau, aucun sudo. C'est ce
 *   que lance le postinstall npm : un `npm install -g` ne doit jamais attendre
 *   un mot de passe sudo, un brew ou un telechargement.
 * - `--extras` : seulement la partie reseau/systeme (providers, MCP globaux,
 *   seed documentaire, vault Obsidian, mises a jour npm), rejouee au premier
 *   lancement de `novahiz`.
 * - sans drapeau : tout, comportement historique de `novahiz-install`.
 *
 * Les deux drapeaux ensemble valent "tout" : un appelant qui demande
 * explicitement core ET extras ne doit pas se voir refuser l'un des deux.
 */
export function installMode(flags = {}) {
  const core = flags.core === true;
  const extras = flags.extras === true;
  if (core && extras) return { core: true, extras: true, mode: "all" };
  if (core) return { core: true, extras: false, mode: "core" };
  if (extras) return { core: false, extras: true, mode: "extras" };
  return { core: true, extras: true, mode: "all" };
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
 * - hors npm (`novahiz-install` direct, premier lancement du CLI) -> non : le
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
