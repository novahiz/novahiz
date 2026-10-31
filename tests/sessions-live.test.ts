import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import { projectKey } from "../src/evidence.ts";
import { createTask } from "../src/ledger.ts";
import { activeSessionsOnProject, defaultSessionForProject, isProjectRoot, projectRootForPath, recordProjectSession, worktreeHint } from "../src/sessions.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function fresh(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-sessions-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

function evidence(db: ReturnType<typeof openDb>, session: string, projectRoot: string, at: string): void {
  db.prepare(
    `INSERT INTO evidence (id, session_id, project_root, name, command, exit_code, ok, output_tail, hash, duration_ms, created_at)
     VALUES (?, ?, ?, 'tests', 'npm test', 0, 1, '', 'h', 0, ?)`,
  ).run(`ev_${session}_${at.replace(/\D/g, "")}`, session, projectKey(projectRoot), at);
}

const now = () => new Date().toISOString();
const longAgo = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

describe("sessions: une autre session active sur le projet est signalee", () => {
  test("une session recente sur le meme projet est detectee, la session appelante exclue", () => {
    const db = fresh();
    const project = "C:/tmp/projet-partage";
    createTask(db, { title: "a", sessionId: "ses_a", projectRoot: project });
    createTask(db, { title: "b", sessionId: "ses_b", projectRoot: project });

    const seen = activeSessionsOnProject(db, { projectRoot: project, excludeSession: "ses_a" });
    db.close();

    assert.deepEqual(seen.map((entry) => entry.session), ["ses_b"]);
    assert.ok(seen[0].sources.includes("task"));
  });

  test("une trace ancienne ne compte pas", () => {
    const db = fresh();
    const project = "C:/tmp/projet-ancien";
    evidence(db, "ses_old", project, longAgo());

    const seen = activeSessionsOnProject(db, { projectRoot: project, windowMinutes: 90 });
    db.close();
    assert.deepEqual(seen, []);
  });

  test("les traces d'un autre projet ne comptent pas", () => {
    const db = fresh();
    evidence(db, "ses_ailleurs", "C:/tmp/autre-projet", now());
    const seen = activeSessionsOnProject(db, { projectRoot: "C:/tmp/ici" });
    db.close();
    assert.deepEqual(seen, []);
  });

  test("plusieurs sources pour une meme session sont regroupees", () => {
    const db = fresh();
    const project = "C:/tmp/projet-multi";
    createTask(db, { title: "a", sessionId: "ses_m", projectRoot: project });
    evidence(db, "ses_m", project, now());
    const seen = activeSessionsOnProject(db, { projectRoot: project });
    db.close();

    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].sources, ["evidence", "task"]);
  });

  test("la suggestion de worktree nomme la session et propose le claim", () => {
    const hint = worktreeHint(
      [{ session: "ses_autre", lastActivity: now(), sources: ["task"] }],
      "ses_moi",
    );
    assert.ok(hint);
    assert.ok(hint!.includes("ses_autre"));
    assert.ok(hint!.includes("novahiz_claim"));
    assert.ok(hint!.includes("worktree_create"));
    assert.equal(worktreeHint([], "ses_moi"), null);
  });

  test(
    "le chemin du projet est compare sans tenir compte de la casse Windows",
    // Le pliage de casse des chemins n'a de sens que la ou le systeme de
    // fichiers est insensible a la casse. Mesure sur la CI Linux : la meme
    // assertion y comparait deux chemins reellement differents.
    { skip: process.platform === "win32" ? false : "casse insensible seulement sur Windows" },
    () => {
      const db = fresh();
      const project = resolve("C:/tmp/Projet-Casse");
      evidence(db, "ses_case", project, now());
      const seen = activeSessionsOnProject(db, { projectRoot: project.toUpperCase() });
      db.close();
      assert.equal(seen.length, 1);
    },
  );

  test("une session vue par le gate est detectee meme sans tâche ni claim", () => {
    const db = fresh();
    const project = "C:/tmp/projet-gate";
    recordProjectSession(db, project, "ses_gate");
    const seen = activeSessionsOnProject(db, { projectRoot: project });
    db.close();
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].sources, ["gate"]);
  });
});

