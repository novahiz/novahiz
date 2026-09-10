import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, novahizHome, parseArgs, pruneEmptyDirs, saveManifest } from "./lib.mjs";

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const keepConfig = Boolean(flags["keep-config"]);
  const home = novahizHome(flags);
  const manifest = loadManifest(home);
  const created = manifest.created ?? [];

  if (created.length === 0) {
    process.stdout.write(`Rien a desinstaller pour ${home}.\n`);
    return;
  }

  const removed = [];
  for (const item of created) {
    if (!existsSync(item)) continue;
    if (keepConfig && item.endsWith("novahiz.config.json")) continue;
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}suppression ${item}\n`);
    if (!dryRun) rmSync(item, { force: true });
    removed.push(item);
  }

  if (!dryRun) {
    pruneEmptyDirs(removed);
    saveManifest(home, { ...manifest, created: [] });
    process.stdout.write(`\nDesinstallation terminee (${removed.length} fichiers).\n`);
  } else {
    process.stdout.write(`\nDry-run termine, rien supprime.\n`);
  }
}

main();
