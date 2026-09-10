import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { novahizHome, parseArgs } from "./lib.mjs";

function cliCommand(home, harness, event) {
  const cli = join(home, "src", "cli.ts").replace(/\\/g, "/");
  return `node "${cli}" hook --harness ${harness} --event ${event}`;
}

function claudeHooks(home) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|Bash|PowerShell",
          hooks: [
            {
              type: "command",
              command: cliCommand(home, "claude", "PreToolUse"),
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
  const command = cliCommand(home, "codex", "PostToolUse");
  const stop = cliCommand(home, "codex", "Stop");
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write|apply_patch",
          hooks: [{ type: "command", command, commandWindows: command, timeout: 10, statusMessage: "Novahiz gate" }]
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function mergeHooks(existing, generated) {
  const merged = { ...existing };
  merged.hooks = { ...(existing.hooks ?? {}) };
  for (const [event, groups] of Object.entries(generated.hooks)) {
    const current = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const generatedCommands = new Set(
      groups.flatMap((group) => (group.hooks ?? []).map((handler) => handler.command))
    );
    const kept = current.filter(
      (group) => !(group.hooks ?? []).some((handler) => generatedCommands.has(handler.command))
    );
    merged.hooks[event] = [...kept, ...groups];
  }
  return merged;
}

function writeMerged(path, generated) {
  let existing = {};
  if (existsSync(path)) {
    try {
      existing = readJson(path);
    } catch (error) {
      process.stderr.write(`Refus: ${path} n'est pas un JSON valide (${error.message}). Rien ecrit.\n`);
      return false;
    }
    cpSync(path, `${path}.novahiz-bak`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(mergeHooks(existing, generated), null, 2)}\n`, "utf8");
  return true;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const home = novahizHome(flags);
  const harnesses = (typeof flags.harness === "string" ? flags.harness : "claude,codex")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const targets = [];
  if (harnesses.includes("claude")) {
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    targets.push({ name: "claude", path: join(dir, "settings.json"), generated: claudeHooks(home) });
  }
  if (harnesses.includes("codex")) {
    const dir = process.env.CODEX_HOME || join(homedir(), ".codex");
    targets.push({ name: "codex", path: join(dir, "hooks.json"), generated: codexHooks(home) });
  }

  if (targets.length === 0) {
    process.stderr.write("Aucun harness reconnu pour les hooks (claude, codex).\n");
    process.exitCode = 1;
    return;
  }

  for (const target of targets) {
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}hooks ${target.name} -> ${target.path}\n`);
    if (dryRun) continue;
    const dir = dirname(target.path);
    if (!existsSync(dir)) {
      process.stdout.write(`  dossier absent, ignore: ${dir}\n`);
      continue;
    }
    if (writeMerged(target.path, target.generated)) process.stdout.write("  ecrit\n");
  }

  if (dryRun) process.stdout.write("\nDry-run termine, rien ecrit.\n");
}

main();
