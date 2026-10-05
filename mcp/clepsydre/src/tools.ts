// clepsydre — definitions des outils MCP et validation des entrees.
// Les schémas sont stricts (additionalProperties : false) : une entree
// inattendue est un echec d'outil (isError), jamais un echec de protocole.
// Les sept outils qui creent, modifient, suppriment ou declenchent une tache
// sont declares dans la liste GATE_TOOLS de novahiz (src/spec.ts) : le gate
// novahiz s'applique a eux comme aux outils d'edition.

import { readFileSync } from "node:fs";
import { assertTimezone, describeSchedule, nextRun, parseSchedule, ScheduleError } from "./cron.ts";
import { executeAndRecord } from "./executors.ts";
import { Scheduler } from "./scheduler.ts";
import {
  findTask,
  homeDir,
  loadTasks,
  newId,
  readExecutions,
  removeTask,
  tasksPath,
  upsertTask,
  type Task,
  type TaskType
} from "./store.ts";

type Json = Record<string, unknown>;

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
};

function text(payload: object, isError = false): Json {
  return { resultType: "complete", content: [{ type: "text", text: JSON.stringify(payload) }], isError };
}

function fail(message: string): Json {
  return text({ error: message }, true);
}

function requireString(args: Json, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} : chaine non vide attendue`);
  }
  return value.trim();
}

function optionalString(args: Json, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} : chaine attendue`);
  return value.trim();
}

function optionalBoolean(args: Json, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} : booleen attendu`);
  return value;
}

function optionalNumber(args: Json, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} : nombre attendu`);
  return value;
}

function optionalStringList(args: Json, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${key} : liste de chaines attendue`);
  }
  return value as string[];
}

function optionalHeaders(args: Json, key: string): Record<string, string> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} : objet attendue`);
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value as Json)) {
    if (typeof header !== "string") throw new Error(`${key}.${name} : chaine attendue`);
    headers[name] = header;
  }
  return headers;
}

// --- ordonnanceur partage (index.mjs le demarre, les tests le pilotent) ----

let scheduler = new Scheduler({ run: (task, context) => executeAndRecord(task, context) });

export function setScheduler(instance: Scheduler): void {
  scheduler = instance;
}

export function getScheduler(): Scheduler {
  return scheduler;
}

// --- construction des taches ------------------------------------------------

function buildTask(args: Json, type: TaskType): Task {
  const name = requireString(args, "name");
  const schedule = optionalString(args, "schedule") ?? null;
  const timezone = optionalString(args, "timezone");
  if (timezone !== undefined) assertTimezone(timezone);
  if (schedule !== null) parseSchedule(schedule);
  const now = new Date().toISOString();
  const task: Task = {
    id: optionalString(args, "id") ?? newId(),
    name,
    type,
    description: optionalString(args, "description"),
    schedule,
    enabled: optionalBoolean(args, "enabled") ?? true,
    timezone,
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null
  };
  if (type === "shell") {
    task.command = optionalString(args, "command");
    task.args = optionalStringList(args, "args");
    task.cwd = optionalString(args, "cwd");
    task.timeoutMs = optionalNumber(args, "timeoutMs");
    if (!task.command && (!task.args || task.args.length === 0)) {
      throw new Error("command ou args : une commande shell est requise");
    }
  } else if (type === "http") {
    task.url = optionalString(args, "url");
    task.method = optionalString(args, "method");
    task.headers = optionalHeaders(args, "headers");
    task.body = optionalString(args, "body");
    task.timeoutMs = optionalNumber(args, "timeoutMs");
    if (!task.url) throw new Error("url : une URL HTTP est requise");
  } else {
    task.prompt = optionalString(args, "prompt");
    if (!task.prompt) throw new Error("prompt : un texte de rappel est requis");
  }
  return task;
}

function summary(task: Task): Json {
  return {
    id: task.id,
    name: task.name,
    type: task.type,
    description: task.description ?? null,
    schedule: task.schedule,
    scheduleDescription: task.schedule ? describeSchedule(parseSchedule(task.schedule)) : null,
    enabled: task.enabled,
    timezone: task.timezone ?? null,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastStatus: task.lastStatus,
    runCount: task.runCount
  };
}

// --- definitions ------------------------------------------------------------

