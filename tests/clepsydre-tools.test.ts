// Outils clepsydre : validation des entrees, CRUD complet, declenchement
// manuel, historique et validation d'expression. Chaque test isole son
// dossier de donnees via CLEPSYDRE_HOME et son propre ordonnanceur.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { callTool, setScheduler } from "../mcp/clepsydre/src/tools.ts";
import { Scheduler } from "../mcp/clepsydre/src/scheduler.ts";
import { loadTasks } from "../mcp/clepsydre/src/store.ts";

type Json = Record<string, unknown>;

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

function workdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clepsydre-tools-"));
  dirs.push(dir);
  return dir;
}

function setup(): string {
  const dir = workdir();
  previousHome = process.env.CLEPSYDRE_HOME;
  process.env.CLEPSYDRE_HOME = dir;
  setScheduler(new Scheduler({ dir, run: async () => undefined }));
  return dir;
}

function call(name: string, args: Json = {}): Json {
  const response = callTool(name, args);
  return response;
}

function ok(name: string, args: Json = {}): Json {
  const response = call(name, args);
  assert.notEqual(response.isError, true, `echec inattendu : ${JSON.stringify(response)}`);
  const payload = JSON.parse(String((response.content as Json[])[0].text)) as Json;
  return payload;
}

function ko(name: string, args: Json = {}): string {
  const response = call(name, args);
  assert.equal(response.isError, true, `echec attendu : ${JSON.stringify(response)}`);
  const payload = JSON.parse(String((response.content as Json[])[0].text)) as Json;
  return String(payload.error);
}

describe("clepsydre_server_info", () => {
  test("compteurs a zero sur un dossier vide", () => {
    setup();
    const info = ok("clepsydre_server_info");
    assert.equal(info.name, "novahiz-scheduler");
    assert.equal((info.counts as Json).total, 0);
    assert.match(String(info.dataDir), /clepsydre/);
  });
});

describe("creation", () => {
  test("tache shell planifiee", () => {
    setup();
    const payload = ok("clepsydre_add_task", {
      name: "sauvegarde",
      type: "shell",
      command: "echo",
      args: ["hello"],
      schedule: "*/5 * * * *",
      description: "toutes les 5 minutes"
    });
    assert.equal(payload.created, true);
    const task = payload.task as Json;
    assert.equal(task.type, "shell");
    assert.equal(task.schedule, "*/5 * * * *");
    assert.equal(task.scheduleDescription, 'cron "*/5 * * * *"');
    assert.equal(task.enabled, true);
    assert.equal(task.runCount, 0);
  });

  test("raccourcis par type", () => {
    setup();
    const shell = ok("clepsydre_add_shell_task", { name: "s", command: "echo hi" });
    assert.equal((shell.task as Json).type, "shell");
    const http = ok("clepsydre_add_http_task", { name: "h", url: "http://127.0.0.1:9/x", method: "GET" });
    assert.equal((http.task as Json).type, "http");
    const prompt = ok("clepsydre_add_prompt_task", { name: "p", prompt: "verifier les logs" });
    assert.equal((prompt.task as Json).type, "prompt");
  });

  test("tache a la demande (schedule null)", () => {
    setup();
    const payload = ok("clepsydre_add_task", { name: "manuelle", type: "prompt", prompt: "x", schedule: null });
    assert.equal((payload.task as Json).schedule, null);
  });

  test("erreurs de validation remontent comme isError", () => {
    setup();
    assert.match(ko("clepsydre_add_task", { name: "x", type: "shell" }), /command ou args/);
    assert.match(ko("clepsydre_add_task", { name: "x", type: "http" }), /url/);
    assert.match(ko("clepsydre_add_task", { name: "x", type: "prompt" }), /prompt/);
    assert.match(ko("clepsydre_add_task", { name: "x", type: "nope" }), /type : shell/);
    assert.match(ko("clepsydre_add_task", { name: "x", type: "shell", command: "echo", schedule: "* * * *" }), /5 attendus/);
    assert.match(ko("clepsydre_add_task", { name: "x", type: "shell", command: "echo", timezone: "Mars/Phobos" }), /fuseau horaire inconnu/);
    assert.match(ko("clepsydre_add_task", { name: "x", type: "shell", command: "echo", schedule: "@reboot" }), /@reboot/);
    assert.match(ko("clepsydre_add_task", { type: "shell", command: "echo" }), /name/);
  });
});

