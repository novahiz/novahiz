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
  playwrightBrowserFlag,
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
  "CHANGELOG.md",
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

  const harnessDirs = { opencode: configDir };
  const harnessPackages = { opencode: "opencode-ai" };
  const detected = detectedHarnesses(harnessDirs);

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
    process.stdout.write(`  Plugin:          ${join(pluginsDir, "novahiz-plugin.ts")}\n`);
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

  // Harness resolution: --harness flag > detection (opencode is the only
  // supported harness; --yes and non-interactive runs take the detection,
  // falling back to opencode so a fresh machine still gets a baseline).
  const flagHarnesses =
    typeof flags.harness === "string"
      ? flags.harness
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value === "opencode")
      : [];
  const configured = [
    ...new Set(
      flagHarnesses.length > 0
        ? flagHarnesses
        : detected.length > 0
          ? detected
          : ["opencode"]
    )
  ];
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
      // skillRoots): ~/.agents/skills is the only external root.
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

  // opencode charge automatiquement les .ts de <config>/plugins. Preuve E2E:
  // le tableau "plugin" de la config pointait vers ce depôt alors que les
  // plugins charges venaient de <config>/plugins — le tableau est donc retire
  // du modele de config, une entree fichier y declenchait l'avertissement
  // "configured plugin path must be a directory" a chaque demarrage.
  for (const pluginFile of ["novahiz-plugin.ts", "novahiz-token-economy.ts"]) {
    const pluginSource = join(home, "adapters", "opencode", pluginFile);
    const pluginTarget = join(pluginsDir, pluginFile);
    if (configured.includes("opencode") && existsSync(pluginSource)) {
      note(`Installing opencode plugin in ${pluginTarget}`);
      if (!dryRun) {
        const result = copyFileWithBackup(pluginSource, pluginTarget, true);
        if (result.created) created.push(result.created);
        if (result.backup) backups.push(result.backup);
      }
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
      const result = spawnSync(process.execPath, [cli, "deps", "--install", "--yes"], {
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
    }
  }

  // Install MCP servers globally.
  // 2026-10-05: security-mcp was removed on purpose and the mcp-cron shim
  // before it — reinstating either would resurrect a removed server against
  // the user's explicit decision (never reinstall, ever). The purge below
  // enforces the removal on every run, and providers.disabled in
  // novahiz.config.json keeps security out of the registry. The only entry
  // here is Playwright MCP: installing it up front means no npx download on
  // first use (latency, offline failure), and the version pin comes from
  // catalog/providers.json so the doctor R6 drift check stays aligned.
  const playwrightPkg = (() => {
    try {
      const providers = readJson(join(root, "catalog", "providers.json"), []);
      const entry = providers.find((provider) => provider.id === "playwright");
      const command = Array.isArray(entry?.command) ? entry.command : [];
      const pin = command.find((token) => typeof token === "string" && token.includes("@playwright/mcp"));
      return typeof pin === "string" ? pin : "@playwright/mcp@0.0.82";
    } catch {
      return "@playwright/mcp@0.0.82";
    }
  })();
  const mcpServers = [
    { pkg: playwrightPkg, bin: "playwright-mcp", name: "playwright" },
  ];
  // `novahiz-docs` is a local file run through `node` (no package, no shim:
  // the config points straight at <home>/mcp/novahiz-docs/index.mjs).
  // `lodestone` is a local file run through `node` too (house clean-room
  // server, zero npm dependency): no package, no shim.
  // `clepsydre` is a local file run through `node` (house scheduler, zero npm
  // dependency): no package, no shim.

  if (!dryRun) {
    note("\nMCP servers: playwright installed globally; removed servers stay removed.");
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

    // Removed on purpose: purge any trace of the removed servers on every run
    // so a stray reinstall cannot survive (security-mcp, former mcp-cron).
    for (const pkg of ["security-mcp", "mcp-cron"]) {
      const probe = spawnSync(process.platform === "win32" ? "where" : "which", [pkg], {
        encoding: "utf8",
        stdio: "pipe"
      });
      if (probe.status === 0) {
        note(`  ${pkg} found but removed on purpose — uninstalling (never reinstall)...`);
        const removal = spawnHost("npm", ["uninstall", "-g", pkg], { stdio: "inherit" });
        note(removal.status === 0 ? `  ${pkg} uninstalled` : `  WARNING: could not uninstall ${pkg} — run: npm uninstall -g ${pkg}`);
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
          "novahiz-docs": {
            "type": "local",
            "command": ["node", join(home, "mcp", "novahiz-docs", "index.mjs")],
            "enabled": true
          },
          "novahiz-search": {
            "type": "local",
            "command": ["node", join(home, "mcp", "lodestone", "index.mjs")],
            "timeout": 120000,
            "enabled": true
          },
          // `novahiz-scheduler` is the local scheduler (mcp/clepsydre, zero npm
          // dependency): it ships ready to run, no setup step.
          "novahiz-scheduler": {
            "type": "local",
            "command": ["node", join(home, "mcp", "clepsydre", "index.mjs")],
            "timeout": 120000,
            "enabled": true
          },
          "playwright": {
            "type": "local",
            // See playwrightBrowserFlag() in lib.mjs for the platform rule.
            "command": ["npx", "-y", "@playwright/mcp@0.0.82", playwrightBrowserFlag()],
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
        "compaction": {
          "auto": true,
          "prune": true,
          "reserved": 10000
        },
        // PowerShell 7 (pwsh) is NOT bundled with Windows — Windows ships
        // Windows PowerShell 5.1 (powershell.exe). Writing a hard "pwsh" gave
        // every machine without PS7 an opencode config whose shell does not
        // exist; probe and fall back to the one that always does. bash is
        // universal on macOS/Linux.
        "shell": process.platform === "win32" ? (which("pwsh") ? "pwsh" : "powershell") : "bash"
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
      process.stdout.write(`Restart opencode to activate the plugin and MCP server.\n`);
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
    process.stdout.write(
      "Next step: run `novahiz-install` (or `novahiz setup`) once to install everything — core skills, plugin, agent, provider skill packs (impeccable, flutter, dart, expo), and MCP servers. Then restart opencode.\n"
    );
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
