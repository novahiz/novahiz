import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  copyFileWithBackup,
  copyInto,
  loadManifest,
  mergeBackups,
  mergeCreated,
  nodeVersionOk,
  novahizHome,
  opencodeConfigDir,
  parseArgs,
  repoRoot,
  saveManifest,
  writeJson
} from "./lib.mjs";

const CORE_ITEMS = [
  "src",
  "catalog",
  "bin",
  "install",
  "mcp",
  "adapters",
  "skills",
  "docs",
  "package.json",
  "tsconfig.json",
  "LICENSE",
  "README.md",
  "NOTICE.md",
  "novahiz.config.example.json"
];

function defaultConfig(skillsDir) {
  return {
    dbPath: "novahiz.sqlite",
    skillRoots: ["./skills", skillsDir.replace(/\\/g, "/"), "~/.agents/skills"],
    gate: {
      enabled: true,
      mode: "block",
      envEscape: "NOVAHIZ_GATE",
      tools: ["edit", "write", "patch", "apply_patch"]
    },
    classify: {
      minScore: 1,
      maxCategories: 3,
      fallbackCategory: "general"
    }
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const force = Boolean(flags.force);
  const withSkills = !flags["no-skills"];
  const root = repoRoot(import.meta.url);
  const home = novahizHome(flags);
  const configDir = flags.scope === "project" ? resolve(".opencode") : opencodeConfigDir();
  const skillsDir = join(configDir, "skills");
  const pluginsDir = join(configDir, "plugins");

  const note = (message) => process.stdout.write(`${dryRun ? "[dry-run] " : ""}${message}\n`);

  note(`Novahiz home: ${home}`);
  note(`opencode config: ${configDir}`);

  if (!nodeVersionOk()) {
    process.stderr.write(`Node ${process.versions.node} is too old. Node 22.18 or later is required.\n`);
    process.exit(1);
  }

  const created = [];
  const backups = [];
  let coreCopied = false;
  let configCreated = false;

  const sameRoot = resolve(root) === resolve(home);
  if (!sameRoot) {
    note(`Copie du core vers ${home}`);
    if (!dryRun) mkdirSync(home, { recursive: true });
    for (const item of CORE_ITEMS) {
      const source = join(root, item);
      if (!existsSync(source)) continue;
      if (dryRun) {
        note(`  + ${item}`);
        continue;
      }
      cpSync(source, join(home, item), { recursive: true, force: true });
    }
    coreCopied = true;
  }

  if (withSkills) {
    const skillsSource = existsSync(join(home, "skills")) ? join(home, "skills") : join(root, "skills");
    if (existsSync(skillsSource)) {
      note(`Installation des skills dans ${skillsDir}`);
      if (!dryRun) {
        const result = copyInto(skillsSource, skillsDir, true);
        created.push(...result.created);
        backups.push(...result.backups);
        note(`  ${result.total} fichiers, ${result.created.length} nouveaux, ${result.backups.length} sauvegardes`);
      }
    } else {
      note(`Aucun dossier skills trouve a ${skillsSource}`);
    }
  }

  const pluginSource = join(home, "adapters", "opencode", "novahiz.ts");
  const pluginTarget = join(pluginsDir, "novahiz.ts");
  if (existsSync(pluginSource)) {
    note(`Installation du plugin opencode dans ${pluginTarget}`);
    if (!dryRun) {
      const result = copyFileWithBackup(pluginSource, pluginTarget, true);
      if (result.created) created.push(result.created);
      if (result.backup) backups.push(result.backup);
    }
  }

  const configPath = join(home, "novahiz.config.json");
  if (force || !existsSync(configPath)) {
    note(`Ecriture de ${configPath}`);
    if (!dryRun) {
      const existedBefore = existsSync(configPath);
      if (existedBefore) {
        const backup = `${configPath}.novahiz-bak`;
        if (!existsSync(backup)) cpSync(configPath, backup);
        backups.push({ path: configPath, backup });
      }
      writeJson(configPath, defaultConfig(skillsDir));
      configCreated = !existedBefore;
    }
  } else {
    note(`Config existante conservee: ${configPath}`);
  }

  if (!dryRun) {
    const previous = loadManifest(home);
    saveManifest(home, {
      version: "0.1.0",
      installedAt: new Date().toISOString(),
      harness: "opencode",
      configDir,
      home,
      coreCopied: previous.coreCopied || coreCopied,
      configCreated: previous.configCreated || configCreated,
      created: mergeCreated(previous.created, created),
      backups: mergeBackups(previous.backups, backups)
    });
  }

  if (!dryRun) {
    const cli = join(home, "src", "cli.ts");
    if (existsSync(cli)) {
      note("Construction du catalogue (sync)");
      const result = spawnSync(process.execPath, [cli, "sync"], {
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
    }
  }

  if (!dryRun) {
    process.stdout.write(`\nNovahiz installe dans ${home}.\n`);
    process.stdout.write("Redemarre opencode pour activer le plugin et le serveur MCP.\n");
    process.stdout.write("Gate desactivable avec la variable d'environnement NOVAHIZ_GATE=off.\n");
  } else {
    process.stdout.write("\nDry-run termine, aucune modification ecrite.\n");
  }
}

main();
