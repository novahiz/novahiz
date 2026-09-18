import { statSync } from "node:fs";
import { join } from "node:path";
import { asString, confirm, dbPathFor, emit, flagOn, numberFlag, print, type Parsed } from "./context.ts";
import { loadSpec, skillenforceHome } from "../spec.ts";
import { openDb } from "../db.ts";
import * as ui from "../render.ts";

type CleanScope = { table: string; column: string; where?: string; label: string };

const CLEAN_SCOPES: Record<string, CleanScope[]> = {
  logs: [
    { table: "enforcement_log", column: "logged_at", label: "journal d'enforcement" },
    { table: "skill_invocations", column: "invoked_at", label: "invocations de skills" }
  ],
  roadmap: [{ table: "roadmap_progress", column: "updated_at", label: "progression de roadmap" }],
  sessions: [{ table: "sessions", column: "updated_at", label: "sessions" }],
  tasks: [{ table: "tasks", column: "created_at", where: "status <> 'active'", label: "taches terminees" }]
};

const CLEAN_CHOICES = ["logs", "roadmap", "sessions", "tasks", "all"];

export function commandClean(parsed: Parsed): void {
  const root = skillenforceHome();
  const spec = loadSpec(root);
  const path = dbPathFor(root, spec);
  const daysRaw = numberFlag(parsed, "days", { min: 1, integer: true });
  const days = daysRaw !== undefined && daysRaw > 0 ? Math.floor(daysRaw) : 30;
  const targetRaw = (asString(parsed.flags.target) || "logs").toLowerCase();
  if (!CLEAN_CHOICES.includes(targetRaw)) {
    print({ error: `cible inconnue: ${targetRaw}`, choices: CLEAN_CHOICES });
    process.exitCode = 1;
    return;
  }
  const scopes = targetRaw === "all" ? Object.values(CLEAN_SCOPES).flat() : CLEAN_SCOPES[targetRaw];
  const vacuum = flagOn(parsed, "vacuum");
  const apply = flagOn(parsed, "apply");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const db = openDb(path);
  const before = statSync(path).size;
  const plan = scopes.map((scope) => {
    const where = `${scope.column} < ?${scope.where ? ` AND ${scope.where}` : ""}`;
    const rows = (db.prepare(`SELECT COUNT(*) AS n FROM ${scope.table}`).get() as { n: number }).n;
    const deletable = (db.prepare(`SELECT COUNT(*) AS n FROM ${scope.table} WHERE ${where}`).get(cutoff) as { n: number }).n;
    return { table: scope.table, label: scope.label, rows, deletable };
  });
  const total = plan.reduce((sum, entry) => sum + entry.deletable, 0);

  const renderPlan = (): string => {
    const lines = [
      ui.heading("Skillenforce clean"),
      ui.kv([
        ["Base", `${path} (${ui.bytes(before)})`],
        ["Cible", targetRaw],
        ["Anciennete", `plus de ${days} jours, anterieur a ${cutoff}`],
        ["A retirer", `${total} ligne(s)`]
      ]),
      "",
      ui.table(["table", "lignes", "a supprimer"], plan.map((entry) => [entry.table, String(entry.rows), String(entry.deletable)])),
      ""
    ];
    if (targetRaw === "tasks" || targetRaw === "all") {
      lines.push(ui.style("dim", "Les todos orphelins des taches supprimees partent avec elles."));
    }
    return lines.join("\n");
  };

  if (!apply) {
    const interactive = process.stdin.isTTY === true;
    const explicitDryRun = flagOn(parsed, "dry-run");
    if (!interactive) {
      db.close();
      emit(parsed, { path, days, cutoff, target: targetRaw, vacuum, applied: false, bytesBefore: before, bytesAfter: before, deleted: 0, tables: plan }, () =>
        [renderPlan(), ui.style("dim", "Mode plan. Relance avec --apply pour supprimer.")].join("\n")
      );
      if (!explicitDryRun) {
        process.stderr.write("Entree non interactive : ajoute --apply pour supprimer, ou --dry-run pour garder seulement l'apercu.\n");
        process.exitCode = 1;
      }
      return;
    }
    process.stdout.write(`${renderPlan()}\n`);
    if (!confirm("Supprimer ces lignes ?")) {
      db.close();
      process.stdout.write(`${ui.style("yellow", "Annule.")}\n`);
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
        ["Supprime", `${deleted} ligne(s)`],
        ["Taille", `${ui.bytes(before)} vers ${ui.bytes(after)}`],
        ["Vacuum", vacuum ? "oui" : "non"]
      ])
    ].join("\n")
  );
}

