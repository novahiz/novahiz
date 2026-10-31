import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse, print, flagOn, asString, splitList, type Parsed } from "./commands/context.ts";
import { expandHome, NovahizHome } from "./spec.ts";

import { commandCheck, commandSync, commandClassify, commandSkills, commandCategories, commandRules, commandSessionLoad, commandSessionState, commandCatalog, commandRoadmap, commandStep, commandProviders, commandDeps, commandDispatch, commandResume, commandVerify, commandSkillpack, commandDev, commandSecrets } from "./commands/inspect.ts";
import { commandRender } from "./commands/render.ts";
import { commandGate, commandGateToggle } from "./commands/gate.ts";
import { commandReport } from "./commands/report.ts";
import { commandTask } from "./commands/task.ts";
import { commandClean } from "./commands/clean.ts";
import { commandDoctor } from "./commands/doctor.ts";
import { commandTokens } from "./commands/tokens.ts";
import { snapCommand } from "./commands/snap.ts";
import { graphCommand } from "./commands/graph.ts";
import { memoryCommand } from "./commands/memory.ts";
import { secondMemoryCommand } from "./commands/second-memory.ts";
import { commandInit } from "./commands/init.ts";
import { commandAutodocs } from "./commands/autodocs.ts";
import { commandUpgrade } from "./commands/upgrade.ts";
import { commandStitch } from "./commands/stitch.ts";
import { commandDocs } from "./commands/docs.ts";
import { commandBackup, commandEvolution, commandManifest } from "./commands/backup.ts";
import { commandImprove } from "./commands/improve.ts";
import { commandRepair } from "./commands/repair.ts";
import { scopedCommit } from "./gitguard.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// M6: HOME was a module-level const, so `--home` (which sets the env var in
// main()) was silently ignored by the current execution. Read it lazily.
// M7/H16: the old fallback read `process.env.HOME || process.env.USERPROFILE`
// and joined it blind. Both are absent for a service, a daemon child or a
// container, and `join("", ".config", "novahiz")` yields a path relative to the
// cwd - a silent ghost home. `NovahizHome()` resolves the same default through
// homedir() and survives NOVAHIZ_HOME=~/x, so the two callers cannot drift.
function homeDir(): string {
  return NovahizHome();
}

