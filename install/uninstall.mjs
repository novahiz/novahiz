import { cpSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadManifest, novahizHome, parseArgs, pruneEmptyDirs, saveManifest } from "./lib.mjs";

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const keepConfig = Boolean(flags["keep-config"]);
  const purge = Boolean(flags.purge);
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
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}restauration ${entry.path}\n`);
    if (!dryRun) {
      cpSync(entry.backup, entry.path, { force: true });
      rmSync(entry.backup, { force: true });
    }
    removed.push(entry.backup);
  }

  for (const item of created) {
    if (!existsSync(item)) continue;
    if (keepConfig && item.endsWith("novahiz.config.json")) continue;
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}suppression ${item}\n`);
    if (!dryRun) rmSync(item, { force: true });
    removed.push(item);
  }

  if (!dryRun) {
    if (manifest.configCreated && !keepConfig && existsSync(configPath)) {
      rmSync(configPath, { force: true });
      removed.push(configPath);
    }
    pruneEmptyDirs(removed, [home, manifest.configDir ?? home, join(homedir(), ".config"), homedir()]);
    if (purge && manifest.coreCopied && existsSync(home)) {
      rmSync(home, { recursive: true, force: true });
      process.stdout.write(`Dossier Novahiz supprime: ${home}\n`);
    } else {
      saveManifest(home, { ...manifest, created: [], backups: [], configCreated: false });
      if (manifest.coreCopied) {
        process.stdout.write(`Core conserve dans ${home}. Utilise --purge pour le supprimer.\n`);
      }
    }
    process.stdout.write(`\nDesinstallation terminee (${removed.length} entrees traitees).\n`);
  } else {
    process.stdout.write("\nDry-run termine, rien supprime.\n");
  }
}

main();
