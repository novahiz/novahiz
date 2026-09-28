#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  copyFileWithBackup,
  copyInto,
  defaultConfig,
  detectedHarnesses,
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
  spawnHost,
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
  "docs",
  "package.json",
  "tsconfig.json",
  "LICENSE",
  "README.md",
  "NOTICE.md",
  "novahiz.config.example.json"
];

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
    const message = `Node ${process.versions.node} is too old. Node 22.18 or later is required.`;
    if (dryRun) {
      // postinstall (`npm install novahiz`) runs this in dry-run mode and must
      // never fail the parent install on an older Node — warn and keep going.
      note(`WARNING: ${message} The novahiz CLI will not run until Node is upgraded.`);
    } else {
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
  }

  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const codexDir = process.env.CODEX_HOME || join(homedir(), ".codex");
  const harnessDirs = { opencode: configDir, claude: claudeDir, codex: codexDir };
  const harnessPackages = {
    opencode: "opencode-ai",
    claude: "@anthropic-ai/claude-code",
    codex: "@openai/codex"
  };
  const detected = detectedHarnesses(harnessDirs);

  const yes = Boolean(flags.yes) || Boolean(flags["yes"]);
  const interactive = !yes && !dryRun && (Boolean(flags.interactive) || process.stdin.isTTY === true);
  let providersChoice = null;
  let harnessChoice = null;

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
    harnessChoice = await prompt.select(
      "Which harnesses should Novahiz configure?",
      ["opencode", "claude", "codex"],
      detected.length > 0 ? detected : ["opencode"]
    );
    prompt.close();
  }

  // Harness resolution: --harness flag > interactive select > detection
  // (--yes and non-interactive runs take every detected harness, falling
  // back to opencode so a fresh machine still gets a working baseline).
  const flagHarnesses =
    typeof flags.harness === "string"
      ? flags.harness
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter((value) => ["opencode", "claude", "codex"].includes(value))
      : [];
  const configured = [
    ...new Set(
      flagHarnesses.length > 0
        ? flagHarnesses
        : harnessChoice && harnessChoice.length > 0
          ? harnessChoice
          : detected.length > 0
            ? detected
            : ["opencode"]
    )
  ];
  if (flags["no-claude"]) {
    const index = configured.indexOf("claude");
    if (index !== -1) configured.splice(index, 1);
  }
  note(`Harnesses to configure: ${configured.length > 0 ? configured.join(", ") : "(none)"}`);

  // Auto-install the CLI of every selected harness that is entirely absent
  // (no config dir and no binary). A harness already on the machine - CLI or
  // desktop config dir - is left alone, and a harness that was not selected
  // is never installed nor configured. Failures stay non-blocking, like the
  // historical opencode behaviour.
  for (const name of configured) {
    const hasCli = which(name);
    const hasDir = existsSync(harnessDirs[name]);
    if (hasCli) {
      note(`${name} detected.`);
      continue;
    }
    if (hasDir) {
      note(`${name} config present in ${harnessDirs[name]}; ${name} CLI not on PATH (optional).`);
      continue;
    }
    const pkg = harnessPackages[name];
    if (dryRun) {
      note(`Would install ${name} globally (npm install -g ${pkg}).`);
      continue;
    }
    note(`${name} not detected. Global installation...`);
    const installResult = spawnHost("npm", ["install", "-g", pkg], { stdio: "inherit" });
    if (installResult.status !== 0) {
      note(`WARNING: Failed to install ${name} automatically (non-blocking). Run: npm install -g ${pkg}`);
    } else {
      note(`${name} installed successfully.`);
    }
  }

  if (!dryRun) {
    for (const name of configured) {
      if (!existsSync(harnessDirs[name])) mkdirSync(harnessDirs[name], { recursive: true });
    }
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

  if (withSkills && !configured.includes("opencode")) {
    note("Skipping opencode skills copy (opencode not selected).");
  }
  if (withSkills && configured.includes("opencode")) {
    const skillsSource = existsSync(join(home, "skills")) ? join(home, "skills") : join(root, "skills");
    if (existsSync(skillsSource)) {
      // Dedup only against roots the catalog actually scans (see
      // skillRoots): ~/.claude/skills is deliberately absent, or an
      // opencode install would skip skills that only Claude has.
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
  }

  const pluginSource = join(home, "adapters", "opencode", "novahiz.ts");
  const pluginTarget = join(pluginsDir, "novahiz.ts");
  if (configured.includes("opencode") && existsSync(pluginSource)) {
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
  if (configured.includes("opencode") && existsSync(agentSource)) {
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
  if (configured.includes("opencode") && existsSync(commandsSource)) {
    note(`Installing Novahiz commands in ${commandsTarget}`);
    if (!dryRun) {
      const result = copyInto(commandsSource, commandsTarget, true);
      created.push(...result.created);
      backups.push(...result.backups);
    }
  }

  if (configured.includes("claude") && !flags["no-claude"] && existsSync(claudeDir)) {
    const claudeSkillsDir = join(claudeDir, "skills");
    if (withSkills) {
      const claudeSkillsSource = existsSync(join(home, "skills")) ? join(home, "skills") : join(root, "skills");
      if (existsSync(claudeSkillsSource)) {
        const otherRoots = [join(homedir(), ".agents", "skills")];
        const alreadyInstalled = flags["force-skills"] ? new Set() : skillNamesIn(otherRoots);
        const entries = readdirSync(claudeSkillsSource, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .sort((a, b) => (a.name < b.name ? -1 : 1));
        const toCopy = entries.filter((entry) => !alreadyInstalled.has(entry.name));
        note(`Installing Claude skills in ${claudeSkillsDir} (${toCopy.length} to copy, ${entries.length - toCopy.length} already present elsewhere)`);
        if (!dryRun) {
          for (const entry of toCopy) {
            const result = copyInto(join(claudeSkillsSource, entry.name), join(claudeSkillsDir, entry.name), true);
            created.push(...result.created);
            backups.push(...result.backups);
          }
        }
      }
    }

    const claudeCommandsSource = existsSync(join(home, "adapters", "opencode", "commands"))
      ? join(home, "adapters", "opencode", "commands")
      : join(root, "adapters", "opencode", "commands");
    if (existsSync(claudeCommandsSource)) {
      const claudeCommandsTarget = join(claudeDir, "commands");
      note(`Installing Claude commands in ${claudeCommandsTarget}`);
      if (!dryRun) {
        const result = copyInto(claudeCommandsSource, claudeCommandsTarget, true);
        created.push(...result.created);
        backups.push(...result.backups);
      }
    }

    const claudeAgentSource = existsSync(join(home, "adapters", "claude", "agent", "novahiz.md"))
      ? join(home, "adapters", "claude", "agent", "novahiz.md")
      : join(root, "adapters", "claude", "agent", "novahiz.md");
    if (existsSync(claudeAgentSource)) {
      const claudeAgentTarget = join(claudeDir, "agents", "novahiz.md");
      note(`Installing Claude agent in ${claudeAgentTarget}`);
      if (!dryRun) {
        const result = copyFileWithBackup(claudeAgentSource, claudeAgentTarget, true);
        if (result.created) created.push(result.created);
        if (result.backup) backups.push(result.backup);
      }
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
      writeJson(configPath, defaultConfig());
      configCreated = !existedBefore;
    }
  } else {
    note(`Existing config preserved: ${configPath}`);
  }

  if (!dryRun) {
    const previous = loadManifest(home);
    const pkgVersion = readJson(join(root, "package.json"), {}).version ?? "0.0.0";
    saveManifest(home, {
      version: pkgVersion,
      installedAt: new Date().toISOString(),
      harness: "opencode",
      harnesses: [...configured],
      configDir,
      home,
      coreCopied: previous.coreCopied || coreCopied,
      configCreated: previous.configCreated || configCreated,
      created: mergeCreated(previous.created, created),
      backups: mergeBackups(previous.backups, backups)
    });
  }

  // Ground Claude Code and Codex on the novahiz hooks (PreToolUse gate +
  // MCP registration). Only the selected harnesses are ever wired.
  const hookHarnesses = configured.filter((name) => name === "claude" || name === "codex");
  if (hookHarnesses.length > 0) {
    if (dryRun) {
      note(`Would configure hooks for ${hookHarnesses.join(", ")} (settings.json / hooks.json + MCP).`);
    } else {
      const hooksScript = join(home, "install", "hooks.mjs");
      if (existsSync(hooksScript)) {
        note(`Configuring hooks for ${hookHarnesses.join(", ")}`);
        const result = spawnSync(process.execPath, [hooksScript, "--harness", hookHarnesses.join(","), "--home", home], {
          encoding: "utf8",
          env: { ...process.env, NOVAHIZ_HOME: home }
        });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
      } else {
        note(`WARNING: ${hooksScript} not found, hooks were not configured.`);
      }
    }
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
    { pkg: "narsil-mcp", bin: "narsil-mcp", name: "narsil" },
    { pkg: "security-mcp", bin: "security-mcp", name: "security" },
  ];
  // context7 is invoked via `npx -y @upstash/context7-mcp@4.1.1` (pinned in
  // the generated config), so no global shim is installed for it.
  // `cron` has no npm package and ships disabled (local scheduler clone only);
  // enable it after the local setup documented in docs/PROVIDERS.md.

  if (!dryRun) {
    note("\nInstalling MCP servers...");
    for (const server of mcpServers) {
      const check = spawnSync(process.platform === "win32" ? "where" : "which", [server.bin], {
        encoding: "utf8",
        stdio: "pipe"
      });
      if (check.status !== 0) {
        note(`  Installing ${server.pkg}...`);
        const result = spawnHost("npm", ["install", "-g", server.pkg], {
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
    // Official Dart/Flutter MCP ships with the Dart SDK (dart mcp-server), not npm.
    const dartCheck = spawnSync(process.platform === "win32" ? "where" : "which", ["dart"], {
      encoding: "utf8",
      stdio: "pipe"
    });
    if (dartCheck.status === 0) {
      note("  dart (mcp-server) available via Dart SDK");
    } else {
      note("  WARNING: Dart SDK not on PATH — MCP `dart` will not start until `dart` is installed");
    }
  }

  // Optional official Flutter/Dart skill packs (upstream install, never vendored).
  const skillPacks = [
    { id: "flutter-skills", repo: "flutter/agent-plugins" },
    { id: "dart-skills", repo: "dart-lang/skills" },
  ];
  if (!dryRun && flags["flutter-skills"]) {
    note("\nInstalling official Flutter/Dart skill packs...");
    for (const pack of skillPacks) {
      note(`  ${pack.repo}...`);
      const result = spawnHost(
        "npx",
        ["-y", "skills", "add", pack.repo, "--skill", "*", "-g", "-a", "opencode", "-y"],
        { stdio: "inherit" }
      );
      if (result.status !== 0) {
        note(`  WARNING: Failed to install ${pack.repo} (non-blocking)`);
      }
    }
  } else if (!dryRun) {
    note("\nSkipping Flutter/Dart skill packs (pass --flutter-skills to install from official repos).");
  }

  // Install opencode plugins globally.
  // 2026-09-26: intentionally empty — @mohak34/opencode-notifier and
  // @tarquinen/opencode-dcp were uninstalled on purpose; reinstating them
  // would resurrect a removed compression/notify stack against the user's
  // decision. Keep this list empty unless a new plugin is explicitly wanted.
  const plugins = [];

  if (!dryRun && plugins.length > 0) {
    note("\nInstalling opencode plugins...");
    for (const plugin of plugins) {
      note(`  Installing ${plugin}...`);
      const result = spawnHost("npm", ["install", "-g", plugin], {
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
  if (!configured.includes("opencode")) {
    note("Skipping opencode.jsonc (opencode not selected).");
  }
  if (!dryRun && configured.includes("opencode")) {
    const configPath = join(configDir, "opencode.jsonc");
    if (!existsSync(configPath)) {
      note(`\nCreating ${configPath}`);
      const agentsSkillsDir = join(homedir(), ".agents", "skills");
      const agentsSkillsDirLegacy = join(homedir(), ".config", ".agents", "skills");

      const openCodeConfig = {
        "$schema": "https://opencode.ai/config.json",
        "mcp": {
          "context7": {
            "type": "local",
            "command": ["npx", "-y", "@upstash/context7-mcp@4.1.1", "--transport", "stdio"],
            "enabled": true
          },
          "narsil": {
            "type": "local",
            "command": ["narsil-mcp", "--repos", ".", "--git", "--persist"],
            "timeout": 120000,
            "enabled": true
          },
          // `cron` ships disabled by default: no template entry here, enable it
          // after the local scheduler clone setup (docs/PROVIDERS.md).
          "playwright": {
            "type": "local",
            "command": ["npx", "-y", "@playwright/mcp@0.0.82", "--browser=msedge"],
            "enabled": true
          },
          "dart": {
            "type": "local",
            "command": ["dart", "mcp-server"],
            "enabled": true
          }
        },
        "skills": {
          "paths": [skillsDir]
        },
        "plugin": [
          join(home, "adapters", "opencode", "novahiz.ts")
        ],
        "compaction": {
          "auto": true,
          "prune": true,
          "reserved": 10000
        },
        "shell": process.platform === "win32" ? "pwsh" : "bash"
      };

      // Official skills land in ~/.agents/skills (skills CLI) — load them too.
      for (const dir of [agentsSkillsDir, agentsSkillsDirLegacy]) {
        if (existsSync(dir) && !openCodeConfig.skills.paths.includes(dir)) {
          openCodeConfig.skills.paths.push(dir);
        }
      }

      writeFileSync(configPath, JSON.stringify(openCodeConfig, null, 2) + "\n", "utf8");
      note(`  ${configPath} created`);
    } else {
      note(`\n${join(configDir, "opencode.jsonc")} already exists, not overwritten`);
    }
  }

  if (!dryRun) {
    process.stdout.write(`\nNovahiz installed in ${home}.\n`);
    if (configured.length > 0) {
      const names = configured.map((name) => (name === "claude" ? "Claude Code" : name === "codex" ? "Codex" : "opencode"));
      process.stdout.write(`Restart ${names.join(" and ")} to activate the plugin, hooks and MCP server.\n`);
    }
    process.stdout.write("Gate can be disabled with the NOVAHIZ_GATE=off environment variable.\n");
    
    // Auto-update dependencies
    note("Checking for dependency updates...");
    const pkgPath = join(home, "package.json");
    if (existsSync(pkgPath)) {
      const npmCheck = spawnHost("npm", ["outdated", "--json"], {
        cwd: home,
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (npmCheck.stdout && npmCheck.stdout.trim().length > 2) {
        note("Updates available, installing...");
        const npmUpdate = spawnHost("npm", ["update"], {
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
  // postinstall (`npm install novahiz`) runs --dry-run: an unexpected crash
  // must not fail the parent install.
  if (parseArgs(process.argv.slice(2))["dry-run"]) {
    process.stderr.write("Dry-run failed (non-blocking; the npm install continues).\n");
    process.exit(0);
  }
  process.exit(1);
});
