import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
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
  writeJson
} from "./lib.mjs";
import { createPrompt } from "./prompt.mjs";
import { DEFAULT_TOKENS } from "../adapters/opencode/tokens.ts";

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
    },
    tokens: {
      ...DEFAULT_TOKENS,
      trimTools: [...DEFAULT_TOKENS.trimTools],
      readTools: [...DEFAULT_TOKENS.readTools]
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
  let harnessesChoice = "";

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
    const detected = [];
    if (existsSync(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"))) detected.push("claude");
    if (existsSync(process.env.CODEX_HOME || join(homedir(), ".codex"))) detected.push("codex");
    if (detected.length > 0) {
      const answer = await prompt.confirm(`Configure ${detected.join(" and ")} (hooks + Novahiz MCP)?`, true);
      harnessesChoice = answer ? detected.join(",") : "";
    }
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

  const tokensSource = join(home, "adapters", "opencode", "tokens.ts");
  const tokensTarget = join(pluginsDir, "tokens.ts");
  if (existsSync(tokensSource)) {
    note(`Installation du module tokens dans ${tokensTarget}`);
    if (!dryRun) {
      const result = copyFileWithBackup(tokensSource, tokensTarget, true);
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

  if (!dryRun) {
    const harnessList = typeof flags.harness === "string" ? flags.harness : harnessesChoice;
    if (harnessList) {
      note(`Configuration des harness (${harnessList})`);
      const result = spawnSync(process.execPath, [join(home, "install", "hooks.mjs"), "--harness", harnessList, "--home", home], {
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

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