describe("cycle de vie", () => {
  test("liste, lecture, mise a jour, activation", () => {
    const dir = setup();
    const created = ok("clepsydre_add_shell_task", { name: "alpha", command: "echo a" });
    const id = String((created.task as Json).id);

    const list = ok("clepsydre_list_tasks");
    assert.equal((list.tasks as Json[]).length, 1);

    const fetched = ok("clepsydre_get_task", { id });
    assert.equal((fetched.task as Json).name, "alpha");

    const updated = ok("clepsydre_update_task", { id, schedule: "0 3 * * *", description: "nuit" });
    assert.equal((updated.task as Json).schedule, "0 3 * * *");
    assert.equal((updated.task as Json).description, "nuit");
    // Changement d'expression : echeance a recalculer.
    assert.equal((updated.task as Json).nextRunAt, null);

    const disabled = ok("clepsydre_disable_task", { id });
    assert.equal((disabled.task as Json).enabled, false);
    const hidden = ok("clepsydre_list_tasks", { includeDisabled: false });
    assert.equal((hidden.tasks as Json[]).length, 0);
    const enabled = ok("clepsydre_enable_task", { id });
    assert.equal((enabled.task as Json).enabled, true);

    // L'ordonnanceur recalcule l'echeance d'une tache active.
    const scheduler = new Scheduler({ dir, run: async () => undefined });
    scheduler.refresh();
    scheduler.stop();
    const after = loadTasks(dir).tasks[0];
    assert.ok(after.nextRunAt !== null, "echeance recalculee apres activation");
  });

  test("suppression par identifiant ou par nom", () => {
    setup();
    ok("clepsydre_add_shell_task", { name: "a", command: "echo a" });
    ok("clepsydre_add_shell_task", { name: "b", command: "echo b" });
    const removed = ok("clepsydre_remove_task", { id: "a" });
    assert.equal(removed.removed, true);
    assert.match(ko("clepsydre_remove_task", { id: "a" }), /introuvable/);
    ok("clepsydre_remove_task", { id: "b" });
    assert.equal((ok("clepsydre_list_tasks").tasks as Json[]).length, 0);
  });

  test("declenchement manuel (détaché, résultat via l'historique)", async () => {
    setup();
    const created = ok("clepsydre_add_shell_task", { name: "run", command: "echo go" });
    const id = String((created.task as Json).id);
    const triggered = ok("clepsydre_run_task_now", { id });
    assert.equal(triggered.triggered, true);
    assert.match(ko("clepsydre_run_task_now", { id: "t-inconnu" }), /introuvable/);
  });

  test("historique vide puis consultable", () => {
    setup();
    const created = ok("clepsydre_add_shell_task", { name: "h", command: "echo h" });
    const id = String((created.task as Json).id);
    const empty = ok("clepsydre_get_task_results", { id });
    assert.equal(empty.count, 0);
    assert.deepEqual(empty.executions, []);
  });
});

describe("clepsydre_validate_schedule", () => {
  test("prochains declenchements d'une expression cron", () => {
    setup();
    const payload = ok("clepsydre_validate_schedule", { schedule: "*/5 * * * *", count: 3 });
    assert.equal(payload.kind, "cron");
    const runs = payload.nextRuns as string[];
    assert.equal(runs.length, 3);
    const stamps = runs.map((run) => Date.parse(run));
    assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
    assert.equal(stamps[1] - stamps[0], 5 * 60_000);
  });

  test("intervalle et one-shot", () => {
    setup();
    const interval = ok("clepsydre_validate_schedule", { schedule: "every 30s", count: 2 });
    assert.equal(interval.kind, "interval");
    const once = ok("clepsydre_validate_schedule", { schedule: "2026-10-05T09:00:00Z", count: 5 });
    assert.equal(once.kind, "once");
    assert.equal((once.nextRuns as string[]).length, 1);
  });

  test("expression invalide : isError exploitable", () => {
    setup();
    assert.match(ko("clepsydre_validate_schedule", { schedule: "99 * * * *" }), /minute : 99/);
  });
});

describe("outil inconnu", () => {
  test("isError, pas erreur de protocole", () => {
    setup();
    assert.match(ko("clepsydre_nope"), /outil inconnu/);
  });
});
