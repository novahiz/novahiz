import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  loadManifest,
  mergeBackups,
  mergeCreated,
  novahizHome,
  parseArgs,
  saveManifest
} from "./lib.mjs";

function cliCommand(home, harness, event) {
  const cli = join(home, "src", "cli.ts").replace(/\\/g, "/");
  const root = home.replace(/\\/g, "/");
  return `node "${cli}" --home "${root}" hook --harness ${harness} --event ${event}`;
}

function claudeHooks(home) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell",
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

function isNovahizHandler(handler) {
  const command = typeof handler?.command === "string" ? handler.command : "";
  return command.includes("hook --harness") && (command.includes("novahiz") || command.includes("cli.ts"));
}

function mergeHooks(existing, generated) {
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
      existing = JSON.parse(readFileSync(path, "utf8"));
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

  const tracked = { created: [], backups: [] };
  for (const target of targets) {
    process.stdout.write(`${dryRun ? "[dry-run] " : ""}hooks ${target.name} -> ${target.path}\n`);
    if (dryRun) continue;
    if (!existsSync(dirname(target.path))) {
      process.stdout.write(`  dossier absent, ignore: ${dirname(target.path)}\n`);
      continue;
    }
    if (writeMerged(target.path, target.generated, tracked)) process.stdout.write("  ecrit\n");
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
}

main();
