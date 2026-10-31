import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import { projectKey } from "../src/evidence.ts";
import { addTodos, closeTask, completeTodo, createTask, getTask } from "../src/ledger.ts";
import { loadSpec } from "../src/spec.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function fresh(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-roadmap-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

function requiredSteps(categoryId: string): string[] {
  const category = spec.categories.find((entry) => entry.id === categoryId);
  assert.ok(category?.roadmap, `roadmap manquante pour ${categoryId}`);
  return category!.roadmap!.steps
    .filter((step) => step.optional !== true && (step.requireSkills ?? []).length > 0)
    .map((step) => step.id);
}

function recordStep(db: ReturnType<typeof openDb>, scope: string, stepId: string): void {
  db.prepare("INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(
    scope,
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT INTO roadmap_progress (session_id, step_id, status, updated_at) VALUES (?, ?, 'done', ?) ON CONFLICT(session_id, step_id) DO UPDATE SET status='done'",
  ).run(scope, stepId, new Date().toISOString());
}

describe("close: les etapes de roadmap ne sont plus decoratives", () => {
  test("une tache sans categorie se ferme sans controle de roadmap", () => {
    const db = fresh();
    const task = createTask(db, { title: "libre" });
    const [todo] = addTodos(db, task.id, [{ label: "lire", kind: "read" }]);
    completeTodo(db, todo.id, "");
    const closed = closeTask(db, task.id, "fait");
    db.close();
    assert.equal(closed.status, "done");
  });

  test("une tache categorisee refuse de fermer si une etape obligatoire manque", () => {
    const db = fresh();
    const projectRoot = "C:/tmp/projet-a";
    const task = createTask(db, { title: "code", category: "code", projectRoot });
    const [todo] = addTodos(db, task.id, [{ label: "lire", kind: "read" }]);
    completeTodo(db, todo.id, "");

    const steps = requiredSteps("code");
    const scopes = [`project:${projectKey(projectRoot)}`];
    assert.throws(
      () => closeTask(db, task.id, "fait", { steps, scopes }),
      (error: Error) => {
        assert.match(error.message, /roadmap step\(s\) not recorded/);
        for (const step of steps) assert.ok(error.message.includes(step), `étape manquante non listée: ${step}`);
        return true;
      },
    );
    assert.equal(getTask(db, task.id)?.status, "active");
    db.close();
  });

  test("toutes les etapes enregistrees, la fermeture passe", () => {
    const db = fresh();
    const projectRoot = "C:/tmp/projet-b";
    const task = createTask(db, { title: "code", category: "code", projectRoot });
    const [todo] = addTodos(db, task.id, [{ label: "lire", kind: "read" }]);
    completeTodo(db, todo.id, "");

    const scope = `project:${projectKey(projectRoot)}`;
    const steps = requiredSteps("code");
    for (const step of steps) recordStep(db, scope, step);

    const closed = closeTask(db, task.id, "fait", { steps, scopes: [scope] });
    db.close();
    assert.equal(closed.status, "done");
    assert.equal(closed.closing_proof, "fait");
  });

  test("une etape droppee avec une raison ne bloque plus la fermeture", () => {
    const db = fresh();
    const projectRoot = "C:/tmp/projet-drop";
    const task = createTask(db, { title: "code", category: "code", projectRoot });
    const [todo] = addTodos(db, task.id, [{ label: "lire", kind: "read" }]);
    completeTodo(db, todo.id, "");

    const scope = `project:${projectKey(projectRoot)}`;
    const steps = requiredSteps("code");
    const dropped = steps[0];
    db.prepare(
      "INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)",
    ).run(scope, new Date().toISOString());
    db.prepare(
      "INSERT INTO roadmap_progress (session_id, step_id, status, updated_at) VALUES (?, ?, 'dropped', ?)",
    ).run(scope, dropped, new Date().toISOString());
    for (const step of steps.slice(1)) recordStep(db, scope, step);

    const closed = closeTask(db, task.id, "fait", { steps, scopes: [scope] });
    db.close();
    assert.equal(closed.status, "done");
  });

  test("une etape enregistree sous une autre portee ne compte pas", () => {
    const db = fresh();
    const projectRoot = "C:/tmp/projet-c";
    const task = createTask(db, { title: "code", category: "code", projectRoot });
    const [todo] = addTodos(db, task.id, [{ label: "lire", kind: "read" }]);
    completeTodo(db, todo.id, "");

    const steps = requiredSteps("code");
    for (const step of steps) recordStep(db, "projet-voisin", step);
    assert.throws(
      () => closeTask(db, task.id, "fait", { steps, scopes: [`project:${projectKey(projectRoot)}`] }),
      /roadmap step\(s\) not recorded/,
    );
    db.close();
  });

  test("la categorie est bien conservee sur la tache", () => {
    const db = fresh();
    const task = createTask(db, { title: "design", category: "design-ui" });
    assert.equal(getTask(db, task.id)?.category, "design-ui");
    db.close();
  });
});