describe("session par defaut: le gate voit ce que les tools ne voient pas", () => {
  test("une seule session recente est resolue", () => {
    const db = fresh();
    const project = "C:/tmp/projet-defaut";
    recordProjectSession(db, project, "ses_unique");
    const resolved = defaultSessionForProject(db, { projectRoot: project });
    db.close();
    assert.equal(resolved.session, "ses_unique");
    assert.deepEqual(resolved.candidates, ["ses_unique"]);
  });

  test("deux sessions vivantes: aucune resolution, les candidates sont listees", () => {
    const db = fresh();
    const project = "C:/tmp/projet-ambigu";
    recordProjectSession(db, project, "ses_a");
    recordProjectSession(db, project, "ses_b");
    const resolved = defaultSessionForProject(db, { projectRoot: project });
    db.close();
    assert.equal(resolved.session, null);
    assert.equal(resolved.candidates.length, 2);
  });

  test("une session hors fenetre n'est pas resolue", () => {
    const db = fresh();
    const project = "C:/tmp/projet-vieux";
    recordProjectSession(db, project, "ses_vieux", longAgo());
    const resolved = defaultSessionForProject(db, { projectRoot: project, windowMinutes: 15 });
    db.close();
    assert.equal(resolved.session, null);
    assert.deepEqual(resolved.candidates, []);
  });
});

describe("sessions: le projet vient du fichier, pas du cwd du daemon", () => {
  function tree(): string {
    const root = mkdtempSync(join(tmpdir(), "novahiz-root-"));
    made.push(root);
    mkdirSync(join(root, "projet", "src", "deep"), { recursive: true });
    writeFileSync(join(root, "projet", "package.json"), "{}", "utf8");
    return root;
  }

  test("un fichier sous un package.json remonte jusqu'au projet", () => {
    const root = tree();
    const file = join(root, "projet", "src", "deep", "gate.ts");
    assert.equal(projectRootForPath(file), join(root, "projet"));
  });

  test("un fichier de documentation remonte aussi, meme s'il n'existe pas encore", () => {
    const root = tree();
    const file = join(root, "projet", "docs", "nouveau.md");
    assert.equal(projectRootForPath(file), join(root, "projet"));
  });

  test("sans marqueur de projet, le dossier du fichier fait foi", () => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-root-"));
    made.push(root);
    mkdirSync(join(root, "isole"), { recursive: true });
    const file = join(root, "isole", "note.md");
    assert.equal(projectRootForPath(file), join(root, "isole"));
  });

  test("deux projets voisins ne partagent pas la meme cle", () => {
    const root = tree();
    mkdirSync(join(root, "autre"), { recursive: true });
    writeFileSync(join(root, "autre", "package.json"), "{}", "utf8");
    const a = projectRootForPath(join(root, "projet", "src", "gate.ts"));
    const b = projectRootForPath(join(root, "autre", "index.ts"));
    assert.notEqual(a, b);
  });

  test("un dossier sans marqueur de projet n'est pas un projet", () => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-root-"));
    made.push(root);
    mkdirSync(join(root, "quelque-part", "sous-dossier"), { recursive: true });
    assert.equal(isProjectRoot(join(root, "quelque-part", "sous-dossier")), false);
    assert.equal(isProjectRoot(join(root, "quelque-part", "sous-dossier", "package.json")), false);
  });

  test("un appel sans chemin n'attache rien quand le cwd n'est pas un projet", () => {
    // The daemon's cwd is where opencode started — the user home, which is not a
    // project. Recording it produced `c:\users\tawhid`, a key every project under
    // the home could collide with.
    const home = mkdtempSync(join(tmpdir(), "novahiz-root-"));
    made.push(home);
    mkdirSync(join(home, "Documents", "un-projet"), { recursive: true });
    assert.equal(isProjectRoot(home), false);
  });
});
