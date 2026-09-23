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
  NovahizHome,
  opencodeConfigDir,
  parseArgs,
  readJson,
  repoRoot,
  saveManifest,
  skillNamesIn,
  which,
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
  const home = NovahizHome(flags);
  const configDir = flags.scope === "project" ? resolve(".opencode") : opencodeConfigDir();
  const skillsDir = join(configDir, "skills");
  const pluginsDir = join(configDir, "plugins");

  const note = (message) => process.stdout.write(`${dryRun ? "[dry-run] " : ""}${message}\n`);

  note(`novahiz home: ${home}`);
  note(`opencode config: ${configDir}`);

  if (!nodeVersionOk()) {
    process.stderr.write(`Node ${process.versions.node} is too old. Node 22.18 or later is required.\n`);
    process.exit(1);
  }

  // Check for opencode and auto-install if missing
  if (!which("opencode")) {
    note("opencode not detected. Global installation...");
    const installResult = spawnSync("npm", ["install", "-g", "opencode"], {
      encoding: "utf8",
      stdio: "inherit"
    });
    if (installResult.status !== 0) {
      process.stderr.write("Failed to install opencode. Try: npm install -g opencode\n");
      process.exit(1);
    }
    note("opencode installed successfully.");
  } else {
    note("opencode detected.");
  }

  const yes = Boolean(flags.yes) || Boolean(flags["yes"]);
  const interactive = !yes && !dryRun && (Boolean(flags.interactive) || process.stdin.isTTY === true);
  let providersChoice = null;

  if (interactive) {
    const prompt = createPrompt();
    const providers = readJson(join(root, "catalog", "providers.json"), []);
    process.stdout.write("\nnovahiz setup\n");
    process.stdout.write(`  Home:            ${home}\n`);
    process.stdout.write(`  opencode config: ${configDir}\n`);
    process.stdout.write(`  Skills:          ${skillsDir}\n`);
    process.stdout.write(`  Plugin:          ${join(pluginsDir, "novahiz.ts")}\n`);
    process.stdout.write(`  Agent:           ${join(configDir, "agent", "novahiz.md")}\n`);
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
    note(`Copying core to ${home}`);
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
      // renamed: the outer `force` (--force, config overwrite) lives in the
      // same function scope — shadowing it here was correct but unreadable.
      const forceSkills = Boolean(flags["force-skills"]);
      const entries = readdirSync(skillsSource, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      const skipped = forceSkills
        ? []
        : entries.filter((entry) => alreadyInstalled.has(entry.name)).map((entry) => entry.name);
      const toCopy = entries.filter((entry) => !skipped.includes(entry.name));
      note(`Installing skills in ${skillsDir} (${toCopy.length} to copy, ${skipped.length} already present elsewhere)`);
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
        note(`  ${total} files, ${added} new, ${saved} backups`);
      }
      if (skipped.length > 0) {
        note(`  already present in another root, not copied: ${skipped.join(", ")}`);
        note("  Restart with --force-skills to copy them anyway.");
      }
    } else {
      note(`No skills folder found at ${skillsSource}`);
    }

    // Copy bundled-skills
    const bundledSource = existsSync(join(home, "bundled-skills")) ? join(home, "bundled-skills") : join(root, "bundled-skills");
    if (existsSync(bundledSource)) {
      const bundledTarget = join(home, "bundled-skills");
      note(`Installing bundled-skills in ${bundledTarget}`);
      if (!dryRun) {
        const result = copyInto(bundledSource, bundledTarget, true);
        created.push(...result.created);
        backups.push(...result.backups);
        note(`  ${result.total} files copied`);
      }
    }
  }

  const pluginSource = join(home, "adapters", "opencode", "novahiz.ts");
  const pluginTarget = join(pluginsDir, "novahiz.ts");
  if (existsSync(pluginSource)) {
    note(`Installing opencode plugin in ${pluginTarget}`);
    if (!dryRun) {
      const result = copyFileWithBackup(pluginSource, pluginTarget, true);
      if (result.created) created.push(result.created);
      if (result.backup) backups.push(result.backup);
    }
  }

  const agentSource = existsSync(join(home, "adapters", "opencode", "agent", "novahiz.md"))
    ? join(home, "adapters", "opencode", "agent", "novahiz.md")
    : join(root, "adapters", "opencode", "agent", "novahiz.md");
  const agentTarget = join(configDir, "agent", "novahiz.md");
  if (existsSync(agentSource)) {
    note(`Installing Novahiz agent in ${agentTarget}`);
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
    note(`Installing Novahiz commands in ${commandsTarget}`);
    if (!dryRun) {
      const result = copyInto(commandsSource, commandsTarget, true);
      created.push(...result.created);
      backups.push(...result.backups);
    }
  }

  const configPath = join(home, "novahiz.config.json");
  if (force || !existsSync(configPath)) {
    note(`Writing ${configPath}`);
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
    note(`Existing config preserved: ${configPath}`);
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
      note("Building catalog (sync)");
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
    note("Checking dependencies");
    const check = spawnSync(process.execPath, [cli, "deps"], {
      encoding: "utf8",
      env: { ...process.env, NOVAHIZ_HOME: home }
    });
    if (check.stdout) process.stdout.write(check.stdout);
    if (autoInstall) {
      note("Installing dependencies and providers (MCP, skills, commands)");
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
    note("\nInstalling MCP servers...");
    for (const server of mcpServers) {
      const check = spawnSync(process.platform === "win32" ? "where" : "which", [server.bin], {
        encoding: "utf8",
        stdio: "pipe"
      });
      if (check.status !== 0) {
        note(`  Installing ${server.pkg}...`);
        const result = spawnSync("npm", ["install", "-g", server.pkg], {
          encoding: "utf8",
          stdio: "inherit"
        });
        if (result.status !== 0) {
          note(`  WARNING: Failed to install ${server.pkg} (non-blocking)`);
        } else {
          note(`  ${server.pkg} installed`);
        }
      } else {
        note(`  ${server.name} already installed`);
      }
    }
  }

  // Install opencode plugins globally
  const plugins = [
    "@mohak34/opencode-notifier@0.2.8",
    "@tarquinen/opencode-dcp@latest",
  ];

  if (!dryRun) {
    note("\nInstalling opencode plugins...");
    for (const plugin of plugins) {
      note(`  Installing ${plugin}...`);
      const result = spawnSync("npm", ["install", "-g", plugin], {
        encoding: "utf8",
        stdio: "inherit"
      });
      if (result.status !== 0) {
        note(`  WARNING: Failed to install ${plugin} (non-blocking)`);
      } else {
        note(`  ${plugin} installed`);
      }
    }
  }

  // Generate opencode.jsonc
  if (!dryRun) {
    const configPath = join(configDir, "opencode.jsonc");
    if (!existsSync(configPath)) {
      note(`\nCreating ${configPath}`);
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
      note(`  ${configPath} created`);
    } else {
      note(`\n${join(configDir, "opencode.jsonc")} already exists, not overwritten`);
    }
  }

  if (!dryRun) {
    process.stdout.write(`\nNovahiz installed in ${home}.\n`);
    process.stdout.write("Restart opencode to activate the plugin and the MCP server.\n");
    process.stdout.write("Gate can be disabled with the NOVAHIZ_GATE=off environment variable.\n");
    
    // Auto-update dependencies
    note("Checking for dependency updates...");
    const pkgPath = join(home, "package.json");
    if (existsSync(pkgPath)) {
      const npmCheck = spawnSync("npm", ["outdated", "--json"], {
        encoding: "utf8",
        cwd: home,
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (npmCheck.stdout && npmCheck.stdout.trim().length > 2) {
        note("Updates available, installing...");
        const npmUpdate = spawnSync("npm", ["update"], {
          encoding: "utf8",
          cwd: home,
          env: { ...process.env, NOVAHIZ_HOME: home }
        });
        if (npmUpdate.stdout) process.stdout.write(npmUpdate.stdout);
        if (npmUpdate.status !== 0 && npmUpdate.stderr) process.stderr.write(npmUpdate.stderr);
        note("Dependencies updated.");
      } else {
        note("Dependencies up to date.");
      }
    }
  } else {
    process.stdout.write("\nDry-run complete, no changes written.\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