const baseProperties: Json = {
  name: { type: "string", description: "Nom de la tâche (unique, utilisé pour la retrouver)." },
  schedule: {
    type: ["string", "null"],
    description:
      "Expression de planification : cron 5 champs (\"*/5 * * * *\"), intervalle (\"every 30s\"), " +
      "date ISO one-shot, ou null pour une tâche déclenchée à la demande."
  },
  enabled: { type: "boolean", description: "Active immédiatement (défaut true)." },
  description: { type: "string", description: "Description libre." },
  timezone: { type: "string", description: "Fuseau IANA (ex. Europe/Paris). Défaut : fuseau du système." }
};

const shellProperties: Json = {
  command: { type: "string", description: "Commande shell (découpée en arguments, jamais interprétée)." },
  args: { type: "array", items: { type: "string" }, description: "Arguments explicites (prioritaires sur command)." },
  cwd: { type: "string", description: "Répertoire de travail." },
  timeoutMs: { type: "number", description: "Délai maximum en millisecondes (défaut 30000)." }
};

const httpProperties: Json = {
  url: { type: "string", description: "URL du webhook." },
  method: { type: "string", description: "Méthode HTTP (défaut POST)." },
  headers: { type: "object", additionalProperties: { type: "string" }, description: "En-têtes de la requête." },
  body: { type: "string", description: "Corps de la requête." },
  timeoutMs: { type: "number", description: "Délai maximum en millisecondes (défaut 30000)." }
};

const promptProperties: Json = {
  prompt: { type: "string", description: "Texte retourné au modèle au déclenchement." }
};

function tool(
  name: string,
  title: string,
  description: string,
  properties: Json,
  required: string[]
): ToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  };
}

export const TOOLS: readonly ToolDefinition[] = [
  tool(
    "clepsydre_server_info",
    "Server information",
    "Version du serveur, dossier de données, compteurs et expressions supportées.",
    {},
    []
  ),
  tool(
    "clepsydre_add_task",
    "Add a scheduled task",
    "Crée une tâche planifiée (shell, webhook HTTP ou rappel de prompt). L'identifiant est généré si omis.",
    {
      ...baseProperties,
      type: { enum: ["shell", "http", "prompt"], description: "Type de tâche." },
      ...shellProperties,
      ...httpProperties,
      ...promptProperties
    },
    ["name", "type"]
  ),
  tool(
    "clepsydre_add_shell_task",
    "Add a shell task",
    "Raccourci de clepsydre_add_task pour une commande shell.",
    { ...baseProperties, ...shellProperties },
    ["name", "command"]
  ),
  tool(
    "clepsydre_add_http_task",
    "Add an HTTP webhook task",
    "Raccourci de clepsydre_add_task pour un webhook HTTP.",
    { ...baseProperties, ...httpProperties },
    ["name", "url"]
  ),
  tool(
    "clepsydre_add_prompt_task",
    "Add a prompt reminder task",
    "Raccourci de clepsydre_add_task pour un rappel de prompt.",
    { ...baseProperties, ...promptProperties },
    ["name", "prompt"]
  ),
  tool(
    "clepsydre_update_task",
    "Update a task",
    "Modifie une tâche existante (nom, expression, fuseau, champs du type). Changer schedule ou timezone recalcule la prochaine échéance.",
    {
      id: { type: "string", description: "Identifiant ou nom de la tâche." },
      ...baseProperties,
      ...shellProperties,
      ...httpProperties,
      ...promptProperties
    },
    ["id"]
  ),
  tool(
    "clepsydre_remove_task",
    "Remove a task",
    "Supprime définitivement une tâche et la retire de la planification.",
    { id: { type: "string", description: "Identifiant ou nom de la tâche." } },
    ["id"]
  ),
  tool(
    "clepsydre_list_tasks",
    "List tasks",
    "Liste les tâches avec leur prochaine échéance, leur dernier état et leur compteur d'exécutions.",
    { includeDisabled: { type: "boolean", description: "Inclure les tâches désactivées (défaut true)." } },
    []
  ),
  tool(
    "clepsydre_get_task",
    "Get one task",
    "Retourne l'état complet d'une tâche.",
    { id: { type: "string", description: "Identifiant ou nom de la tâche." } },
    ["id"]
  ),
  tool(
    "clepsydre_enable_task",
    "Enable a task",
    "Active une tâche : sa prochaine échéance est recalculée.",
    { id: { type: "string", description: "Identifiant ou nom de la tâche." } },
    ["id"]
  ),
  tool(
    "clepsydre_disable_task",
    "Disable a task",
    "Désactive une tâche : plus aucun déclenchement automatique.",
    { id: { type: "string", description: "Identifiant ou nom de la tâche." } },
    ["id"]
  ),
  tool(
    "clepsydre_run_task_now",
    "Run a task now",
    "Déclenche une tâche en arrière-plan, sans attendre la planification. Refusé si une exécution est déjà en cours. Le résultat se consulte via clepsydre_get_task_results.",
    { id: { type: "string", description: "Identifiant ou nom de la tâche." } },
    ["id"]
  ),
  tool(
    "clepsydre_get_task_results",
    "Task execution history",
    "Historique des exécutions d'une tâche, de la plus récente à la plus ancienne.",
    {
      id: { type: "string", description: "Identifiant ou nom de la tâche." },
      limit: { type: "number", description: "Nombre maximum d'entrées (défaut 20, max 100)." }
    },
    ["id"]
  ),
  tool(
    "clepsydre_validate_schedule",
    "Validate a schedule expression",
    "Vérifie une expression et renvoie les prochains déclenchements, sans créer de tâche.",
    {
      schedule: { type: "string", description: "Expression à valider (cron, intervalle ou date ISO)." },
      timezone: { type: "string", description: "Fuseau IANA (défaut : fuseau du système)." },
      count: { type: "number", description: "Nombre de déclenchements à prévoir (défaut 3, max 10)." }
    },
    ["schedule"]
  )
];

