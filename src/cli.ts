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

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.NOVAHIZ_HOME || join(process.env.HOME || process.env.USERPROFILE || "", ".config", "novahiz");

function runSync(): void {
  const cli = join(HOME, "src", "cli.ts");
  if (existsSync(cli)) {
    spawnSync(process.execPath, [cli, "sync"], {
      encoding: "utf8",
      stdio: "inherit",
      env: { ...process.env, NOVAHIZ_HOME: HOME }
    });
  }
}

function usage(): void {
  print({
    name: "skillenforce",
    commands: [
      "init                    Set up Skillenforce (config, skills, catalog)",
      "doctor                  Check that everything works",
      "status                  Show current classification and gate state",
      "task new <title>        Start a new tracked task",
      "task status             Show task progress",
      "task done <id>          Mark a todo as complete",
      "report                  Session report",
      "clean                   Remove old logs and sessions",
      "upgrade                 Pull latest and rebuild catalog",
      "version                 Show version",
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
    process.stdout.write(`skillenforce ${pkg.version}\n`);
  } catch {
    process.stdout.write("skillenforce (unknown version)\n");
  }
}

function runInit(): void {
  const installScript = join(HOME, "install", "install.mjs");
  if (existsSync(installScript)) {
    process.stdout.write("Installing Skillenforce...\n");
    const result = spawnSync(process.execPath, [installScript, "--yes"], {
      encoding: "utf8",
      stdio: "inherit",
      env: { ...process.env, NOVAHIZ_HOME: HOME }
    });
    if (result.status !== 0) {
      process.stderr.write("Installation failed. Run `skillenforce doctor` for details.\n");
      process.exitCode = 1;
      return;
    }
  }
  process.stdout.write("\nBuilding skill catalog...\n");
  runSync();
  process.stdout.write("\nDone! Restart opencode to activate Skillenforce.\n");
}

function runUpgrade(): void {
  if (!existsSync(join(HOME, ".git"))) {
    process.stderr.write("Not a git repository. Install from source first.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Pulling latest changes...\n");
  spawnSync("git", ["pull"], { cwd: HOME, stdio: "inherit" });
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
  if (command === undefined) {
    usage();
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
    default:
      process.stderr.write(`skillenforce: unknown command "${command}"\n\n`);
      usage();
      process.exitCode = 1;
      return;
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`skillenforce: ${message}\n`);
  process.exitCode = 1;
}
