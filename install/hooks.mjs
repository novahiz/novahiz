import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadManifest,
  mergeBackups,
  mergeCreated,
  novahizHome,
  parseArgs,
  saveManifest
} from "./lib.mjs";

function hookCommand(home, harness, event) {
  const cli = join(home, "src", "cli.ts").replace(/\\/g, "/");
  const root = home.replace(/\\/g, "/");
  return `node "${cli}" --home "${root}" hook --harness ${harness} --event ${event}`;
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [command], { encoding: "utf8", shell: false }).status === 0;
}

function mcpEntryPoint(home) {
  return join(home, "mcp", "novahiz-tools", "index.mjs");
}

function claudeHooks(home) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell",
          hooks: [
            {
              type: "command",
              command: hookCommand(home, "claude", "PreToolUse"),
              timeout: 10,
              statusMessage: "Novahiz gate"
            }
          ]
        }
      ]
    }
  };
}

function codexHooks(home) {
  const pre = hookCommand(home, "codex", "PreToolUse");
  const stop = hookCommand(home, "codex", "Stop");
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash|apply_patch|Edit|Write",
          hooks: [{ type: "command", command: pre, commandWindows: pre, timeout: 10, statusMessage: "Novahiz gate" }]
        }
      ],
      Stop: [
        {
          hooks: [{ type: "command", command: stop, commandWindows: stop, timeout: 30, statusMessage: "Novahiz report" }]
        }
      ]
    }
  };
}

export function isNovahizHandler(handler) {
  const command = typeof handler?.command === "string" ? handler.command : "";
  return command.includes("hook --harness") && (command.includes("novahiz") || command.includes("cli.ts"));
}

export function mergeHooks(existing, generated) {
  const merged = { ...existing, hooks: { ...(existing.hooks ?? {}) } };
  for (const [event, groups] of Object.entries(generated.hooks)) {
    const current = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const kept = current.filter((group) => !(group.hooks ?? []).some(isNovahizHandler));
    merged.hooks[event] = [...kept, ...groups];
  }
  return merged;
}

function writeMerged(path, generated, tracked) {
  let existing = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      process.stderr.write(`Refus: ${path} n'est pas un JSON valide (${error.message}). Rien ecrit.\n`);
      return false;
    }
    const backup = `${path}.novahiz-bak`;
    if (!existsSync(backup)) cpSync(path, backup);
    tracked.backups.push({ path, backup });
  } else {
    tracked.created.push(path);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(mergeHooks(existing, generated), null, 2)}\n`, "utf8");
  return true;
}

function registerMcp(name, args, label) {
  if (!commandExists(name)) {
    process.stdout.write(`  ${label}: CLI '${name}' introuvable, enregistrement MCP ignore\n`);
    return;
  }
  const result = spawnSync(name, args, { encoding: "utf8", shell: false });
  if (result.status === 0) process.stdout.write(`  ${label}: serveur MCP 'novahiz' enregistre\n`);
  else process.stdout.write(`  ${label}: MCP non enregistre (deja present ou erreur): ${(result.stderr || "").trim()}\n`);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const home = novahizHome(flags);
  const harnesses = (typeof flags.harness === "string" ? flags.harness : "claude,codex")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const mcp = mcpEntryPoint(home).replace(/\\/g, "/");

  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const codexDir = process.env.CODEX_HOME || join(homedir(), ".codex");

  const targets = [];
  if (harnesses.includes("claude") && existsSync(claudeDir)) {
    targets.push({ name: "claude", dir: claudeDir, path: join(claudeDir, "settings.json"), generated: claudeHooks(home) });
  }
  if (harnesses.includes("codex") && existsSync(codexDir)) {
    targets.push({ name: "codex", dir: codexDir, path: join(codexDir, "hooks.json"), generated: codexHooks(home) });
  }

  if (targets.length === 0) {
    process.stdout.write("Aucun harness detecte (ni ~/.claude ni ~/.codex). Rien a configurer.\n");
    return;
  }

  const tracked = { created: [], backups: [] };
  for (const target of targets) {
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}hooks ${target.name} -> ${target.path}\n`);
    if (dryRun) continue;
    if (writeMerged(target.path, target.generated, tracked)) {
      process.stdout.write("  hooks ecrits\n");
      if (target.name === "claude") registerMcp("claude", ["mcp", "add", "--scope", "user", "novahiz", "--", "node", mcp], "claude");
      if (target.name === "codex") registerMcp("codex", ["mcp", "add", "novahiz", "--", "node", mcp], "codex");
    }
  }

  if (dryRun) {
    process.stdout.write("\nDry-run termine, rien ecrit.\n");
    return;
  }

  const previous = loadManifest(home);
  saveManifest(home, {
    ...previous,
    created: mergeCreated(previous.created, tracked.created),
    backups: mergeBackups(previous.backups, tracked.backups)
  });
  process.stdout.write("Hooks non geres: Claude Code les charge directement; Codex les execute apres approbation via /hooks.\n");
}

if (import.meta.main) main();
