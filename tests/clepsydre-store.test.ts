// Persistance clepsydre : écriture atomique, CRUD idempotent, journal en
// ajout seul. Chaque test travaille dans son propre dossier temporaire —
// ni ~/.novahiz ni aucune donnée réelle ne sont touchés.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  appendExecution,
  executionsPath,
  findTask,
  homeDir,
  loadTasks,
  mutateTasks,
  newId,
  readExecutions,
  removeTask,
  saveTasks,
  tasksPath,
  upsertTask,
  type Execution,
  type Task
} from "../mcp/clepsydre/src/store.ts";

const dirs: string[] = [];
function workdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clepsydre-store-"));
  dirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Déjà nettoyé : rien à signaler.
    }
  }
});

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: newId(),
    name: "tâche-exemple",
    type: "shell",
    command: "echo",
    args: ["hello"],
    schedule: "*/5 * * * *",
    enabled: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    runCount: 0,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null,
    ...overrides
  };
}

describe("stockage des tâches", () => {
  test("dossier vide : aucune tâche, aucun fichier créé", () => {
    const dir = workdir();
    assert.deepEqual(loadTasks(dir), { tasks: [] });
    assert.equal(existsSync(tasksPath(dir)), false);
  });

  test("sauvegarde atomique : le fichier final est complet, aucun temporaire résiduel", () => {
    const dir = workdir();
    const first = task();
    saveTasks([first], dir);
    assert.equal(existsSync(`${tasksPath(dir)}.tmp-${process.pid}`), false);
    const parsed = JSON.parse(readFileSync(tasksPath(dir), "utf8"));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.tasks.length, 1);
    assert.equal(parsed.tasks[0].id, first.id);
    // Réécriture par-dessus : même garantie (rename remplace l'ancien fichier).
    saveTasks([], dir);
    assert.equal(JSON.parse(readFileSync(tasksPath(dir), "utf8")).tasks.length, 0);
  });

  test("upsert : création puis mise à jour par identifiant stable", () => {
    const dir = workdir();
    const first = task({ id: "t-stable" });
    assert.equal(upsertTask(first, dir).created, true);
    assert.equal(upsertTask({ ...first, enabled: false }, dir).created, false);
    const { tasks } = loadTasks(dir);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].enabled, false);
  });

  test("suppression par id ou par nom, et lecture avec recherche", () => {
    const dir = workdir();
    upsertTask(task({ id: "t-a", name: "nom-a" }), dir);
    upsertTask(task({ id: "t-b", name: "nom-b" }), dir);
    assert.equal(removeTask("t-a", dir)?.id, "t-a");
    assert.equal(removeTask("nom-b", dir)?.id, "t-b");
    assert.equal(removeTask("t-inconnu", dir), undefined);
    const { tasks } = loadTasks(dir);
    assert.equal(tasks.length, 0);
    assert.equal(findTask([task({ id: "t-c", name: "nom-c" })], "nom-c")?.id, "t-c");
  });

  test("mutateTasks applique puis persiste", () => {
    const dir = workdir();
    upsertTask(task({ id: "t-1", runCount: 0 }), dir);
    const after = mutateTasks((tasks) => {
      const target = findTask(tasks, "t-1");
      if (target) target.runCount += 1;
    }, dir);
    assert.equal(after[0].runCount, 1);
    assert.equal(loadTasks(dir).tasks[0].runCount, 1);
  });

  test("fichier corrompu : déplacé de côté, jamais un crash", () => {
    const dir = workdir();
    writeFileSync(tasksPath(dir), '{"version":1,"tasks":[{"id":"t-x"', "utf8");
    const result = loadTasks(dir);
    assert.deepEqual(result.tasks, []);
    assert.match(result.warning ?? "", /corrompu/);
    assert.equal(existsSync(tasksPath(dir)), false);
    const aside = readdirSync(dir).filter((name) => name.includes("corrupt"));
    assert.equal(aside.length, 1);
  });

  test("CLEPSYDRE_HOME redirige le dossier de données", () => {
    const previous = process.env.CLEPSYDRE_HOME;
    const dir = workdir();
    process.env.CLEPSYDRE_HOME = dir;
    try {
      assert.equal(homeDir(), dir);
      assert.equal(tasksPath(), join(dir, "tasks.json"));
    } finally {
      if (previous === undefined) delete process.env.CLEPSYDRE_HOME;
      else process.env.CLEPSYDRE_HOME = previous;
    }
  });
});

describe("journal des exécutions", () => {
  function execution(overrides: Partial<Execution> = {}): Execution {
    return {
      id: newId("e"),
      taskId: "t-a",
      taskName: "tâche-a",
      trigger: "manual",
      status: "completed",
      startedAt: "2026-10-04T10:00:00.000Z",
      finishedAt: "2026-10-04T10:00:00.100Z",
      durationMs: 100,
      output: "ok",
      ...overrides
    };
  }

  test("append puis lecture, du plus récent au plus ancien", () => {
    const dir = workdir();
    appendExecution(execution({ id: "e-1", finishedAt: "2026-10-04T10:00:00.000Z" }), dir);
    appendExecution(execution({ id: "e-2", finishedAt: "2026-10-04T11:00:00.000Z" }), dir);
    const all = readExecutions({}, dir);
    assert.deepEqual(all.map((entry) => entry.id), ["e-2", "e-1"]);
    assert.equal(existsSync(executionsPath(dir)), true);
  });

  test("filtrage par tâche et limite", () => {
    const dir = workdir();
    for (let index = 0; index < 5; index += 1) {
      appendExecution(execution({ id: `e-a-${index}`, taskId: "t-a" }), dir);
      appendExecution(execution({ id: `e-b-${index}`, taskId: "t-b" }), dir);
    }
    assert.equal(readExecutions({ taskId: "t-b" }, dir).length, 5);
    assert.equal(readExecutions({ taskId: "t-b", limit: 2 }, dir).length, 2);
    assert.equal(readExecutions({ limit: 3 }, dir).length, 3);
  });

  test("ligne tronquée : ignorée, le reste du journal reste lisible", () => {
    const dir = workdir();
    appendExecution(execution({ id: "e-ok" }), dir);
    writeFileSync(executionsPath(dir), '{"id":"e-coupe","taskI\n', { encoding: "utf8", flag: "a" });
    appendExecution(execution({ id: "e-apres" }), dir);
    const ids = readExecutions({}, dir).map((entry) => entry.id);
    assert.deepEqual(ids, ["e-apres", "e-ok"]);
  });

  test("rotation au-delà de 512 Ko : une génération de repli", () => {
    const dir = workdir();
    const big = execution({ output: "x".repeat(20_000) });
    for (let index = 0; index < 40; index += 1) appendExecution({ ...big, id: `e-${index}` }, dir);
    assert.equal(existsSync(`${executionsPath(dir)}.1`), true);
    // Après rotation, la courante ne dépasse pas le seuil plus une entrée.
    assert.ok(readFileSync(executionsPath(dir), "utf8").length <= 512 * 1024 + 25_000);
  });
});
