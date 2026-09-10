import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

export function repoRoot(metaUrl) {
  return resolve(dirname(fileURLToPath(metaUrl)), "..");
}

export function opencodeConfigDir(env = process.env) {
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "opencode");
  return join(homedir(), ".config", "opencode");
}

export function novahizHome(flags = {}, env = process.env) {
  if (typeof flags.home === "string") return resolve(flags.home);
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

export function copyInto(srcDir, destDir) {
  const created = [];
  if (!existsSync(srcDir)) return { created, total: 0 };
  mkdirSync(destDir, { recursive: true });
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const src = rel ? join(srcDir, rel) : srcDir;
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const childRel = rel ? join(rel, entry.name) : entry.name;
      const srcPath = join(srcDir, childRel);
      const destPath = join(destDir, childRel);
      if (entry.isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        stack.push(childRel);
      } else {
        const existed = existsSync(destPath);
        cpSync(srcPath, destPath);
        if (!existed) created.push(destPath);
      }
    }
  }
  return { created, total: listFiles(srcDir).length };
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function loadManifest(home) {
  return readJson(join(home, ".novahiz-install.json"), { created: [] });
}

export function saveManifest(home, manifest) {
  writeJson(join(home, ".novahiz-install.json"), manifest);
}

export function mergeCreated(previous = [], next = []) {
  const set = new Set(previous);
  for (const item of next) set.add(item);
  return [...set].filter((item) => existsSync(item)).sort();
}

export function pruneEmptyDirs(paths) {
  const roots = new Set();
  for (const item of paths) roots.add(dirname(item));
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    let current = root;
    while (current && existsSync(current)) {
      try {
        if (readdirSync(current).length === 0) {
          rmSync(current, { recursive: false });
          current = dirname(current);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }
}

export function nodeVersionOk(minimum = [22, 18, 0]) {
  const parts = process.versions.node.split(".").map((value) => Number.parseInt(value, 10));
  for (let index = 0; index < minimum.length; index += 1) {
    if ((parts[index] ?? 0) > minimum[index]) return true;
    if ((parts[index] ?? 0) < minimum[index]) return false;
  }
  return true;
}
