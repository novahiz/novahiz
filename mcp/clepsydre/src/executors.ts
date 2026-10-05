// clepsydre — executeurs des trois types de taches, puis journalisation.
//   shell  : execFile, JAMAIS de shell (pas d'interpretation de la commande)
//   http   : fetch avec timeout et taille de reponse bornee
//   prompt : le texte est retourne au modele, rien n'est execute
// Chaque execution met a jour les compteurs de la tache et ajoute une ligne au
// journal : l'historique reste consultable meme si le process redemarre.

import { execFile } from "node:child_process";
import { appendExecution, findTask, mutateTasks, newId, type Execution, type RunStatus, type Task } from "./store.ts";
import { nextRun, parseSchedule } from "./cron.ts";
import type { RunContext } from "./scheduler.ts";

export const OUTPUT_MAX_CHARS = 16_000;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExecOutcome {
  status: RunStatus;
  output: string;
  exitCode: number | null;
  error?: string;
}

function truncate(text: string): string {
  return text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}\n… tronqué à ${OUTPUT_MAX_CHARS} caractères` : text;
}

/** Decoupe une commande shell en arguments, sans jamais l'interpretter :
 *  guillemets simples et doubles respectes, espaces simples ignores. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current.length > 0) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
  }
  if (quote !== null) throw new Error("guillemet non fermé dans la commande");
  if (started || current.length > 0) tokens.push(current);
  return tokens;
}

function runShell(task: Task): Promise<ExecOutcome> {
  const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = task.args ?? (task.command ? tokenize(task.command) : []);
  if (args.length === 0) {
    return Promise.resolve({ status: "failed", output: "", exitCode: null, error: "aucune commande fournie" });
  }
  const [command, ...rest] = args;
  return new Promise((resolve) => {
    execFile(
      command,
      rest,
      {
        cwd: task.cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: process.env
      },
      (error, stdout, stderr) => {
        const output = truncate(`${stdout}${stderr ? `\n${stderr}` : ""}`.trimEnd());
        if (error) {
          const code = typeof error.code === "number" ? error.code : null;
          const killed = error.killed === true || error.signal !== undefined;
          resolve({
            status: "failed",
            output,
            exitCode: code,
            error: killed ? `exécution interrompue (timeout ${timeoutMs} ms ou signal)` : error.message
          });
          return;
        }
        resolve({ status: "completed", output, exitCode: 0 });
      }
    );
  });
}

async function runHttp(task: Task): Promise<ExecOutcome> {
  const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = (task.method ?? "POST").toUpperCase();
  const headers = task.headers ?? {};
  const body = task.body;
  try {
    const response = await fetch(task.url ?? "", {
      method,
      headers,
      body: body === undefined ? undefined : body,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    const output = truncate(
      `HTTP ${response.status} ${response.statusText}\n${text}`.trimEnd()
    );
    if (!response.ok) {
      return { status: "failed", output, exitCode: response.status, error: `statut HTTP ${response.status}` };
    }
    return { status: "completed", output, exitCode: response.status };
  } catch (error) {
    return {
      status: "failed",
      output: "",
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Execute la tache selon son type. Aucune ecriture ici : la journalisation
 *  est la responsabilite de executeAndRecord. */
export async function executeTask(task: Task): Promise<ExecOutcome> {
  if (task.type === "shell") return runShell(task);
  if (task.type === "http") return runHttp(task);
  const prompt = task.prompt ?? "";
  return { status: "completed", output: prompt, exitCode: null };
}

/** Recalcule la prochaine echeance apres une execution (une tache one-shot
 *  devient null : elle ne se declenchera plus jamais). */
function recomputeNext(task: Task): string | null {
  if (!task.schedule) return null;
  try {
    const schedule = parseSchedule(task.schedule);
    const tz = task.timezone && task.timezone.length > 0 ? task.timezone : undefined;
    const following = nextRun(schedule, Date.now(), tz);
    return following === null ? null : new Date(following).toISOString();
  } catch {
    return null;
  }
}

/** Execute, met a jour les compteurs, ajoute la ligne d'historique. */
export async function executeAndRecord(task: Task, context: RunContext): Promise<Execution> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const outcome = await executeTask(task);
  const finishedAt = new Date().toISOString();
  const execution: Execution = {
    id: newId("e"),
    taskId: task.id,
    taskName: task.name,
    trigger: context.trigger,
    status: outcome.status,
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
    output: outcome.output,
    exitCode: outcome.exitCode,
    error: outcome.error,
    scheduledFor: context.scheduledFor
  };
  appendExecution(execution);
  mutateTasks((tasks) => {
    const target = findTask(tasks, task.id);
    if (!target) return;
    target.runCount += 1;
    target.lastRunAt = finishedAt;
    target.lastStatus = outcome.status;
    target.nextRunAt = recomputeNext(target);
  });
  return execution;
}
