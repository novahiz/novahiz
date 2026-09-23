import { join } from "node:path";
import { asString, dbPathFor, emit, parse, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import * as ui from "../render.ts";

export function commandReport(parsed: Parsed): void {
  const root = NovahizHome();
  const spec = loadSpec(root);
  const db = openDb(dbPathFor(root, spec));
  const total = (db.prepare("SELECT COUNT(*) AS n FROM enforcement_log").get() as { n: number }).n;
  const decisions = db.prepare("SELECT decision, COUNT(*) AS n FROM enforcement_log GROUP BY decision").all();
  const byTool = db.prepare("SELECT tool, COUNT(*) AS n FROM enforcement_log GROUP BY tool ORDER BY n DESC").all();
  const byClass = db.prepare("SELECT file_class, COUNT(*) AS n FROM enforcement_log GROUP BY file_class ORDER BY n DESC").all();
  const missingRows = db.prepare("SELECT missing FROM enforcement_log").all() as { missing: string }[];
  const invocations = (db.prepare("SELECT COUNT(*) AS n FROM skill_invocations").get() as { n: number }).n;
  const topSkills = db.prepare("SELECT skill, COUNT(*) AS n FROM skill_invocations GROUP BY skill ORDER BY n DESC LIMIT 10").all();
  const roadmapDone = (db.prepare("SELECT COUNT(*) AS n FROM roadmap_progress").get() as { n: number }).n;
  const roadmapBySession = db.prepare("SELECT session_id, COUNT(*) AS n FROM roadmap_progress GROUP BY session_id ORDER BY n DESC LIMIT 10").all();
  const taskCount = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  const activeTasks = (db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'active'").get() as { n: number }).n;
  const todoCount = (db.prepare("SELECT COUNT(*) AS n FROM todos").get() as { n: number }).n;
  const completedTodos = (db.prepare("SELECT COUNT(*) AS n FROM todos WHERE status = 'done'").get() as { n: number }).n;
  db.close();

  const counts: Record<string, number> = {};
  for (const row of missingRows) {
    let list: string[] = [];
    try {
      list = JSON.parse(row.missing) as string[];
    } catch {
      list = [];
    }
    for (const skill of list) counts[skill] = (counts[skill] ?? 0) + 1;
  }
  const topMissing = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([skill, n]) => ({ skill, n }));

  const report = { total, invocations, roadmapDone, tasks: taskCount, activeTasks, todos: todoCount, completedTodos, providers: spec.providers.map((provider) => provider.id), decisions, byTool, byClass, topMissing, topSkills, roadmapBySession };

  if (asString(parsed.flags.format) === "markdown") {
    const lines = [
      "# novahiz report",
      "",
      `Enforcement entries: ${total}`,
      `Skill invocations: ${invocations}`,
      `Roadmap steps done: ${roadmapDone}`,
      `Tasks: ${taskCount} (${activeTasks} active)`,
      `Todos: ${todoCount} (${completedTodos} done)`,
      "",
      "## Decisions",
      ...decisions.map((row) => `- ${(row as { decision: string }).decision}: ${(row as { n: number }).n}`),
      "",
      "## Top missing skills",
      ...topMissing.map((entry) => `- ${entry.skill}: ${entry.n}`),
      "",
      "## Top loaded skills",
      ...topSkills.map((row) => `- ${(row as { skill: string }).skill}: ${(row as { n: number }).n}`),
      ""
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  emit(parsed, report, () =>
    [
      ui.heading("novahiz report"),
      ui.kv([
        ["Enforcement log", String(total)],
        ["Skill invocations", String(invocations)],
        ["Roadmap steps completed", String(roadmapDone)],
        ["Tasks", `${taskCount} (${activeTasks} active)`],
        ["Todos", `${todoCount} (${completedTodos} done)`],
        ["Providers", String(spec.providers.length)]
      ]),
      "",
      ui.heading("Decisions"),
      ui.table(["decision", "n"], decisions.map((row) => [(row as { decision: string }).decision, String((row as { n: number }).n)])),
      "",
      ui.heading("Tools"),
      ui.table(["tool", "n"], byTool.map((row) => [String((row as { tool: string }).tool), String((row as { n: number }).n)])),
      "",
      ui.heading("Most expected skills"),
      ui.table(["skill", "n"], topMissing.map((entry) => [entry.skill, String(entry.n)])),
      "",
      ui.heading("Most loaded skills"),
      ui.table(["skill", "n"], topSkills.map((row) => [(row as { skill: string }).skill, String((row as { n: number }).n)]))
    ].join("\n")
  );
}

