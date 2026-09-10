import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  copyInto,
  loadManifest,
  mergeCreated,
  nodeVersionOk,
  novahizHome,
  opencodeConfigDir,
  parseArgs,
  readJson,
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
      tools: ["edit", "write", "patch"]
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

  const actions = [];
  const note = (message) => {
    actions.push(message);
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}${message}\n`);
  };

  note(`Novahiz home: ${home}`);
  note(`opencode config: ${configDir}`);

  if (!nodeVersionOk()) {
    process.stderr.write(`Node ${process.versions.node} is too old. Node 22.18 or later is required.\n`);
    process.exit(1);
  }

  const created = [];

  if (resolve(root) !== resolve(home)) {
    note(`Copie du core vers ${home}`);
    if (!dryRun) mkdirSync(home, { recursive: true });
    for (const item of CORE_ITEMS) {
      const source = join(root, item);
      if (!existsSync(source)) continue;
      if (dryRun) {
        note(`  + ${item}`);
        continue;
      }
      const target = join(home, item);
      cpSync(source, target, { recursive: true, force: true });
    }
  }

  if (withSkills) {
    const skillsSource = existsSync(join(home, "skills")) ? join(home, "skills") : join(root, "skills");
    if (existsSync(skillsSource)) {
      note(`Installation des skills dans ${skillsDir}`);
      if (!dryRun) {
        const result = copyInto(skillsSource, skillsDir);
        created.push(...result.created);
        note(`  ${result.total} fichiers, ${result.created.length} nouveaux`);
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
      mkdirSync(pluginsDir, { recursive: true });
      const existed = existsSync(pluginTarget);
      cpSync(pluginSource, pluginTarget);
      if (!existed) created.push(pluginTarget);
    }
  }

  const configPath = join(home, "novahiz.config.json");
  if (force || !existsSync(configPath)) {
    note(`Ecriture de ${configPath}`);
    if (!dryRun) writeJson(configPath, defaultConfig(skillsDir));
  } else {
    note(`Config existante conservee: ${configPath}`);
  }

  if (!dryRun) {
    const previous = loadManifest(home).created ?? [];
    const manifest = {
      version: "0.1.0",
      installedAt: new Date().toISOString(),
      harness: "opencode",
      configDir,
      home,
      created: mergeCreated(previous, created)
    };
    saveManifest(home, manifest);
  }

  if (!dryRun) {
    const cli = join(home, "src", "cli.ts");
    if (existsSync(cli)) {
      note(`Construction du catalogue (sync)`);
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
    process.stdout.write(`Redemarre opencode pour activer le plugin et le serveur MCP.\n`);
    process.stdout.write(`Gate desactivable a chaud avec NOVAHIZ_GATE=off.\n`);
  } else {
    process.stdout.write(`\nDry-run termine, aucune modification ecrite.\n`);
  }
}

main();
