// Executeurs clepsydre : decoupe de commande sans interpretation, taches
// prompt sans execution, echec shell journalise, compteurs et journal mis a
// jour. La commande reelle utilisee ici est le binaire node lui-meme
// (process.execPath) : aucun shell, aucun binaire tiers requis.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { executeAndRecord, executeTask, tokenize } from "../mcp/clepsydre/src/executors.ts";
import { loadTasks, readExecutions, upsertTask, type Task } from "../mcp/clepsydre/src/store.ts";

const dirs: string[] = [];
let previousHome: string | undefined;

after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Déjà nettoyé.
    }
  }
  if (previousHome === undefined) delete process.env.CLEPSYDRE_HOME;
  else process.env.CLEPSYDRE_HOME = previousHome;
});

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "clepsydre-exec-"));
  dirs.push(dir);
  previousHome = process.env.CLEPSYDRE_HOME;
  process.env.CLEPSYDRE_HOME = dir;
  return dir;
}

function shellTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-shell",
    name: "shell",
    type: "shell",
    schedule: null,
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

describe("tokenize", () => {
  test("decoupe simple sur les espaces", () => {
    assert.deepEqual(tokenize("echo hello world"), ["echo", "hello", "world"]);
  });

  test("guillemets simples et doubles", () => {
    assert.deepEqual(tokenize(`echo "a b" 'c d' e`), ["echo", "a b", "c d", "e"]);
  });

  test("espaces multiples et guillemets vides", () => {
    assert.deepEqual(tokenize("  echo   ''  x  "), ["echo", "", "x"]);
  });

  test("guillemet non ferme : erreur", () => {
    assert.throws(() => tokenize('echo "oops'), /guillemet non fermé/);
  });
});

describe("executeTask", () => {
  test("prompt : le texte est retourne, rien n'est execute", async () => {
    setup();
    const outcome = await executeTask(
      shellTask({ id: "t-p", name: "p", type: "prompt", prompt: "verifier les logs" })
    );
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.output, "verifier les logs");
    assert.equal(outcome.exitCode, null);
  });

  test("shell sans commande : echec propre", async () => {
    setup();
    const outcome = await executeTask(shellTask({ command: undefined, args: [] }));
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error ?? "", /aucune commande/);
  });

  test("shell : le binaire node repond, sortie capturee", async () => {
    setup();
    const outcome = await executeTask(
      shellTask({ args: [process.execPath, "-e", "process.stdout.write('bonjour')"] })
    );
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.output, "bonjour");
  });

  test("shell : commande inexistante = echec, pas de crash", async () => {
    setup();
    const outcome = await executeTask(
      shellTask({ args: ["clepsydre-commande-qui-nexiste-pas-12345"] })
    );
    assert.equal(outcome.status, "failed");
    assert.ok((outcome.error ?? "").length > 0);
  });

  test("shell : code de sortie non nul = echec avec code", async () => {
    setup();
    const outcome = await executeTask(
      shellTask({ args: [process.execPath, "-e", "process.exit(3)"] })
    );
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.exitCode, 3);
  });

  test("shell : stderr est conserve dans la sortie", async () => {
    setup();
    const outcome = await executeTask(
      shellTask({ args: [process.execPath, "-e", "console.error('alerte')"] })
    );
    assert.equal(outcome.status, "completed");
    assert.match(outcome.output, /alerte/);
  });

  test("shell : timeout court interrompt l'execution", { timeout: 10_000 }, async () => {
    setup();
    const outcome = await executeTask(
      shellTask({
        args: [process.execPath, "-e", "setTimeout(() => {}, 30000)"],
        timeoutMs: 500
      })
    );
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error ?? "", /interrompue/);
  });
});

describe("executeAndRecord", () => {
  test("compteurs, statut et journal apres une execution reussie", async () => {
    const dir = setup();
    upsertTask(shellTask({ id: "t-r", args: [process.execPath, "-e", "process.stdout.write('ok')"] }), dir);
    const task = loadTasks(dir).tasks[0];
    const execution = await executeAndRecord(task, { trigger: "manual", scheduledFor: null });
    assert.equal(execution.taskId, "t-r");
    assert.equal(execution.status, "completed");
    assert.equal(execution.trigger, "manual");
    assert.ok(execution.durationMs >= 0);
    const after = loadTasks(dir).tasks[0];
    assert.equal(after.runCount, 1);
    assert.equal(after.lastStatus, "completed");
    assert.ok(after.lastRunAt !== null);
    const history = readExecutions({ taskId: "t-r" }, dir);
    assert.equal(history.length, 1);
    assert.equal(history[0].output, "ok");
  });

  test("une tache one-shot deja due n'est plus planifiee apres execution", async () => {
    const dir = setup();
    const past = new Date(Date.now() - 60_000).toISOString();
    upsertTask(
      shellTask({ id: "t-once", schedule: past, args: [process.execPath, "-e", "1"] }),
      dir
    );
    const task = loadTasks(dir).tasks[0];
    await executeAndRecord(task, { trigger: "schedule", scheduledFor: past });
    const after = loadTasks(dir).tasks[0];
    assert.equal(after.nextRunAt, null);
    assert.equal(after.runCount, 1);
  });

  test("un one-shot futur declenche en avance garde son echeance", async () => {
    const dir = setup();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    upsertTask(
      shellTask({ id: "t-once-futur", schedule: future, args: [process.execPath, "-e", "1"] }),
      dir
    );
    const task = loadTasks(dir).tasks[0];
    await executeAndRecord(task, { trigger: "manual", scheduledFor: null });
    assert.equal(loadTasks(dir).tasks[0].nextRunAt, future);
  });

  test("echec shell : statut failed et erreur journalisee", async () => {
    const dir = setup();
    upsertTask(shellTask({ id: "t-f", args: [process.execPath, "-e", "process.exit(7)"] }), dir);
    const task = loadTasks(dir).tasks[0];
    const execution = await executeAndRecord(task, { trigger: "manual", scheduledFor: null });
    assert.equal(execution.status, "failed");
    assert.equal(execution.exitCode, 7);
    assert.equal(loadTasks(dir).tasks[0].lastStatus, "failed");
  });
});
