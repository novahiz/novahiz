#!/usr/bin/env node
import { cpSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  copyFileWithBackup,
  copyInto,
  defaultConfig,
  deferOpencodePhase,
  detectedHarnesses,
  findNpmAncestorPid,
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
  waitForDeferredPhase,
  which,
  writeJson
} from "./lib.mjs";
import { createPrompt } from "./prompt.mjs";
import { createInstallerUI } from "./ui.mjs";

// Etapes visibles par l'utilisateur, dans l'ordre reel d'execution. La barre
// de progression se base sur cette liste : toute section ajoutee ici doit
// appeler ui.step() une fois (les sauts conditionnels passent par
// ui.finishStep("skip")).
const STEPS = [
  "Preflight & harnesses",
  "Core files",
  "Skills",
  "Plugin, agent & commands",
  "Configuration",
  "Catalog & dependencies",
  "MCP servers",
  "opencode config",
  "Obsidian vault (second-memory)",
  "Finalize"
];

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
  // Phase opencode rejetee hors du cycle de vie npm (voir lib.mjs) : sous
  // postinstall, le passage synchronise n'ecrit plus que dans NOVAHIZ_HOME —
  // jamais dans le dossier de config opencode que le serveur surveille.
  const deferOpencode = deferOpencodePhase(flags);
  const force = Boolean(flags.force);
  const withSkills = !flags["no-skills"];
  const root = repoRoot(import.meta.url);
  const home = NovahizHome(flags);
  const configDir = flags.scope === "project" ? resolve(".opencode") : opencodeConfigDir();
  const skillsDir = join(configDir, "skills");
  const pluginsDir = join(configDir, "plugins");

  // Banniere + journal d'etape : ui.note route l'ancien note() (prefixe
  // dry-run gere par ui), ui.step decoupe le flux en sections affichees.
  const ui = createInstallerUI({ steps: STEPS, dryRun });
  ui.banner();

  const note = (message) => ui.note(String(message).replace(/^\n+/, ""));

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

  // Phase differee, spawn des le debut du postinstall : l'enfant attendra la
  // mort de ce postinstall puis de npm avant d'ecrire quoi que ce soit dans
  // la config opencode. Detache tot (detached + unref) : un redemarrage
  // opencode qui tuerait npm ne l'atteint plus — la configuration rejoint
  // alors la nouvelle version au lieu de rester bloquee a l'ancienne.
  const deferLogPath = deferOpencode && !dryRun ? join(home, "install-deferred.log") : null;
  if (deferLogPath) {
    mkdirSync(home, { recursive: true });
    const npmAncestor = findNpmAncestorPid();
    const logFd = openSync(deferLogPath, "a");
    // argv[1] du parent = ce meme script : l'enfant doit le recevoir, sinon
    // node interprete --yes comme une option sienne ("bad option: --yes").
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), "--deferred-opencode"], {
      // cwd = home, NOT the inherited package dir: a process whose cwd sits
      // inside node_modules\novahiz makes any npm retire of that directory
      // fail with EBUSY on Windows (that is what let the nested-update
      // rollback restore the old package). The child lives for minutes, so
      // it must never hold the package dir. Consequence: with an explicit
      // `--scope project`, configDir resolves against home instead of the
      // caller's cwd (postinstall never passes --scope).
      cwd: home,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        NOVAHIZ_DEFERRED: "1",
        NOVAHIZ_WAIT_PARENT_PID: String(process.pid),
        NOVAHIZ_WAIT_PID: npmAncestor === null ? "" : String(npmAncestor),
      },
      windowsHide: true,
    });
    child.unref();
    closeSync(logFd);
    note(`Opencode config phase deferred (npm still running) - log: ${deferLogPath}`);
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
  ui.step("Preflight & harnesses");
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
    // stdio:inherit : l'enfant ecrit directement dans le terminal — la ligne
    // vivante est suspendue pour eviter tout chevauchement.
    ui.suspend();
    const installResult = spawnHost("npm", ["install", "-g", pkg], { stdio: "inherit" });
    ui.resume();
    if (installResult.status !== 0) {
      note(`WARNING: Failed to install ${name} automatically (non-blocking). Run: npm install -g ${pkg}`);
    } else {
      note(`${name} installed successfully.`);
    }
  }

  if (!dryRun && !deferOpencode) {
    for (const name of configured) {
      if (!existsSync(harnessDirs[name])) mkdirSync(harnessDirs[name], { recursive: true });
    }
  }

  const created = [];
  const backups = [];
  let coreCopied = false;
  let configCreated = false;

  const sameRoot = resolve(root) === resolve(home);
  ui.step("Core files");
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

  ui.step("Skills");
  if (deferOpencode) {
    note("Opencode skills copy deferred to the post-npm phase.");
    ui.finishStep("skip", "deferred");
  }
  if (!deferOpencode && withSkills && !configured.includes("opencode")) {
    note("Skipping opencode skills copy (opencode not selected).");
  }
  if (!deferOpencode && withSkills && configured.includes("opencode")) {
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
  ui.step("Plugin, agent & commands");
  if (deferOpencode) {
    note("Plugin, agent & commands deferred to the post-npm phase.");
    ui.finishStep("skip", "deferred");
  }
  for (const pluginFile of ["novahiz-plugin.ts", "novahiz-token-economy.ts"]) {
    const pluginSource = join(home, "adapters", "opencode", pluginFile);
    const pluginTarget = join(pluginsDir, pluginFile);
    if (!deferOpencode && configured.includes("opencode") && existsSync(pluginSource)) {
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
  if (!deferOpencode && configured.includes("opencode") && existsSync(agentSource)) {
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
  if (!deferOpencode && configured.includes("opencode") && existsSync(commandsSource)) {
    note(`Installing Novahiz commands in ${commandsTarget}`);
    if (!dryRun) {
      const result = copyInto(commandsSource, commandsTarget, true);
      created.push(...result.created);
      backups.push(...result.backups);
    }
  }

  ui.step("Configuration");
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

  ui.step("Catalog & dependencies");
  if (!dryRun) {
    const cli = join(home, "src", "cli.ts");
    if (existsSync(cli)) {
      note("Building catalog (sync)");
      const result = spawnSync(process.execPath, [cli, "sync"], {
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (result.stdout) ui.raw(result.stdout);
      if (result.status !== 0 && result.stderr) ui.raw(result.stderr);
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
    if (check.stdout) ui.raw(check.stdout);
    if (autoInstall && deferOpencode) {
      note("Dependency/provider install deferred to the post-npm phase (skills and commands write into the opencode config).");
    } else if (autoInstall) {
      note("Installing dependencies and providers (MCP, skills, commands)");
      const result = spawnSync(process.execPath, [cli, "deps", "--install", "--yes"], {
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (result.stdout) ui.raw(result.stdout);
      if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
    }
  }

  // Seed de l'index documentaire (audit 2026-10-08) : sans ce remplissage,
  // read_docs repond « index vide » a chaque consultation — src/ingest.ts
  // n'avait aucun point d'entree. Le bouquet core couvre les piles de la
  // maison (web + dart/flutter/expo). Non bloquant : hors ligne, l'install
  // reussit quand meme et `novahiz docs ingest <id>` reste disponible.
  if (!dryRun) {
    const docsIndex = join(home, "mcp", "novahiz-docs", "index.mjs");
    const docsCore = ["react", "nextjs", "typescript", "nodejs", "tailwindcss", "dart", "flutter", "expo"];
    if (existsSync(docsIndex)) {
      note(`Filling docs index (core: ${docsCore.join(", ")})`);
      const result = spawnSync(process.execPath, [docsIndex, "--ingest", docsCore.join(",")], {
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home },
        timeout: 240000
      });
      if (result.stdout) ui.raw(result.stdout);
      if (result.status !== 0) note("docs seed incomplete — run `novahiz docs ingest <id>` when online");
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
  ui.step("MCP servers");
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
        ui.suspend();
        const result = spawnHost("npm", ["install", "-g", server.pkg], {
          stdio: "inherit"
        });
        ui.resume();
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
        ui.suspend();
        const removal = spawnHost("npm", ["uninstall", "-g", pkg], { stdio: "inherit" });
        ui.resume();
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
  if (!dryRun && flags["flutter-skills"] && deferOpencode) {
    note("\nFlutter/Dart skill packs deferred to the post-npm phase.");
  } else if (!dryRun && flags["flutter-skills"]) {
    note("\nInstalling official Flutter/Dart skill packs...");
    for (const pack of skillPacks) {
      note(`  ${pack.repo}...`);
      ui.suspend();
      const result = spawnHost(
        "npx",
        ["-y", "skills", "add", pack.repo, "--skill", "*", "-g", "-a", "opencode", "-y"],
        { stdio: "inherit" }
      );
      ui.resume();
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
      ui.suspend();
      const result = spawnHost("npm", ["install", "-g", plugin], {
        stdio: "inherit"
      });
      ui.resume();
      if (result.status !== 0) {
        note(`  WARNING: Failed to install ${plugin} (non-blocking)`);
      } else {
        note(`  ${plugin} installed`);
      }
    }
  }

  // Generate opencode.jsonc
  ui.step("opencode config");
  if (!configured.includes("opencode")) {
    note("Skipping opencode.jsonc (opencode not selected).");
  }
  if (!dryRun && deferOpencode && configured.includes("opencode")) {
    note("\nopencode.jsonc generation deferred to the post-npm phase.");
  }
  if (!dryRun && !deferOpencode && configured.includes("opencode")) {
    const configPath = join(configDir, "opencode.jsonc");
    if (!existsSync(configPath)) {
      note(`\nCreating ${configPath}`);
      const agentsSkillsDir = join(homedir(), ".agents", "skills");
      const agentsSkillsDirLegacy = join(homedir(), ".config", ".agents", "skills");

      const openCodeConfig = {
        "$schema": "https://opencode.ai/config.json",
        // T3: sans ce champ, adapters/opencode/instructions.md n'est lu par
        // rien (ni config, ni agent, ni plugin) — la regle Obsidian/second-memory
        // ne parvenait jamais au modele. Chemin absolu depuis NOVAHIZ_HOME.
        "instructions": [join(home, "adapters", "opencode", "instructions.md")],
        // LSP : forme `true` = « activer les serveurs built-in » (doc V2) —
        // auto-detection a la disponibilite des commandes quand le runtime
        // arrivera (audit 2026-10-08 : v2.0.24 n'a pas encore de runtime LSP ;
        // la cle est validee et preservee, sans effet encore). On refuse une
        // liste explicite ici : sur une machine utilisateur les binaires
        // (typescript-language-server, etc.) peuvent manquer — des entrees
        // mortes = exactement le probleme qu'on veut jamais livrer.
        "lsp": true,
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
          },
          // Trio runtime (audit 2026-10-08) : novahiz_classify (27 outils dont
          // la classification du pipeline), novahiz_gate (la porte que le skill
          // novahiz-gate appelle) et scan (argus). Le transform du plugin les
          // inscrit aussi, mais un transform arrive apres la resolution MCP ne
          // lie jamais les serveurs — en config statique la connexion est
          // garantie des l'installation. Le plugin voit editor.get(id) deja
          // present et les saute : aucun doublon. timeout 120s = cold start
          // argus (audit 2026-09-25 P2).
          "novahiz-core": {
            "type": "local",
            "command": ["node", join(home, "mcp", "novahiz-tools", "index.mjs")],
            "timeout": 120000,
            "enabled": true
          },
          "novahiz-gate": {
            "type": "local",
            "command": ["node", join(home, "mcp", "novahiz-gate", "index.mjs")],
            "timeout": 120000,
            "enabled": true
          },
          "novahiz-scan": {
            "type": "local",
            "command": ["node", join(home, "mcp", "argus", "src", "cli.mjs")],
            "timeout": 120000,
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

  // T7: le vault officiel second-memory est cree a l'installation, avec ses
  // plugins Obsidian. Non bloquant : hors ligne, tout le reste de
  // l'installation reste valide et `novahiz second-memory init` refera le
  // vault plus tard. --no-vault pour sauter cette etape.
  ui.step("Obsidian vault (second-memory)");
  if (dryRun) {
    note("Would create/verify the second-memory vault (novahiz second-memory init).");
  } else if (flags["no-vault"] || flags["skip-vault"]) {
    note("Skipped (--no-vault).");
    ui.finishStep("skip");
  } else {
    const vaultCli = join(home, "src", "cli.ts");
    if (existsSync(vaultCli)) {
      note("Creating the second-memory vault (structure + Obsidian plugins, ~10 downloads)...");
      const vault = spawnSync(process.execPath, [vaultCli, "second-memory", "init"], {
        encoding: "utf8",
        timeout: 180000,
        env: { ...process.env, NOVAHIZ_HOME: home }
      });
      if (vault.stdout) ui.raw(vault.stdout);
      if (vault.status !== 0) {
        if (vault.stderr) ui.raw(vault.stderr);
        note("WARNING: vault creation failed (non-blocking) — retry later with `novahiz second-memory init`.");
        ui.finishStep("warn");
      }
    } else {
      note("CLI not present yet, vault step skipped.");
      ui.finishStep("skip");
    }
  }

  ui.step("Finalize");
  if (!dryRun) {
    // Auto-update dependencies (scoped to novahiz home, NEVER the global prefix).
    //
    // npm exports its config to lifecycle scripts (npm_config_*, envExport
    // default true), so running under `npm install -g` leaks
    // npm_config_global=true into this process. Without the explicit override
    // below, `npm update` here silently becomes a SECOND reify of the global
    // prefix while npm's own transaction is still open: its retire of
    // node_modules\novahiz gets EBUSY (this process's cwd IS the package dir),
    // the nested npm crashes, and arborist's rollback does
    // rm(new) + rename(.novahiz-OLD -> novahiz) — the previous install comes
    // back byte-for-byte with its original mtimes while the outer npm reports
    // exit 0 / "changed 1 package". That is the "in-place install does not
    // replace" bug. Forcing npm_config_global=false keeps this refresh in
    // home (home/package.json), which shares no directory with the outer
    // transaction. --ignore-scripts so nothing in home can re-enter the
    // installer (home/package.json carries the postinstall script too).
    note("Checking for dependency updates...");
    const pkgPath = join(home, "package.json");
    if (existsSync(pkgPath)) {
      const homeEnv = { ...process.env, NOVAHIZ_HOME: home, npm_config_global: "false" };
      const npmCheck = spawnHost("npm", ["outdated", "--json"], {
        cwd: home,
        env: homeEnv
      });
      if (npmCheck.stdout && npmCheck.stdout.trim().length > 2) {
        note("Updates available, installing...");
        const npmUpdate = spawnHost("npm", ["update", "--ignore-scripts"], {
          cwd: home,
          env: homeEnv
        });
        if (npmUpdate.stdout) ui.raw(npmUpdate.stdout);
        if (npmUpdate.status !== 0 && npmUpdate.stderr) process.stderr.write(npmUpdate.stderr);
        note("Dependencies updated.");
      } else {
        note("Dependencies up to date.");
      }
    }
    const summary = [`Novahiz installed in ${home}.`];
    if (deferLogPath) summary.push(`opencode config phase: deferred - see ${deferLogPath} (runs once npm exits).`);
    if (configured.length > 0) summary.push("Restart opencode to activate the plugin and MCP server.");
    summary.push("Gate can be disabled with the NOVAHIZ_GATE=off environment variable.");
    summary.push("Update anytime: `novahiz upgrade` (npm) or `/novahiz-upgrade` inside OpenCode.");
    ui.finish(summary);
  } else {
    ui.finish([
      "Dry-run complete, no changes written.",
      "Next step: run `novahiz-install` (or `novahiz setup`) once to install everything — core skills, plugin, agent, provider skill packs (impeccable, flutter, dart, expo), and MCP servers. Then restart opencode."
    ]);
  }
}

// Entree de la phase differee (NOVAHIZ_DEFERRED=1) : on attend la mort du
// postinstall puis de npm avant le moindre passage complet — pendant ce
// temps, npm finalise sa transaction reify sans risque d'etre tue par un
// redemarrage opencode.
if (process.env.NOVAHIZ_DEFERRED === "1") {
  await waitForDeferredPhase();
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
