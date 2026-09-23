import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse, print } from "./commands/context.ts";
import { expandHome } from "./spec.ts";

import { commandCheck, commandSync, commandClassify, commandSkills, commandCategories, commandRules, commandSessionLoad, commandSessionState, commandCatalog, commandRoadmap, commandStep, commandProviders, commandDeps, commandDispatch } from "./commands/inspect.ts";
import { commandGate } from "./commands/gate.ts";
import { commandReport } from "./commands/report.ts";
import { commandTask } from "./commands/task.ts";
import { commandClean } from "./commands/clean.ts";
import { commandDoctor } from "./commands/doctor.ts";
import { commandTokens } from "./commands/tokens.ts";
import { graftCommand } from "./commands/graft.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// M6: HOME was a module-level const, so `--home` (which sets the env var in
// main()) was silently ignored by the current execution. Read it lazily.
function homeDir(): string {
  return (
    process.env.NOVAHIZ_HOME ||
    join(process.env.HOME || process.env.USERPROFILE || "", ".config", "novahiz")
  );
}

function runSync(): void {
  const home = homeDir();
  const cli = join(home, "src", "cli.ts");
  if (existsSync(cli)) {
    spawnSync(process.execPath, [cli, "sync"], {
      encoding: "utf8",
      stdio: "inherit",
      env: { ...process.env, NOVAHIZ_HOME: home }
    });
  }
}

function usage(): void {
  print({
    name: "novahiz",
    commands: [
      "init                    Set up Novahiz (config, skills, catalog)",
      "doctor                  Check that everything works",
      "status                  Show current classification and gate state",
      "task new <title>        Start a new tracked task",
      "task status             Show task progress",
      "task done <id>          Mark a todo as complete",
      "report                  Session report",
      "clean                   Remove old logs and sessions",
      "graft                   Version-control the ledger (graft init/log/diff/status/restore)",
      "upgrade                 Pull latest and rebuild catalog",
      "version                 Show version",
      "",
      "",
      "Options:",
      "  --home <path>         Override Novahiz home directory",
      "  --version, -v         Show version",
      "  --help, -h            Show this help",
      "",
      "Advanced (for power users and adapters):",
      "  classify <text>       Classify a prompt",
      "  gate --tool <t> --file <f>  Check if an edit is allowed",
      "  skills [--category c] List loaded skills",
      "  catalog <query>       Search the skill catalog",
      "  roadmap --category c  Show execution roadmap",
      "  dispatch [--task id]  Generate work packets",
      "  tokens                Token diagnostics",
    ]
  });
}

function printVersion(): void {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    process.stdout.write(`Novahiz ${pkg.version}\n`);
  } catch {
    process.stdout.write("Novahiz (unknown version)\n");
  }
}

function runInit(): void {
  const home = homeDir();
  const installScript = join(home, "install", "install.mjs");
  if (existsSync(installScript)) {
    process.stdout.write("Installing Novahiz...\n");
    const result = spawnSync(process.execPath, [installScript, "--yes"], {
      encoding: "utf8",
      stdio: "inherit",
      env: { ...process.env, NOVAHIZ_HOME: home }
    });
    if (result.status !== 0) {
      process.stderr.write("Installation failed. Run `novahiz doctor` for details.\n");
      process.exitCode = 1;
      return;
    }
  }
  process.stdout.write("\nBuilding skill catalog...\n");
  runSync();
  process.stdout.write("\nDone! Restart opencode to activate Novahiz.\n");
}

function runUpgrade(): void {
  const home = homeDir();
  if (!existsSync(join(home, ".git"))) {
    process.stderr.write("Not a git repository. Install from source first.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Pulling latest changes...\n");
  spawnSync("git", ["pull"], { cwd: home, stdio: "inherit" });
  process.stdout.write("\nRebuilding skill catalog...\n");
  runSync();
  process.stdout.write("\nUpgraded! Restart opencode to apply changes.\n");
}

function main(argv: string[]): void {
  const parsed = parse(argv);
  if (typeof parsed.flags.home === "string" && parsed.flags.home.length > 0) {
    process.env.NOVAHIZ_HOME = resolve(expandHome(parsed.flags.home));
  }
  const command = parsed.positionals[0];
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  if (parsed.flags.version || parsed.flags.v) {
    printVersion();
    return;
  }
  switch (command) {
    case "init":
    case "setup":
      return runInit();
    case "doctor":
      return commandDoctor(parsed);
    case "status":
    case "check":
      return commandCheck();
    case "report":
      return commandReport(parsed);
    case "clean":
      return commandClean(parsed);
    case "upgrade":
    case "update":
      return runUpgrade();
    case "version":
    case "-v":
    case "--version":
      return printVersion();
    case "task":
      return commandTask(parsed);
    case "sync":
      return commandSync();
    case "classify":
      return commandClassify(parsed);
    case "gate":
      return commandGate(parsed);
    case "skills":
      return commandSkills(parsed);
    case "categories":
      return commandCategories();
    case "rules":
      return commandRules();
    case "session-load":
      return commandSessionLoad(parsed);
    case "session-state":
      return commandSessionState(parsed);
    case "catalog":
      return commandCatalog(parsed);
    case "roadmap":
      return commandRoadmap(parsed);
    case "step":
      return commandStep(parsed);
    case "providers":
      return commandProviders(parsed);
    case "deps":
      return commandDeps(parsed);
    case "dispatch":
      return commandDispatch(parsed);
    case "tokens":
      return commandTokens(parsed);
    case "graft":
      return graftCommand(parsed.positionals.slice(1));
    default:
      process.stderr.write(`novahiz: unknown command "${command}"\n\n`);
      usage();
      process.exitCode = 1;
      return;
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`novahiz: ${message}\n`);
  process.exitCode = 1;
}
