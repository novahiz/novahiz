import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

export function opencodeConfigDir(env = process.env) {
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "opencode");
  return join(homedir(), ".config", "opencode");
}

export function skillenforceHome(flags = {}, env = process.env) {
  if (typeof flags.home === "string") return resolve(expandHome(flags.home));
  if (env.SKILLEFORCE_HOME) return resolve(env.SKILLEFORCE_HOME);
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
    backup = `${destPath}.skillenforce-bak`;
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

export function loadManifest(home) {
  return readJson(join(home, ".skillenforce-install.json"), { created: [], backups: [] });
}

export function saveManifest(home, manifest) {
  writeJson(join(home, ".skillenforce-install.json"), manifest);
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
