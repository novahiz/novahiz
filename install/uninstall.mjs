import { cpSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { loadManifest, novahizHome, parseArgs, pruneEmptyDirs, saveManifest } from "./lib.mjs";

export function underHome(value) {
  const root = resolve(homedir());
  const target = resolve(value);
  const normalize = (item) => (process.platform === "win32" ? item.toLowerCase() : item);
  const prefix = normalize(root.endsWith(sep) ? root : root + sep);
  const candidate = normalize(target);
  return candidate === normalize(root) || candidate.startsWith(prefix);
}

export function withinDir(value, dir) {
  const normalize = (item) => (process.platform === "win32" ? item.toLowerCase() : item);
  const base = normalize(resolve(dir));
  const target = normalize(resolve(value));
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const keepConfig = Boolean(flags["keep-config"]);
  const purge = Boolean(flags.purge);
  const only = typeof flags.only === "string" ? resolve(flags.only) : null;
  const inScope = (value) => (only ? withinDir(value, only) : true);
  const home = novahizHome(flags);
  const manifest = loadManifest(home);
  const created = manifest.created ?? [];
  const backups = manifest.backups ?? [];
  const configPath = join(home, "novahiz.config.json");

  if (created.length === 0 && backups.length === 0 && !manifest.configCreated && !manifest.coreCopied) {
    process.stdout.write(`Rien a desinstaller pour ${home}.\n`);
    return;
  }

  const removed = [];

  for (const entry of backups) {
    if (!entry || !entry.backup || !existsSync(entry.backup)) continue;
    if (!inScope(entry.path)) continue;
    if (!underHome(entry.backup) || !underHome(entry.path)) {
      process.stdout.write(`skip out-of-scope backup: ${entry.path}\n`);
      continue;
    }
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}restauration ${entry.path}\n`);
    if (!dryRun) {
      cpSync(entry.backup, entry.path, { force: true });
      rmSync(entry.backup, { force: true });
    }
    removed.push(entry.backup);
  }

  const homePrefix = home.endsWith(sep) ? home : `${home}${sep}`;
  const keepCore = Boolean(manifest.coreCopied) && !purge;
  for (const item of created) {
    if (!existsSync(item)) continue;
    if (!inScope(item)) continue;
    if (!underHome(item)) {
      process.stdout.write(`skip out-of-scope entry: ${item}\n`);
      continue;
    }
    if (keepConfig && item.endsWith("novahiz.config.json")) continue;
    if (keepCore && item.startsWith(homePrefix)) continue;
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}suppression ${item}\n`);
    if (!dryRun) rmSync(item, { force: true });
    removed.push(item);
  }

  if (!dryRun) {
    if (!only && manifest.configCreated && !keepConfig && existsSync(configPath)) {
      rmSync(configPath, { force: true });
      removed.push(configPath);
    }
    pruneEmptyDirs(removed, [home, manifest.configDir ?? home, join(homedir(), ".config"), homedir()]);
    if (purge && manifest.coreCopied && existsSync(home)) {
      rmSync(home, { recursive: true, force: true });
      process.stdout.write(`Dossier Novahiz supprime: ${home}\n`);
    } else {
      const untouchedCreated = only ? created.filter((item) => !removed.includes(item)) : [];
      const untouchedBackups = only ? backups.filter((entry) => !removed.includes(entry && entry.backup)) : [];
      saveManifest(home, {
        ...manifest,
        created: untouchedCreated,
        backups: untouchedBackups,
        configCreated: only ? Boolean(manifest.configCreated) : false
      });
      if (manifest.coreCopied) {
        process.stdout.write(`Fichiers d'integration supprimes; core conserve dans ${home}. Utilise --purge pour le supprimer.\n`);
      }
    }
    process.stdout.write(`\nDesinstallation terminee (${removed.length} entrees traitees).\n`);
  } else {
    process.stdout.write("\nDry-run termine, rien supprime.\n");
  }
}

if (import.meta.main) main();
