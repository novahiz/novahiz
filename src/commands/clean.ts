import { statSync } from "node:fs";
import { join } from "node:path";
import { asString, confirm, dbPathFor, emit, flagOn, numberFlag, print, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import * as ui from "../render.ts";

type CleanScope = { table: string; column: string; where?: string; label: string };

const CLEAN_SCOPES: Record<string, CleanScope[]> = {
  logs: [
    { table: "enforcement_log", column: "logged_at", label: "enforcement log" },
    { table: "skill_invocations", column: "invoked_at", label: "skill invocations" }
  ],
  roadmap: [{ table: "roadmap_progress", column: "updated_at", label: "roadmap progress" }],
  sessions: [{ table: "sessions", column: "updated_at", label: "sessions" }],
  tasks: [{ table: "tasks", column: "created_at", where: "status <> 'active'", label: "completed tasks" }]
};

const CLEAN_CHOICES = ["logs", "roadmap", "sessions", "tasks", "all"];

export function commandClean(parsed: Parsed): void {
  const root = NovahizHome();
  const spec = loadSpec(root);
  const path = dbPathFor(root, spec);
  const daysRaw = numberFlag(parsed, "days", { min: 1, integer: true });
  const days = daysRaw !== undefined && daysRaw > 0 ? Math.floor(daysRaw) : 30;
  const targetRaw = (asString(parsed.flags.target) || "logs").toLowerCase();
  if (!CLEAN_CHOICES.includes(targetRaw)) {
    print({ error: `unknown target: ${targetRaw}`, choices: CLEAN_CHOICES });
    process.exitCode = 1;
    return;
  }
  const scopes = targetRaw === "all" ? Object.values(CLEAN_SCOPES).flat() : CLEAN_SCOPES[targetRaw];
  const vacuum = flagOn(parsed, "vacuum");
  const apply = flagOn(parsed, "apply");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  // M13: only allow known tables from CLEAN_SCOPES to prevent SQL injection
  // via --target values. The CLEAN_CHOICES check above already gates this,
  // but we validate at the SQL layer too for defense-in-depth.
  const SAFE_TABLES = new Set(Object.values(CLEAN_SCOPES).flat().map((s) => s.table));

  const db = openDb(path);
  const before = statSync(path).size;
  const plan = scopes.map((scope) => {
    if (!SAFE_TABLES.has(scope.table)) throw new Error(`unsafe table: ${scope.table}`);
    const where = `${scope.column} < ?${scope.where ? ` AND ${scope.where}` : ""}`;
    const rows = (db.prepare(`SELECT COUNT(*) AS n FROM ${scope.table}`).get() as { n: number }).n;
    const deletable = (db.prepare(`SELECT COUNT(*) AS n FROM ${scope.table} WHERE ${where}`).get(cutoff) as { n: number }).n;
    return { table: scope.table, label: scope.label, rows, deletable };
  });
  const total = plan.reduce((sum, entry) => sum + entry.deletable, 0);

  const renderPlan = (): string => {
    const lines = [
      ui.heading("novahiz clean"),
      ui.kv([
        ["Base", `${path} (${ui.bytes(before)})`],
        ["Target", targetRaw],
        ["Age", `older than ${days} days, before ${cutoff}`],
        ["To delete", `${total} line(s)`]
      ]),
      "",
      ui.table(["table", "rows", "to delete"], plan.map((entry) => [entry.table, String(entry.rows), String(entry.deletable)])),
      ""
    ];
    if (targetRaw === "tasks" || targetRaw === "all") {
      lines.push(ui.style("dim", "Orphan todos of deleted tasks are removed with them."));
    }
    return lines.join("\n");
  };

  if (!apply) {
    const interactive = process.stdin.isTTY === true;
    const explicitDryRun = flagOn(parsed, "dry-run");
    if (!interactive) {
      db.close();
      emit(parsed, { path, days, cutoff, target: targetRaw, vacuum, applied: false, bytesBefore: before, bytesAfter: before, deleted: 0, tables: plan }, () =>
        [renderPlan(), ui.style("dim", "Plan mode. Restart with --apply to delete.")].join("\n")
      );
      if (!explicitDryRun) {
        process.stderr.write("Non-interactive input: add --apply to delete, or --dry-run to keep only the preview.\n");
        process.exitCode = 1;
      }
      return;
    }
    process.stdout.write(`${renderPlan()}\n`);
    if (!confirm("Delete these rows?")) {
      db.close();
      process.stdout.write(`${ui.style("yellow", "Canceled.")}\n`);
      return;
    }
  }

  let deleted = 0;
  for (const scope of scopes) {
    const where = `${scope.column} < ?${scope.where ? ` AND ${scope.where}` : ""}`;
    deleted += Number(db.prepare(`DELETE FROM ${scope.table} WHERE ${where}`).run(cutoff).changes);
  }
  if (targetRaw === "tasks" || targetRaw === "all") {
    deleted += Number(db.prepare("DELETE FROM todos WHERE task_id NOT IN (SELECT id FROM tasks)").run().changes);
  }
  if (vacuum) db.exec("VACUUM");
  db.close();
  const after = statSync(path).size;

  const value = { path, days, cutoff, target: targetRaw, vacuum, applied: true, bytesBefore: before, bytesAfter: after, deleted, tables: plan };
  emit(parsed, value, () =>
    [
      renderPlan(),
      ui.kv([
        ["Deleted", `${deleted} line(s)`],
        ["Size", `${ui.bytes(before)} to ${ui.bytes(after)}`],
        ["Vacuum", vacuum ? "yes" : "no"]
      ])
    ].join("\n")
  );
}