// --- dispatch ----------------------------------------------------------------

function requireType(args: Json): TaskType {
  const value = args.type;
  if (value !== "shell" && value !== "http" && value !== "prompt") {
    throw new Error("type : shell, http ou prompt attendu");
  }
  return value;
}

function addTask(args: Json, type?: TaskType): Json {
  const task = buildTask(args, type ?? requireType(args));
  const { created } = upsertTask(task);
  return text({ created, task: summary(task) });
}

function updateTask(args: Json): Json {
  const id = requireString(args, "id");
  const { tasks } = loadTasks();
  const existing = findTask(tasks, id);
  if (!existing) throw new Error(`tâche introuvable : ${id}`);
  const scheduleChanged = args.schedule !== undefined && args.schedule !== existing.schedule;
  const timezoneChanged = args.timezone !== undefined && args.timezone !== existing.timezone;
  const enabledChanged = args.enabled !== undefined && args.enabled !== existing.enabled;
  // Copie explicite champ par champ : le type Task est un contrat de
  // persistance, pas un objet a etaler.
  const next: Task = {
    id: existing.id,
    name: existing.name,
    type: existing.type,
    description: existing.description,
    schedule: existing.schedule,
    enabled: existing.enabled,
    timezone: existing.timezone,
    command: existing.command,
    args: existing.args,
    cwd: existing.cwd,
    timeoutMs: existing.timeoutMs,
    url: existing.url,
    method: existing.method,
    headers: existing.headers,
    body: existing.body,
    prompt: existing.prompt,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
    runCount: existing.runCount,
    lastRunAt: existing.lastRunAt,
    nextRunAt: existing.nextRunAt,
    lastStatus: existing.lastStatus
  };
  for (const key of [
    "name",
    "description",
    "command",
    "args",
    "cwd",
    "timeoutMs",
    "url",
    "method",
    "headers",
    "body",
    "prompt"
  ] as const) {
    if (args[key] !== undefined) {
      (next as unknown as Json)[key] = args[key];
    }
  }
  if (args.schedule !== undefined) next.schedule = args.schedule === null ? null : requireString(args, "schedule");
  if (args.timezone !== undefined) next.timezone = args.timezone === null ? undefined : requireString(args, "timezone");
  if (args.enabled !== undefined) next.enabled = optionalBoolean(args, "enabled") ?? existing.enabled;
  if (scheduleChanged || timezoneChanged || (enabledChanged && next.enabled)) next.nextRunAt = null;
  next.updatedAt = new Date().toISOString();
  upsertTask(next);
  return text({ task: summary(next) });
}

function removeTaskTool(args: Json): Json {
  const id = requireString(args, "id");
  const removed = removeTask(id);
  if (!removed) throw new Error(`tâche introuvable : ${id}`);
  return text({ removed: true, task: summary(removed) });
}

