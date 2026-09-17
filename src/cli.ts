import { resolve } from "node:path";
import { parse, print } from "./commands/context.ts";
import { expandHome } from "./spec.ts";

import { commandCheck, commandSync, commandClassify, commandSkills, commandCategories, commandRules, commandSessionLoad, commandSessionState, commandCatalog, commandRoadmap, commandStep, commandProviders, commandDeps, commandDispatch } from "./commands/inspect.ts";
import { commandGate } from "./commands/gate.ts";
import { commandReport } from "./commands/report.ts";
import { commandTask } from "./commands/task.ts";
import { commandClean } from "./commands/clean.ts";
import { commandDoctor } from "./commands/doctor.ts";
import { commandTokens } from "./commands/tokens.ts";

function usage(): void {
  print({
    name: "novahiz",
    commands: [
      "check",
      "sync",
      "classify <text> [--min-score N] [--max-categories N]",
      "gate --tool <tool> (--file <path> | --args-stdin) [--categories a,b] [--loaded a,b] [--session id]",
      "skills [--category id]",
      "categories",
      "rules",
      "session-load --session id --skill name",
      "session-state --session id",
      "report [--format markdown]",
      "catalog <query> [--limit N]",
      "roadmap --category id | <query>",
      "step --session id --done <step>",
      "providers [--category id] [--mcp-json] [--install]",
      "deps [--install]",
      "task new --title <title> [--id id] [--session id]",
      "task plan [--task id] [--session id] (JSON array on stdin or --json '<...>')",
      "task todo --label <label> [--task id] [--kind read|edit|verify|delegate] [--owner a,b] [--acceptance ...] [--max-iterations N]",
      "task start|done|block --id <todo> [--proof ...|--reason ...]",
      "task review [--task id] [--reason ...] [--json '<additions|amendments|removals|order>'] (or JSON on stdin)",
      "task amend --id <todo> [--label ...] [--kind ...] [--acceptance ...] [--owner a,b] [--max-iterations N]",
      "task insert --label <label> [--task id] [--kind ...] [--owner a,b] [--acceptance ...] [--position start|end|N]",
      "task drop --id <todo> [--reason ...]",
      "task reorder [--task id] --order <id,id,...>",
      "task signals [--task id]",
      "task status|resume|current [--session id]",
      "dispatch [--task id] [--session id]",
      "clean [--target logs|roadmap|sessions|tasks|all] [--days N] [--dry-run|--apply] [--vacuum] [--json]",
      "doctor [--json]",
      "tokens [--json] [--calibrate]"
    ]
  });}

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
    case "check":
      return commandCheck();
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
    case "report":
      return commandReport(parsed);
    case "clean":
      return commandClean(parsed);
    case "doctor":
      return commandDoctor(parsed);
    case "tokens":
      return commandTokens(parsed);
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
    case "task":
      return commandTask(parsed);
    case "dispatch":
      return commandDispatch(parsed);
    default:
      process.stderr.write(`novahiz: unknown command ${command}\n`);
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