function runSync(): void {
  const home = homeDir();
  const cliJs = join(home, "dist", "cli.js");
  const cliTs = join(home, "src", "cli.ts");
  if (existsSync(cliJs)) {
    // dist/cli.js est du JS compilé : Node le lit nativement, sur tous les
    // builds (y compris ceux sans support TypeScript compilé).
    spawnSync(process.execPath, [cliJs, "sync"], {
      encoding: "utf8",
      stdio: "inherit",
      env: { ...process.env, NOVAHIZ_HOME: home }
    });
  } else if (existsSync(cliTs)) {
    // Fallback pour un home qui ne contient que les sources (pas de build).
    // --experimental-strip-types ne fonctionne que sur les builds Node avec
    // support TypeScript compilé ; sinon l'utilisateur verra une erreur claire.
    spawnSync(process.execPath, ["--experimental-strip-types", cliTs, "sync"], {
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
      "init                    Initialize Novahiz in the current project",
      "setup                   Install Novahiz (config, skills, catalog)",
      "sync                    Rescan skills and rebuild build/installed-skills.json + build/catalog.json",
      "autodocs [--flush]      Sync docs and memory after major project changes",
      "doctor [--deep]        Check that everything works (--deep also probes each MCP server live)",
      "status                  Show current classification and gate state",
      "task new <title>        Start a new tracked task",
      "task status             Show task progress",
      "task done <id>          Mark a todo as complete",
      "resume --session <id>   Reload the real state after a restart: skills, classification, task, claims, evidence",
      "verify <name>           Run a command declared in .novahiz/verify.json and record the evidence",
      "skillpack --category <id>  Compact map of a category's skills (purpose + rules), before loading them",
      "dev doctor              Diagnose the dev environment: ports in use, .next cache, font/CDN reachability",
      "secrets scan            Scan logs, tmp and recorded evidence for leaked credentials (masked output)",
      "backup [create|list|verify|restore]  Snapshots of the system home, verified by SHA-256 (native / auto-improve / pre-restore)",
      "evolution [list|append|verify]  Append-only registry of every change, with provenance and a hash chain",
      "manifest [sync|diff]    Baseline digests of the system files, and their drift from disk",
      "improve [scan|list|show|dismiss|apply]  Proposals only: missing category, unused skill, repeated failure (apply is supervised)",
      "repair [--apply]       Auto-repair on a closed whitelist (index, stale sessions, baseline); report by default",
      "report                  Session report",
      "clean                   Remove old logs and sessions",
      "snap [save|list|show|diff|restore|export|verify|prune|status]  Ledger snapshots (ours, no external tool)",
      "graph [build|status|find|all|trace|api|map|fresh|help]  Code graph (ours, in-process)",
      "commit <message> --files a,b  Commit only these paths (never another session's staged files)",
      "memory [status|clean|prune]  Project memory hygiene (dry-run by default, --apply)",
      "second-memory [init|doctor|lint|fix|sync|project-init|status|search|decisions|suggest]  Obsidian vault management (dry-run by default, --apply)",
      "upgrade [--apply]      Check for a newer release: npm (global installs) or git pull (source checkouts)",
      "docs [status|ingest <id>|--all]  Local docs index: state, or fill it (network)",
      "stitch [--key <k>]     Configure the Google Stitch MCP API key (interactive prompt if no --key)",
      "gate on|off            Persistently disable/enable the gate (restart OpenCode to apply)",
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

// Async so `doctor --deep` can await its MCP probes; every other command
// still returns void, which await handles transparently.
async function main(argv: string[]): Promise<void> {
  const parsed = parse(argv);
  if (typeof parsed.flags.home === "string" && parsed.flags.home.length > 0) {
    process.env.NOVAHIZ_HOME = resolve(expandHome(parsed.flags.home));
  }
  const command = parsed.positionals[0];
  // `--version` sans commande tombe sur `command === undefined` et affichait
  // l'aide : le test du drapeau doit passer avant celui de la commande.
  if (parsed.flags.version || parsed.flags.v) {
    printVersion();
    return;
  }
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  switch (command) {
    case "init":
      return commandInit(parsed);
    case "setup":
      return runInit();
    case "autodocs":
      return commandAutodocs(parsed);
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
      return commandUpgrade(parsed);
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
    case "gate": {
      const gateSub = (parsed.positionals[1] ?? "").toLowerCase();
      if (gateSub === "on" || gateSub === "off") return commandGateToggle(parsed);
      return commandGate(parsed);
    }
    case "stitch":
      return commandStitch(parsed);
    case "docs":
      return commandDocs(parsed);
    case "skills":
      return commandSkills(parsed);
    case "render":
      return commandRender(parsed);
    case "categories":
      return commandCategories();
    case "rules":
      return commandRules();
    case "session-load":
      return commandSessionLoad(parsed);
    case "session-state":
      return commandSessionState(parsed);
    case "resume":
      return commandResume(parsed);
    case "verify":
      return commandVerify(parsed);
    case "skillpack":
      return commandSkillpack(parsed);
    case "dev":
      return commandDev(parsed);
    case "secrets":
      return commandSecrets(parsed);
    case "backup":
      return commandBackup(parsed);
    case "evolution":
      return commandEvolution(parsed);
    case "manifest":
      return commandManifest(parsed);
    case "improve":
      return commandImprove(parsed);
    case "repair":
      return commandRepair(parsed);
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
    case "commit": {
      // Commit only the named paths. `git commit` without a pathspec publishes
      // whatever another session already staged; this one cannot.
      const message = asString(parsed.flags.message) || parsed.positionals[1] || "";
      const files = [
        ...splitList(parsed.flags.files),
        ...parsed.positionals.slice(2)
      ].filter((entry) => entry.length > 0);
      const outcome = scopedCommit(process.cwd(), { message, files });
      print(outcome);
      if (!outcome.ok) process.exitCode = 1;
      return;
    }
    case "tokens":
      return commandTokens(parsed);
    case "snap":
      return snapCommand(parsed.positionals.slice(1), parsed);
    case "graph":
      return graphCommand(parsed.positionals.slice(1), parsed);
    case "memory":
      return memoryCommand(parsed.positionals.slice(1), parsed);
    case "second-memory":
      return secondMemoryCommand(parsed.positionals.slice(1), parsed);
    default:
      process.stderr.write(`novahiz: unknown command "${command}"\n\n`);
      usage();
      process.exitCode = 1;
      return;
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`novahiz: ${message}\n`);
  process.exitCode = 1;
}
