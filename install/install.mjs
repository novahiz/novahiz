import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
  readJson,
  repoRoot,
  saveManifest,
  skillNamesIn,
  writeJson
} from "./lib.mjs";
import { createPrompt } from "./prompt.mjs";

const CORE_ITEMS = [
  "src",
  "catalog",
  "bin",
  "install",
  "mcp",
  "adapters",
  "skills",
  "bundled-skills",
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
    skillRoots: ["./skills", "./bundled-skills"],
    gate: {
      enabled: true,
      mode: "block",
      envEscape: "NOVAHIZ_GATE",
      tools: ["edit", "write", "patch", "apply_patch", "bash", "shell"]
    },
    classify: {
      minScore: 1,
      maxCategories: 3,
      fallbackCategory: "general"
    },
    providers: {
      autoRegister: true,
      autoInstall: false,
      disabled: []
    }
  };
}

async function main() {
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

  const yes = Boolean(flags.yes) || Boolean(flags["yes"]);
  const interactive = !yes && !dryRun && (Boolean(flags.interactive) || process.stdin.isTTY === true);
  let providersChoice = null;

  if (interactive) {
    const prompt = createPrompt();
    const providers = readJson(join(root, "catalog", "providers.json"), []);
    process.stdout.write("\nNovahiz setup\n");
    process.stdout.write(`  Home:            ${home}\n`);
    process.stdout.write(`  opencode config: ${configDir}\n`);
    process.stdout.write(`  Skills:          ${skillsDir}\n`);
    process.stdout.write(`  Plugin:          ${join(pluginsDir, "novahiz.ts")}\n`);
    process.stdout.write(`  Agent:           ${join(configDir, "agent", "novahiz-agent.md")}\n`);
    process.stdout.write("\nProviders (optional, installed on your machine, never copied into the repo):\n");
    for (const provider of providers) {
      const source = provider.source ? ` ${provider.source}` : "";
      process.stdout.write(`  [${provider.kind}] ${provider.id} - ${provider.purpose ?? ""}${source}\n`);
    }
    process.stdout.write("\n");
    const proceed = await prompt.confirm("Install the Novahiz core (skills, plugin, agent)?", true);
    if (!proceed) {
      prompt.close();
      process.stdout.write("Aborted. Nothing was written.\n");
      return;
    }
    providersChoice = await prompt.confirm("Install provider packages and their prerequisites now?", false);
    prompt.close();
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
      const target = join(home, item);
      if (statSync(source).isDirectory()) {
        const result = copyInto(source, target, true);
        created.push(...result.created);
        backups.push(...result.backups);
      } else {
        const result = copyFileWithBackup(source, target, true);
        if (result.created) created.push(result.created);
        if (result.backup) backups.push(result.backup);
      }
    }
    coreCopied = true;
  }

  if (withSkills) {
    const skillsSource = existsSync(join(home, "skills")) ? join(home, "skills") : join(root, "skills");
    if (existsSync(skillsSource)) {
      const externalRoots = [join(homedir(), ".agents", "skills")];
      const alreadyInstalled = skillNamesIn(externalRoots);
      const force = Boolean(flags["force-skills"]);
      const entries = readdirSync(skillsSource, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      const skipped = force
        ? []
        : entries.filter((entry) => alreadyInstalled.has(entry.name)).map((entry) => entry.name);
      const toCopy = entries.filter((entry) => !skipped.includes(entry.name));
      note(`Installation des skills dans ${skillsDir} (${toCopy.length} a copier, ${skipped.length} deja presents ailleurs)`);
      if (!dryRun) {
        let total = 0;
        let added = 0;
        let saved = 0;
        for (const entry of toCopy) {
          const result = copyInto(join(skillsSource, entry.name), join(skillsDir, entry.name), true);
          created.push(...result.created);
          backups.push(...result.backups);
          total += result.total;
          added += result.created.length;
          saved += result.backups.length;
        }
        note(`  ${total} fichiers, ${added} nouveaux, ${saved} sauvegardes`);
      }
      if (skipped.length > 0) {
        note(`  deja presentes dans une autre racine, non recopiees: ${skipped.join(", ")}`);
        note("  Relance avec --force-skills pour les recopier malgre tout.");
      }
    } else {
      note(`Aucun dossier skills trouve a ${skillsSource}`);
    }

    // Copy bundled-skills
    const bundledSource = existsSync(join(home, "bundled-skills")) ? join(home, "bundled-skills") : join(root, "bundled-skills");
    if (existsSync(bundledSource)) {
      const bundledTarget = join(home, "bundled-skills");
      note(`Installation des bundled-skills dans ${bundledTarget}`);
      if (!dryRun) {
        const result = copyInto(bundledSource, bundledTarget, true);
        created.push(...result.created);
        backups.push(...result.backups);
        note(`  ${result.total} fichiers copies`);
      }
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

  const agentSource = existsSync(join(home, "adapters", "opencode", "agent", "novahiz-agent.md"))
    ? join(home, "adapters", "opencode", "agent", "novahiz-agent.md")
    : join(root, "adapters", "opencode", "agent", "novahiz-agent.md");
  const agentTarget = join(configDir, "agent", "novahiz-agent.md");
  if (existsSync(agentSource)) {
    note(`Installation de l'agent Novahiz dans ${agentTarget}`);
    if (!dryRun) {
      const result = copyFileWithBackup(agentSource, agentTarget, true);
      if (result.created) created.push(result.created);
      if (result.backup) backups.push(result.backup);
    }
  }

  const commandsSource = existsSync(join(home, "adapters", "opencode", "commands"))
    ? join(home, "adapters", "opencode", "commands")
    : join(root, "adapters", "opencode", "commands");
  const commandsTarget = join(configDir, "commands");
  if (existsSync(commandsSource)) {
    note(`Installation des commandes Novahiz dans ${commandsTarget}`);
    if (!dryRun) {
      const result = copyInto(commandsSource, commandsTarget, true);
      created.push(...result.created);
      backups.push(...result.backups);
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
    const cli = join(home, "src", "cli.ts");
    const config = readJson(join(home, "novahiz.config.json"), {});
    const autoInstall =
      providersChoice !== null
        ? providersChoice
        : Boolean(flags["install-providers"]) || config?.providers?.autoInstall === true;
    note("Verification des dependances");
    const check = spawnSync(process.execPath, [cli, "deps"], {
      encoding: "utf8",
      env: { ...process.env, NOVAHIZ_HOME: home }
    });
    if (check.stdout) process.stdout.write(check.stdout);
    if (autoInstall) {
      note("Installation des dependances et des providers (MCP, skills, commands)");
      const result = spawnSync(process.execPath, [cli, "deps", "--install"], {
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
    }
  }

  // Install MCP servers globally
  const mcpServers = [
    { pkg: "@upstash/context7-mcp", bin: "context7-mcp", name: "context7" },
    { pkg: "@anthropic-ai/narsil-mcp", bin: "narsil-mcp", name: "narsil" },
    { pkg: "@anthropic-ai/mcp-cron", bin: "mcp-cron", name: "cron" },
  ];

  if (!dryRun) {
    note("\nInstallation des MCP servers...");
    for (const server of mcpServers) {
      const check = spawnSync(process.platform === "win32" ? "where" : "which", [server.bin], {
        encoding: "utf8",
        stdio: "pipe"
      });
      if (check.status !== 0) {
        note(`  Installation de ${server.pkg}...`);
        const result = spawnSync("npm", ["install", "-g", server.pkg], {
          encoding: "utf8",
          stdio: "inherit"
        });
        if (result.status !== 0) {
          note(`  ATTENTION: Echec installation ${server.pkg} (non bloquant)`);
        } else {
          note(`  ${server.pkg} installe`);
        }
      } else {
        note(`  ${server.name} deja installe`);
      }
    }
  }

  // Install opencode plugins globally
  const plugins = [
    "@mohak34/opencode-notifier@0.2.8",
    "@tarquinen/opencode-dcp@latest",
  ];

  if (!dryRun) {
    note("\nInstallation des plugins opencode...");
    for (const plugin of plugins) {
      const pkgName = plugin.includes("@") ? plugin.split("@").slice(0, -1).join("@") || plugin.split("@")[1] : plugin;
      note(`  Installation de ${plugin}...`);
      const result = spawnSync("npm", ["install", "-g", plugin], {
        encoding: "utf8",
        stdio: "inherit"
      });
      if (result.status !== 0) {
        note(`  ATTENTION: Echec installation ${plugin} (non bloquant)`);
      } else {
        note(`  ${plugin} installe`);
      }
    }
  }

  // Generate opencode.jsonc
  if (!dryRun) {
    const configPath = join(configDir, "opencode.jsonc");
    if (!existsSync(configPath)) {
      note(`\nCreation de ${configPath}`);
      const bundledDir = join(home, "bundled-skills");
      const agentsSkillsDir = join(homedir(), ".config", ".agents", "skills");
      
      const openCodeConfig = {
        "$schema": "https://opencode.ai/config.json",
        "mcp": {
          "context7": {
            "type": "local",
            "command": ["context7-mcp", "--transport", "stdio"],
            "enabled": true
          },
          "narsil": {
            "type": "local",
            "command": ["narsil-mcp", "--repos", ".", "--git", "--persist"],
            "timeout": 120000,
            "enabled": true
          },
          "cron": {
            "type": "local",
            "command": ["mcp-cron", "--transport", "stdio"],
            "enabled": true
          },
          "playwright": {
            "type": "local",
            "command": ["npx", "@playwright/mcp@latest", "--browser=msedge"],
            "enabled": true
          },
          "supabase": {
            "type": "remote",
            "url": "https://mcp.supabase.com/mcp?features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching",
            "enabled": true
          },
          "expo": {
            "type": "remote",
            "url": "https://mcp.expo.dev/mcp",
            "enabled": true
          }
        },
        "skills": {
          "paths": [skillsDir]
        },
        "plugin": [
          "@mohak34/opencode-notifier@0.2.8",
          "@tarquinen/opencode-dcp@latest",
          join(home, "adapters", "opencode", "novahiz.ts")
        ],
        "compaction": {
          "auto": true,
          "prune": true,
          "reserved": 10000
        },
        "shell": process.platform === "win32" ? "pwsh" : "bash"
      };

      // Add bundled-skills if it exists
      if (existsSync(bundledDir)) {
        openCodeConfig.skills.paths.push(bundledDir);
      }

      // Add .agents/skills if it exists
      if (existsSync(agentsSkillsDir)) {
        openCodeConfig.skills.paths.push(agentsSkillsDir);
      }

      writeFileSync(configPath, JSON.stringify(openCodeConfig, null, 2) + "\n", "utf8");
      note(`  ${configPath} cree`);
    } else {
      note(`\n${join(configDir, "opencode.jsonc")} existe deja, non ecrase`);
    }
  }

  if (!dryRun) {
    process.stdout.write(`\nNovahiz installe dans ${home}.\n`);
    process.stdout.write("Redemarre opencode pour activer le plugin et le serveur MCP.\n");
    process.stdout.write("Gate desactivable avec la variable d'environnement NOVAHIZ_GATE=off.\n");
    
    // Auto-update dependencies
    note("Verification des mises a jour des dependances...");
    const pkgPath = join(home, "package.json");
    if (existsSync(pkgPath)) {
      const npmCheck = spawnSync("npm", ["outdated", "--json"], {
        encoding: "utf8",
        cwd: home,
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (npmCheck.stdout && npmCheck.stdout.trim().length > 2) {
        note("Mises a jour disponibles, installation en cours...");
        const npmUpdate = spawnSync("npm", ["update"], {
          encoding: "utf8",
          cwd: home,
          env: { ...process.env, NOVAHIZ_HOME: home }
        });
        if (npmUpdate.stdout) process.stdout.write(npmUpdate.stdout);
        if (npmUpdate.status !== 0 && npmUpdate.stderr) process.stderr.write(npmUpdate.stderr);
        note("Dependances mises a jour.");
      } else {
        note("Dependances a jour.");
      }
    }
  } else {
    process.stdout.write("\nDry-run termine, aucune modification ecrite.\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
