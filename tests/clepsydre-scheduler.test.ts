// Ordonnanceur clepsydre : echeance absolue (pas de derive), verrou
// anti-chevauchement, trois politiques de rattrapage, plafond de timer.
// L'horloge est injectee : aucune attente reelle dans ces tests.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  MAX_TIMER_MS,
  Scheduler,
  type RunContext,
  type SchedulerOptions
} from "../mcp/clepsydre/src/scheduler.ts";
import { loadTasks, readExecutions, saveTasks, type Task } from "../mcp/clepsydre/src/store.ts";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const MINUTE = 60_000;

const dirs: string[] = [];
function workdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clepsydre-sched-"));
  dirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Déjà nettoyé.
    }
  }
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    name: "tache-1",
    type: "shell",
    command: "echo",
    schedule: "every 10m",
    enabled: true,
    timezone: "UTC",
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    runCount: 0,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null,
    ...overrides
  };
}

interface Harness {
  dir: string;
  scheduler: Scheduler;
  runs: Array<{ id: string; context: RunContext }>;
}

function setup(
  tasks: Task[],
  options: Partial<SchedulerOptions> = {},
  clock: () => number = () => NOW
): Harness {
  const dir = workdir();
  saveTasks(tasks, dir);
  const runs: Harness["runs"] = [];
  const scheduler = new Scheduler({
    dir,
    now: clock,
    run: async (task, context) => {
      runs.push({ id: task.id, context });
      return undefined;
    },
    ...options
  });
  return { dir, scheduler, runs };
}

