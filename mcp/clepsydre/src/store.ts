// clepsydre — persistance : un fichier tasks.json ecrit de facon atomique et
// un journal executions.jsonl en ajout seul. Aucune base de donnees, aucune
// dependance : le depot doit rester executable sans `npm install`.
//
//   <CLEPSYDRE_HOME|~/.novahiz/clepsydre>/
//     tasks.json         etat des tâches (ecrit via tmp + rename)
//     executions.jsonl   historique, une execution par ligne
//     executions.jsonl.1 generation precedente (rotation 512 Ko)
//
// L'ecriture atomique garantit qu'une coupure pendant l'ecriture laisse un
// fichier precedent lisible, jamais un JSON tronque : la file de taches ne
// disparait jamais a cause d'un arrêt brutal du process.

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TaskType = "shell" | "http" | "prompt";
export type RunStatus = "completed" | "failed" | "skipped";

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  description?: string;
  /** Expression de planification, ou null pour une tâche déclenchée à la demande. */
  schedule: string | null;
  enabled: boolean;
  timezone?: string;
  /** shell */
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  /** http */
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** prompt */
  prompt?: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: RunStatus | null;
}

export interface Execution {
  id: string;
  taskId: string;
  taskName: string;
  trigger: "schedule" | "manual";
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  output: string;
  exitCode?: number | null;
  error?: string;
  /** Instant théorique du déclenchement (rattrapage compris). */
  scheduledFor?: string | null;
}

const EXECUTIONS_MAX_BYTES = 512 * 1024;

export function homeDir(): string {
  const override = process.env.CLEPSYDRE_HOME;
  if (override !== undefined && override.trim().length > 0) return override.trim();
  return join(homedir(), ".novahiz", "clepsydre");
}

export function tasksPath(dir = homeDir()): string {
  return join(dir, "tasks.json");
}

export function executionsPath(dir = homeDir()): string {
  return join(dir, "executions.jsonl");
}

export function newId(prefix: "t" | "e" = "t"): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

interface StoreFile {
  version: 1;
  tasks: Task[];
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Lecture tolérante : fichier absent = liste vide, fichier illisible = mis de
 *  côté (.corrupt) plutôt que de bloquer l'agent avec une file corrompue. */
export function loadTasks(
  dir = homeDir()
): { tasks: Task[]; warning?: string } {
  const path = tasksPath(dir);
  if (!existsSync(path)) return { tasks: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { tasks: [], warning: `tasks.json illisible : ${(error as Error).message}` };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    const tasks = Array.isArray(parsed.tasks) ? (parsed.tasks as Task[]) : [];
    return { tasks: tasks.filter((task) => task && typeof task.id === "string") };
  } catch (error) {
    const aside = `${path}.corrupt-${Date.now()}`;
    try {
      renameSync(path, aside);
    } catch {
      // Déjà déplacé ou verrouillé : le message d'erreur reste le plus utile.
    }
    return { tasks: [], warning: `tasks.json corrompu (${(error as Error).message}), déplacé vers ${aside}` };
  }
}

/** Écriture atomique : contenu dans un fichier temporaire, puis rename. */
export function saveTasks(tasks: Task[], dir = homeDir()): void {
  ensureDir(dir);
  const path = tasksPath(dir);
  const payload: StoreFile = { version: 1, tasks };
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export type Mutation = (tasks: Task[]) => void;

/** Charge, applique la mutation, persiste : le seul chemin d'écriture. */
export function mutateTasks(mutation: Mutation, dir = homeDir()): Task[] {
  const { tasks } = loadTasks(dir);
  mutation(tasks);
  saveTasks(tasks, dir);
  return tasks;
}

export function findTask(tasks: Task[], id: string): Task | undefined {
  return tasks.find((task) => task.id === id || task.name === id);
}

export function upsertTask(task: Task, dir = homeDir()): { task: Task; created: boolean } {
  let created = false;
  let result = task;
  mutateTasks((tasks) => {
    const index = tasks.findIndex((existing) => existing.id === task.id);
    if (index >= 0) {
      tasks[index] = task;
    } else {
      created = true;
      tasks.push(task);
    }
    result = task;
  }, dir);
  return { task: result, created };
}

export function removeTask(id: string, dir = homeDir()): Task | undefined {
  let removed: Task | undefined;
  mutateTasks((tasks) => {
    const index = tasks.findIndex((task) => task.id === id || task.name === id);
    if (index >= 0) removed = tasks.splice(index, 1)[0];
  }, dir);
  return removed;
}

// --- journal des executions ------------------------------------------------

/** Ajout d'une ligne. Rotation à 512 Ko : une seule génération de repli. */
export function appendExecution(execution: Execution, dir = homeDir()): void {
  ensureDir(dir);
  const path = executionsPath(dir);
  try {
    if (existsSync(path)) {
      const size = readFileSync(path, "utf8").length;
      if (size > EXECUTIONS_MAX_BYTES) {
        renameSync(path, `${path}.1`);
      }
    }
    appendFileSync(path, `${JSON.stringify(execution)}\n`, "utf8");
  } catch (error) {
    // Le journal ne fait jamais échouer une exécution : l'action a eu lieu,
    // seule la trace manque. Le message remonte via le résultat de l'outil.
    throw new Error(`journal d'exécutions inaccessible : ${(error as Error).message}`);
  }
}

/** Historique, du plus récent au plus ancien, filtré par tâche si demandé. */
export function readExecutions(
  options: { taskId?: string; limit?: number } = {},
  dir = homeDir()
): Execution[] {
  const path = executionsPath(dir);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  const executions: Execution[] = [];
  for (let index = lines.length - 1; index >= 0 && executions.length < (options.limit ?? 50); index -= 1) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    try {
      const entry = JSON.parse(line) as Execution;
      if (options.taskId !== undefined && entry.taskId !== options.taskId) continue;
      executions.push(entry);
    } catch {
      // Ligne tronquée par une coupure : on saute, le reste du journal tient.
      continue;
    }
  }
  return executions;
}

/** Nettoyage test : supprime le dossier de données (jamais utilisé en prod). */
export function resetHome(dir = homeDir()): void {
  rmSync(dir, { recursive: true, force: true });
}
