#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nodeVersionOk, opencodeConfigDir, NovahizHome } from "./lib.mjs";

const REPO_URL = "https://github.com/novahiz/novahiz.git";
// Was hardcoded to ~/.config/novahiz, ignoring NOVAHIZ_HOME/NOVAHIZ_HOME.
// NovahizHome() already implements the env-first fallback chain.
const NOVAHIZ_HOME = NovahizHome();

function log(msg) {
  process.stdout.write(`[Novahiz] ${msg}\n`);
}

function error(msg) {
  process.stderr.write(`[Novahiz] ERROR: ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...opts,
  });
  return result.status === 0;
}

function runCapture(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
  return { ok: result.status === 0, stdout: result.stdout?.trim() ?? "", stderr: result.stderr?.trim() ?? "" };
}

function which(cmd) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [cmd + ext], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0) return true;
  // Try without extension on Windows
  if (process.platform === "win32") {
    const result2 = spawnSync("where", [cmd], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return result2.status === 0;
  }
  return false;
}

function detectShell() {
  if (process.platform === "win32") return "pwsh";
  return "bash";
}

function generateOpenCodeJson(configDir, NovahizHome) {
  const skillsDir = join(configDir, "skills");
  const agentsSkillsDir = join(homedir(), ".config", ".agents", "skills");

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      context7: {
        type: "local",
        command: ["context7-mcp", "--transport", "stdio"],
        enabled: true,
      },
      narsil: {
        type: "local",
        command: ["narsil-mcp", "--repos", ".", "--git", "--persist"],
        timeout: 120000,
        enabled: true,
      },
      cron: {
        type: "local",
        command: ["mcp-cron", "--transport", "stdio"],
        enabled: true,
      },
      playwright: {
        type: "local",
        command: ["npx", "@playwright/mcp@latest", "--browser=msedge"],
        enabled: true,
      },
    },
    skills: {
      paths: [skillsDir],
    },
    plugin: [
      "@mohak34/opencode-notifier@0.3.0",
      "@tarquinen/opencode-dcp@3.2.0",
      join(NovahizHome, "adapters", "opencode", "novahiz.ts"),
    ],
    compaction: {
      auto: true,
      prune: true,
      reserved: 10000,
    },
    shell: detectShell(),
  };

  // Add .agents/skills if it exists
  if (existsSync(agentsSkillsDir)) {
    config.skills.paths.push(agentsSkillsDir);
  }

  return config;
}

async function main() {
  log("Bootstrap Novahiz - Installation from scratch");
  log("");

  // 1. Check Node version
  if (!nodeVersionOk()) {
    error(`Node ${process.versions.node} is too old. Node 22.18 or later is required.`);
    error("Install Node: https://nodejs.org/");
    process.exit(1);
  }
  log(`Node ${process.versions.node} OK`);

  // 2. Check git
  if (!which("git")) {
    // Try direct spawn on Windows
    const testGit = spawnSync("git", ["--version"], { encoding: "utf8", stdio: "pipe" });
    if (testGit.status !== 0) {
      error("git is required but not found. Install git first.");
      process.exit(1);
    }
  }
  log("git OK");

  // 3. Install opencode globally if not present
  if (!which("opencode")) {
    log("Installing opencode globally...");
    if (!run("npm", ["install", "-g", "opencode"])) {
      error("Failed to install opencode. Try: npm install -g opencode");
      process.exit(1);
    }
    log("opencode installed");
  } else {
    log("opencode already installed");
  }

  // 4. Clone or update repo
  if (existsSync(join(NOVAHIZ_HOME, ".git"))) {
    log("Repo already exists, pulling latest...");
    run("git", ["-C", NOVAHIZ_HOME, "pull", "--rebase"]);
  } else {
    log(`Cloning repo to ${NOVAHIZ_HOME}...`);
    mkdirSync(NOVAHIZ_HOME, { recursive: true });
    if (!run("git", ["clone", REPO_URL, NOVAHIZ_HOME])) {
      error("Failed to clone repo");
      process.exit(1);
    }
    log("Repo cloned");
  }

  // 5. Install MCP servers (global npm packages)
  log("");
  log("Installing MCP servers...");
  const mcpServers = [
    { pkg: "@upstash/context7-mcp", bin: "context7-mcp" },
    { pkg: "narsil-mcp", bin: "narsil-mcp" },
    { pkg: "mcp-cron", bin: "mcp-cron" },
    { pkg: "security-mcp", bin: "security-mcp" },
  ];

  for (const server of mcpServers) {
    if (!which(server.bin)) {
      log(`  Installing ${server.pkg}...`);
      if (!run("npm", ["install", "-g", server.pkg])) {
        log(`  WARNING: Failed to install ${server.pkg} (non-fatal, will use npx fallback)`);
      } else {
        log(`  ${server.pkg} installed`);
      }
    } else {
      log(`  ${server.pkg} already installed`);
    }
  }

  // 6. Install opencode plugins (global npm packages)
  log("");
  log("Installing opencode plugins...");
  const plugins = [
    "@mohak34/opencode-notifier@0.3.0",
    "@tarquinen/opencode-dcp@3.2.0",
  ];

  for (const plugin of plugins) {
    const pkgName = plugin.split("@")[0] === "" ? `@${plugin.split("@")[1]}` : plugin.split("@")[0];
    log(`  Installing ${plugin}...`);
    if (!run("npm", ["install", "-g", plugin])) {
      log(`  WARNING: Failed to install ${plugin} (non-fatal)`);
    } else {
      log(`  ${plugin} installed`);
    }
  }

  // 7. Run the main installer
  log("");
  log("Running main installer...");
  const installScript = join(NOVAHIZ_HOME, "install", "install.mjs");
  if (existsSync(installScript)) {
    if (!run(process.execPath, [installScript, "--yes"])) {
      error("Main installer had issues (non-fatal, check output above)");
    }
  } else {
    error(`Installer not found at ${installScript}`);
  }

  // 8. Create opencode.jsonc
  log("");
  log("Generating opencode.jsonc...");
  const configDir = opencodeConfigDir();
  const configPath = join(configDir, "opencode.jsonc");

  if (!existsSync(configPath)) {
    const config = generateOpenCodeJson(configDir, NOVAHIZ_HOME);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    log(`Created ${configPath}`);
  } else {
    log(`opencode.jsonc already exists at ${configPath}`);
    log("  Skipping (will not overwrite existing config)");
  }

  // 9. Copy plugin to opencode plugins dir
  const pluginSource = join(NOVAHIZ_HOME, "adapters", "opencode", "novahiz.ts");
  const pluginTarget = join(configDir, "plugins", "novahiz.ts");
  if (existsSync(pluginSource)) {
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    const { cpSync } = await import("node:fs");
    cpSync(pluginSource, pluginTarget, { recursive: true });
    log(`Plugin copied to ${pluginTarget}`);
  }

  // 10. Done
  log("");
  log("=========================================");
  log("  Novahiz installed successfully!");
  log("=========================================");
  log("");
  log("Next steps:");
  log("  1. Restart opencode to activate everything");
  log("  2. Gate is ON by default (disable with NOVAHIZ_GATE=off)");
  log("");
  log("Enjoy your deterministic agentic layer!");
}

main().catch((err) => {
  error(String(err));
  process.exit(1);
});