/** Vide la file de microtaches (les enchaînements de promesses). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("démarrage et armement", () => {
  test("start calcule les echeances puis arme le reveil", () => {
    const { scheduler, runs } = setup([
      makeTask({ id: "t-1", schedule: "every 10m" }),
      makeTask({ id: "t-2", schedule: "every 10m", enabled: false }),
      makeTask({ id: "t-3", schedule: null })
    ]);
    scheduler.start();
    // Réarmement explicite : le delai confirme l'echeance la plus proche.
    assert.equal(scheduler.arm(), 10 * MINUTE);
    scheduler.stop();
    assert.equal(runs.length, 0);
  });

  test("une tache active est planifiee, les autres restent nulles", () => {
    const { dir, scheduler } = setup([
      makeTask({ id: "t-1", schedule: "every 10m" }),
      makeTask({ id: "t-2", schedule: "every 10m", enabled: false }),
      makeTask({ id: "t-3", schedule: null })
    ]);
    scheduler.start();
    scheduler.stop();
    const { tasks } = loadTasks(dir);
    assert.equal(tasks.find((task) => task.id === "t-1")?.nextRunAt, new Date(NOW + 10 * MINUTE).toISOString());
    assert.equal(tasks.find((task) => task.id === "t-2")?.nextRunAt, null);
    assert.equal(tasks.find((task) => task.id === "t-3")?.nextRunAt, null);
  });

  test("refresh conserve une echeance existante, recalcule celle forcee a null", () => {
    const { dir, scheduler } = setup([
      makeTask({ id: "t-1", schedule: "every 10m", nextRunAt: new Date(NOW + 99_000).toISOString() }),
      makeTask({ id: "t-2", schedule: "every 30s", nextRunAt: null })
    ]);
    scheduler.refresh();
    const { tasks } = loadTasks(dir);
    assert.equal(tasks.find((task) => task.id === "t-1")?.nextRunAt, new Date(NOW + 99_000).toISOString());
    assert.equal(tasks.find((task) => task.id === "t-2")?.nextRunAt, new Date(NOW + 30_000).toISOString());
  });

  test("armement plafonne sous 2^31 ms", () => {
    const { scheduler } = setup([makeTask({ id: "t-1", nextRunAt: new Date(NOW + 30 * 86_400_000).toISOString() })]);
    assert.equal(scheduler.arm(), MAX_TIMER_MS);
    scheduler.stop();
  });

  test("armement : echeance passee = reveil immediat ; aucune tache = rien", () => {
    const late = setup([makeTask({ id: "t-1", nextRunAt: new Date(NOW - 5_000).toISOString() })]);
    assert.equal(late.scheduler.arm(), 0);
    late.scheduler.stop();
    const empty = setup([makeTask({ id: "t-1", enabled: false })]);
    assert.equal(empty.scheduler.arm(), null);
    empty.scheduler.stop();
  });
});

describe("reveil et exécution", () => {
  test("tache due : une execution, echeance suivante recalculee", async () => {
    const { dir, scheduler, runs } = setup([makeTask({ id: "t-1", nextRunAt: new Date(NOW - 1_000).toISOString() })]);
    scheduler.wake();
    await flush();
    scheduler.stop();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].context.trigger, "schedule");
    assert.equal(runs[0].context.scheduledFor, new Date(NOW - 1_000).toISOString());
    const next = loadTasks(dir).tasks[0].nextRunAt;
    assert.ok(next !== null && Date.parse(next) > NOW, `prochaine échéance future, recu ${next}`);
  });

  test("tache non due : rien ne se lance, l'echeance est conservee", async () => {
    const future = new Date(NOW + 5 * MINUTE).toISOString();
    const { dir, scheduler, runs } = setup([makeTask({ id: "t-1", nextRunAt: future })]);
    scheduler.wake();
    await flush();
    assert.equal(runs.length, 0);
    assert.equal(loadTasks(dir).tasks[0].nextRunAt, future);
  });

  test("tache désactivée ou sans schedule : jamais executée", async () => {
    const { scheduler, runs } = setup([
      makeTask({ id: "t-1", enabled: false, nextRunAt: new Date(NOW - MINUTE).toISOString() }),
      makeTask({ id: "t-2", schedule: null, nextRunAt: new Date(NOW - MINUTE).toISOString() })
    ]);
    scheduler.wake();
    await flush();
    assert.equal(runs.length, 0);
  });

  test("verrou : aucune seconde execution tant que la premiere dure", async () => {
    let release: (() => void) | undefined;
    const dir = workdir();
    saveTasks([makeTask({ id: "t-1", nextRunAt: new Date(NOW - MINUTE).toISOString() })], dir);
    const started: number[] = [];
    const scheduler = new Scheduler({
      dir,
      now: () => NOW,
      run: () => {
        started.push(1);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });
    scheduler.wake();
    assert.deepEqual(scheduler.busyTaskIds(), ["t-1"]);
    // L'exécution démarre dans la microtache suivante (verrou déjà pris).
    await flush();
    assert.equal(started.length, 1);
    // Echeance forcee dans le passe pendant l'execution : le verrou prime.
    saveTasks([makeTask({ id: "t-1", nextRunAt: new Date(NOW - MINUTE).toISOString() })], dir);
    scheduler.wake();
    assert.equal(started.length, 1);
    release?.();
    await flush();
    assert.deepEqual(scheduler.busyTaskIds(), []);
    scheduler.stop();
  });

  test("runNow : execution manuelle, refus si introuvable ou déjà en cours", async () => {
    const dir = workdir();
    saveTasks([makeTask({ id: "t-1" })], dir);
    let release: (() => void) | undefined;
    const scheduler = new Scheduler({
      dir,
      now: () => NOW,
      run: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    });
    assert.deepEqual(await scheduler.runNow("t-inconnu"), { ok: false, reason: "tâche introuvable : t-inconnu" });

    const pending = scheduler.runNow("t-1");
    await flush();
    assert.deepEqual(await scheduler.runNow("t-1"), { ok: false, reason: "exécution déjà en cours : tache-1" });
    release?.();
    assert.equal((await pending).ok, true);
    scheduler.stop();
  });
});

describe("politiques de rattrapage", () => {
  test("run-once (défaut) : une seule execution apres 2 h d'arret", async () => {
    const { dir, scheduler, runs } = setup(
      [makeTask({ id: "t-1", schedule: "every 30s", nextRunAt: new Date(NOW - 2 * 3_600_000).toISOString() })],
      { catchUp: "run-once" }
    );
    scheduler.wake();
    await flush();
    assert.equal(runs.length, 1);
    const next = loadTasks(dir).tasks[0].nextRunAt;
    assert.ok(next !== null && Date.parse(next) > NOW, `reprise du calendrier apres maintenant (${next})`);
  });

  test("skip : rien n'est rejoue, l'occurrence est tracee au journal", async () => {
    const { dir, scheduler, runs } = setup(
      [makeTask({ id: "t-1", schedule: "every 30s", nextRunAt: new Date(NOW - 2 * 3_600_000).toISOString() })],
      { catchUp: "skip" }
    );
    scheduler.wake();
    await flush();
    assert.equal(runs.length, 0);
    const entries = readExecutions({}, dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "skipped");
    assert.equal(entries[0].taskId, "t-1");
    assert.equal(entries[0].scheduledFor, new Date(NOW - 2 * 3_600_000).toISOString());
    assert.ok(Date.parse(loadTasks(dir).tasks[0].nextRunAt ?? "") > NOW);
  });

  test("run-all : les occurrences manquees sont rejouees une par une (plafond 10)", async () => {
    const { scheduler, runs } = setup(
      [makeTask({ id: "t-1", schedule: "every 30s", nextRunAt: new Date(NOW - 3_600_000).toISOString() })],
      { catchUp: "run-all", maxCatchUpRuns: 10 }
    );
    scheduler.wake();
    await flush();
    assert.equal(runs.length, 10);
    // Sequence strictement ordonnee : les scheduledFor sont croissants.
    const stamps = runs.map((run) => Date.parse(run.context.scheduledFor ?? "0"));
    assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
  });

  test("retard sous le seuil : execution normale, pas de traitement special", async () => {
    const { scheduler, runs } = setup(
      [makeTask({ id: "t-1", schedule: "every 30s", nextRunAt: new Date(NOW - 5_000).toISOString() })],
      { catchUp: "run-once", catchUpThresholdMs: 60_000 }
    );
    scheduler.wake();
    await flush();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].context.scheduledFor, new Date(NOW - 5_000).toISOString());
  });
});
