import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { openDb } from "../src/db.ts";
import { projectKey } from "../src/evidence.ts";
import { addTodos, closeStepsFor, closeTask, completeTodo, createTask } from "../src/ledger.ts";
import { mergeConfig } from "../src/spec.ts";

/**
 * NX-45 / NX-46 : l'audit et la convergence peuvent être exigés à la clôture.
 * Faux par défaut : la roadmap de la catégorie reste la seule contrainte.
 */

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function base(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-close-policy-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

test("par défaut, la liste des étapes est celle de la roadmap", () => {
  assert.deepEqual(closeStepsFor(["plan", "implement"]), ["plan", "implement"]);
  assert.deepEqual(closeStepsFor(["plan"], { requireAudit: false, requireConverge: false }), ["plan"]);
});

test("requireAudit ajoute l'étape audit", () => {
  assert.deepEqual(closeStepsFor(["plan"], { requireAudit: true }), ["plan", "audit"]);
});

test("requireConverge ajoute l'étape converge", () => {
  assert.deepEqual(closeStepsFor(["plan"], { requireConverge: true }), ["plan", "converge"]);
});

test("aucun doublon quand l'étape est déjà dans la roadmap", () => {
  assert.deepEqual(closeStepsFor(["plan", "audit", "converge"], { requireAudit: true, requireConverge: true }), [
    "plan",
    "audit",
    "converge",
  ]);
});

test("la configuration par défaut laisse les deux drapeaux à faux", () => {
  const config = mergeConfig(null);
  assert.equal(config.ledger.close.requireAudit, false);
  assert.equal(config.ledger.close.requireConverge, false);
});

test("la configuration lue active les drapeaux", () => {
  const config = mergeConfig({ ledger: { close: { requireAudit: true, requireConverge: true } } } as never);
  assert.equal(config.ledger.close.requireAudit, true);
  assert.equal(config.ledger.close.requireConverge, true);
});

test("une clôture exige l'audit quand la politique l'impose", () => {
  const db = base();
  const projectRoot = "C:/tmp/projet-audit";
  const task = createTask(db, { title: "audit", category: "code", projectRoot });
  const [todo] = addTodos(db, task.id, [{ label: "lire", kind: "read" }]);
  completeTodo(db, todo.id, "");

  const scope = `project:${projectKey(projectRoot)}`;
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)",
  ).run(scope, new Date().toISOString());

  const steps = closeStepsFor(["audit"], { requireAudit: true });

  assert.throws(
    () => closeTask(db, task.id, "fait", { steps, scopes: [scope] }),
    /roadmap step\(s\) not recorded[\s\S]*audit/,
  );

  db.prepare(
    "INSERT INTO roadmap_progress (session_id, step_id, status, updated_at) VALUES (?, 'audit', 'done', ?)",
  ).run(scope, new Date().toISOString());

  const ferme = closeTask(db, task.id, "fait", { steps, scopes: [scope] });
  assert.equal(ferme.status, "done");
  db.close();
});