function getTask(args: Json): Json {
  const id = requireString(args, "id");
  const { tasks } = loadTasks();
  const task = findTask(tasks, id);
  if (!task) throw new Error(`tâche introuvable : ${id}`);
  return text({ task });
}

function setEnabled(args: Json, enabled: boolean): Json {
  const id = requireString(args, "id");
  const { tasks } = loadTasks();
  const task = findTask(tasks, id);
  if (!task) throw new Error(`tâche introuvable : ${id}`);
  task.enabled = enabled;
  if (enabled) task.nextRunAt = null;
  task.updatedAt = new Date().toISOString();
  upsertTask(task);
  return text({ task: summary(task) });
}

function runNow(args: Json): Json {
  const id = requireString(args, "id");
  const outcome = scheduler.triggerNow(id);
  if (!outcome.ok) throw new Error(outcome.reason ?? "échec du déclenchement");
  return text({ triggered: true, note: "résultat consultable via clepsydre_get_task_results" });
}

function results(args: Json): Json {
  const id = requireString(args, "id");
  const { tasks } = loadTasks();
  if (!findTask(tasks, id)) throw new Error(`tâche introuvable : ${id}`);
  const limitRaw = optionalNumber(args, "limit") ?? 20;
  const limit = Math.min(Math.max(Math.floor(limitRaw), 1), 100);
  const executions = readExecutions({ taskId: id, limit });
  return text({ taskId: id, count: executions.length, executions });
}

function validate(args: Json): Json {
  const expression = requireString(args, "schedule");
  const timezone = optionalString(args, "timezone");
  const countRaw = optionalNumber(args, "count") ?? 3;
  const count = Math.min(Math.max(Math.floor(countRaw), 1), 10);
  const schedule = parseSchedule(expression);
  const nextRuns: string[] = [];
  let cursor = Date.now();
  for (let index = 0; index < count; index += 1) {
    const following = nextRun(schedule, cursor, timezone);
    if (following === null) break;
    nextRuns.push(new Date(following).toISOString());
    cursor = following;
  }
  return text({
    schedule: expression,
    kind: schedule.kind,
    description: describeSchedule(schedule),
    timezone: timezone ?? null,
    nextRuns
  });
}

let serverVersion = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as Json;
  serverVersion = String(pkg.version ?? "0.0.0");
} catch {
  // package.json absent (installation deplacee) : version neutre, sans impact.
}

export function callTool(name: string, args: Json): Json {
  try {
    if (name === "clepsydre_server_info") {
      const { tasks } = loadTasks();
      return text({
        name: "novahiz-scheduler",
        version: serverVersion,
        dataDir: homeDir(),
        tasksFile: tasksPath(),
        counts: {
          total: tasks.length,
          enabled: tasks.filter((task) => task.enabled).length,
          scheduled: tasks.filter((task) => task.schedule !== null).length
        },
        supported: ["cron 5 champs + macros", "every 30s / 10m / 2h / 1d", "date ISO one-shot"]
      });
    }
    if (name === "clepsydre_add_task") return addTask(args);
    if (name === "clepsydre_add_shell_task") return addTask(args, "shell");
    if (name === "clepsydre_add_http_task") return addTask(args, "http");
    if (name === "clepsydre_add_prompt_task") return addTask(args, "prompt");
    if (name === "clepsydre_update_task") return updateTask(args);
    if (name === "clepsydre_remove_task") return removeTaskTool(args);
    if (name === "clepsydre_list_tasks") {
      const includeDisabled = optionalBoolean(args, "includeDisabled") ?? true;
      const { tasks } = loadTasks();
      const visible = tasks
        .filter((task) => includeDisabled || task.enabled)
        .map(summary)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return text({ count: visible.length, tasks: visible });
    }
    if (name === "clepsydre_get_task") return getTask(args);
    if (name === "clepsydre_enable_task") return setEnabled(args, true);
    if (name === "clepsydre_disable_task") return setEnabled(args, false);
    if (name === "clepsydre_run_task_now") return runNow(args);
    if (name === "clepsydre_get_task_results") return results(args);
    if (name === "clepsydre_validate_schedule") return validate(args);
    return fail(`outil inconnu : ${name}`);
  } catch (error) {
    if (error instanceof ScheduleError) return fail(error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  }
}
