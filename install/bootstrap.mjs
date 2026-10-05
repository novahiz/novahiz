#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nodeVersionOk, opencodeConfigDir, NovahizHome, playwrightBrowserFlag, unsafeHostToken } from "./lib.mjs";

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

// npm/npx are .cmd shims on Windows: spawning them without a shell throws
// ENOENT (post-CVE-2024-* Node refuses to run .cmd via CreateProcess). The
// line handed to cmd.exe only contains tokens accepted by unsafeHostToken
// (lib.mjs — the install-side mirror of src/exec.ts SAFE_TOKEN, widened by
// "*" for the literal flutter-skills glob); a refused token fails the run
// loudly instead of being reinterpreted by cmd.exe. Same explicit cmd.exe
// spelling as src/exec.ts resolveSpawn — argv form, no deprecated shell flag
// (DEP0190).
const HOST_CMDS = new Set(["npm", "npx"]);
function hostInvocation(cmd, args) {
  if (process.platform === "win32" && HOST_CMDS.has(cmd)) {
    const bad = unsafeHostToken([cmd, ...args]);
    if (bad !== null) return { refused: bad };
    const shell = process.env.ComSpec ?? "cmd.exe";
    return { command: shell, spawnArgs: ["/d", "/s", "/c", [cmd, ...args].join(" ")], opts: {} };
  }
  return { command: cmd, spawnArgs: args, opts: {} };
}

function refusedResult(token) {
  return { ok: false, status: 1, stdout: "", stderr: `refused unsafe token: ${token}\n` };
}

function run(cmd, args, opts = {}) {
  const inv = hostInvocation(cmd, args);
  if (inv.refused !== undefined) {
    error(`refused unsafe token in spawn: ${inv.refused}`);
    return false;
  }
  const result = spawnSync(inv.command, inv.spawnArgs, {
    encoding: "utf8",
    stdio: "inherit",
    ...inv.opts,
    ...opts,
  });
  return result.status === 0;
}

function runCapture(cmd, args, opts = {}) {
  const inv = hostInvocation(cmd, args);
  if (inv.refused !== undefined) return refusedResult(inv.refused);
  const result = spawnSync(inv.command, inv.spawnArgs, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...inv.opts,
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
  // PowerShell 7 (pwsh) is not bundled with Windows; Windows PowerShell 5.1
  // (powershell.exe) always is. Probe so the generated opencode config never
  // names a shell the machine does not have.
  if (process.platform === "win32") return which("pwsh") ? "pwsh" : "powershell";
  return "bash";
}

function generateOpenCodeJson(configDir, NovahizHome) {
  const skillsDir = join(configDir, "skills");
  const agentsSkillsDir = join(homedir(), ".agents", "skills");
  const agentsSkillsDirLegacy = join(homedir(), ".config", ".agents", "skills");

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      "novahiz-docs": {
        type: "local",
        command: ["node", join(NovahizHome, "mcp", "novahiz-docs", "index.mjs")],
        enabled: true,
      },
      "novahiz-search": {
        type: "local",
        command: ["node", join(NovahizHome, "mcp", "lodestone", "index.mjs")],
        timeout: 120000,
        enabled: true,
      },
      // `novahiz-scheduler` is the local scheduler (mcp/clepsydre, zero npm
      // dependency): no package, no shim, config points straight at index.mjs.
      "novahiz-scheduler": {
        type: "local",
        command: ["node", join(NovahizHome, "mcp", "clepsydre", "index.mjs")],
        timeout: 120000,
        enabled: true,
      },
      playwright: {
        type: "local",
        // See playwrightBrowserFlag() in lib.mjs for the platform rule.
        command: ["npx", "-y", "@playwright/mcp@0.0.82", playwrightBrowserFlag()],
        enabled: true,
      },
      dart: {
        type: "local",
        command: ["dart", "mcp-server"],
        enabled: true,
      },
    },
    skills: {
      paths: [skillsDir],
    },
    // 2026-09-26: notifier/dcp uninstalled on purpose — never re-add them.
    plugin: [
      join(NovahizHome, "adapters", "opencode", "novahiz-plugin.ts"),
    ],
    compaction: {
      auto: true,
      prune: true,
      reserved: 10000,
    },
    shell: detectShell(),
  };

  // Official skills land in ~/.agents/skills (skills CLI) — load them too.
  for (const dir of [agentsSkillsDir, agentsSkillsDirLegacy]) {
    if (existsSync(dir) && !config.skills.paths.includes(dir)) {
      config.skills.paths.push(dir);
    }
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
    if (!run("npm", ["install", "-g", "opencode-ai"])) {
      // Non-blocking: the repo clone and main installer still land; opencode
      // can be installed afterwards.
      log("WARNING: Failed to install opencode (non-blocking). Run: npm install -g opencode-ai");
    } else {
      log("opencode installed");
    }
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
  log("MCP servers: none to install — removed servers stay removed.");
  // 2026-10-05: intentionally empty — security-mcp was removed on purpose and
  // the mcp-cron shim before it; never re-add them (user decision: jamais
  // réinstallés). The purge below enforces the removal on every bootstrap.
  const mcpServers = [];
  // `novahiz-docs` is a local file run through `node` (no package, no shim:
  // the config points straight at <home>/mcp/novahiz-docs/index.mjs).
  // `clepsydre` is a local file run through `node` (house scheduler, zero npm
  // dependency): the config points straight at <home>/mcp/clepsydre/index.mjs,
  // enabled by default — no install step, no clone, no venv.

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

  // Removed on purpose: purge any trace of the removed servers on every
  // bootstrap so a stray reinstall cannot survive (security-mcp, mcp-cron).
  for (const pkg of ["security-mcp", "mcp-cron"]) {
    if (which(pkg)) {
      log(`  ${pkg} found but removed on purpose — uninstalling (never reinstall)...`);
      run("npm", ["uninstall", "-g", pkg]);
    }
  }

  // 6. Install opencode plugins (global npm packages)
  // 2026-09-26: intentionally empty — @mohak34/opencode-notifier and
  // @tarquinen/opencode-dcp stay uninstalled (user decision).
  const plugins = [];

  if (plugins.length > 0) {
    log("");
    log("Installing opencode plugins...");
    for (const plugin of plugins) {
      log(`  Installing ${plugin}...`);
      if (!run("npm", ["install", "-g", plugin])) {
        log(`  WARNING: Failed to install ${plugin} (non-fatal)`);
      } else {
        log(`  ${plugin} installed`);
      }
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
  const pluginSource = join(NOVAHIZ_HOME, "adapters", "opencode", "novahiz-plugin.ts");
  const pluginTarget = join(configDir, "plugins", "novahiz-plugin.ts");
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
