// Suite de tests du store de snapshots maison (src/snap.ts).
// Chaque test isole NOVAHIZ_HOME dans un répertoire temporaire : le store réel
// de l'utilisateur n'est jamais touché.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  capture,
  diffSnapshots,
  exportSnapshot,
  listSnapshots,
  loadManifest,
  matchingIds,
  prune,
  readCatalog,
  restoreSnapshot,
  snapRoot,
  snapStatus,
  verifySnapshot
} from "../src/snap.ts";
import type { SnapManifest } from "../src/snap.ts";
import { openDb } from "../src/db.ts";
import { addTodos, completeTodo, createTask, insertTodo, pruneSessions, recordTodoDone } from "../src/ledger.ts";

const SCHEMA = `
  CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT);
  CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label TEXT
  );
`;

describe("snap.ts — store content-addressed du ledger", () => {
  let home = "";
  let previousHome: string | undefined;
  const open: DatabaseSync[] = [];

  const makeLedger = (): DatabaseSync => {
    const db = new DatabaseSync(join(home, "novahiz.sqlite"));
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    open.push(db);
    return db;
  };

  const addTask = (db: DatabaseSync, id: string, title = "tâche", status = "open"): void => {
    db.prepare("INSERT INTO tasks (id, title, status) VALUES (?, ?, ?)").run(id, title, status);
  };

  const addTodo = (db: DatabaseSync, id: string, taskId: string, label = "étape"): void => {
    db.prepare("INSERT INTO todos (id, task_id, label) VALUES (?, ?, ?)").run(id, taskId, label);
  };

  const count = (db: DatabaseSync, table: string): number =>
    (db.prepare(`SELECT count(*) AS c FROM "${table}"`).get() as { c: number }).c;

  const columns = (db: DatabaseSync, table: string): string[] =>
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((row) => row.name);

  const objectFiles = (): string[] => {
    const root = join(snapRoot(), "objects");
    if (!existsSync(root)) return [];
    const files: string[] = [];
    for (const prefix of readdirSync(root, { withFileTypes: true })) {
      if (!prefix.isDirectory()) continue;
      for (const file of readdirSync(join(root, prefix.name))) files.push(file);
    }
    return files;
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "novahiz-snaptest-"));
    previousHome = process.env.NOVAHIZ_HOME;
    process.env.NOVAHIZ_HOME = home;
  });

  afterEach(() => {
    for (const db of open.splice(0)) {
      try {
        db.close();
      } catch {
        // déjà fermée
      }
    }
    if (previousHome === undefined) delete process.env.NOVAHIZ_HOME;
    else process.env.NOVAHIZ_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  // ── capture ──────────────────────────────────────────────────────────────

  describe("capture", () => {
    test("écrit un manifest et un objet gzip dédupliqué, et pointe le catalogue", () => {
      const db = makeLedger();
      addTask(db, "t1");

      const shot = capture(db, "test-capture", "création t1");
      assert.ok(shot, "capture doit renvoyer un résultat");
      assert.match(shot.id, /^[a-f0-9]{12}$/);
      assert.equal(shot.sourceBytes > 0, true);

      const manifestPath = join(snapRoot(), "snapshots", `${shot.id}.json`);
      assert.equal(existsSync(manifestPath), true, "le manifest doit exister");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SnapManifest;
      assert.equal(manifest.format, "novahiz-snap-1");
      assert.equal(manifest.id, shot.id);
      assert.equal(manifest.parent, null, "premier snapshot sans parent");
      assert.equal(manifest.operation, "test-capture");
      assert.equal(manifest.detail, "création t1");
      assert.equal(manifest.object, shot.object);

      const objectPath = join(snapRoot(), "objects", shot.object.slice(0, 2), `${shot.object}.db.gz`);
      assert.equal(existsSync(objectPath), true, "l'objet gzip doit exister");
      assert.equal(readCatalog().latest, shot.id);
      assert.equal(listSnapshots().length, 1);
    });

    test("sans changement de ledger, retourne null et n'écrit rien", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const first = capture(db, "test-capture");
      assert.ok(first);

      assert.equal(capture(db, "test-capture-2"), null, "aucun changement = aucun snapshot");
      const status = snapStatus();
      assert.equal(status.count, 1, "toujours un seul snapshot");
      assert.equal(status.latest?.id, first.id);
    });

    test("chaîne le parent quand le ledger change", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const first = capture(db, "test-capture");
      assert.ok(first);

      addTask(db, "t2");
      const second = capture(db, "test-capture", "ajout t2");
      assert.ok(second);
      assert.notEqual(second.id, first.id);
      assert.equal(loadManifest(second.id)?.parent, first.id, "le second pointe le premier");
      assert.equal(snapStatus().count, 2);
      assert.equal(readCatalog().latest, second.id);
    });

    test("ne laisse aucun fichier temporaire derrière lui", () => {
      const db = makeLedger();
      addTask(db, "t1");
      capture(db, "test-capture");
      addTask(db, "t2");
      capture(db, "test-capture");

      const leftovers = readdirSync(snapRoot()).filter((file) => /^(?:capture|read)-/.test(file));
      assert.deepEqual(leftovers, [], "aucun temp de capture ne doit survivre");
    });

    test("une capture impossible renvoie null au lieu de lever", () => {
      const db = makeLedger();
      addTask(db, "t1");
      db.close();
      // La connexion fermée fait échouer VACUUM INTO : le contrat est "ne casse
      // jamais l'opération ledger qui a déclenché la capture".
      assert.equal(capture(db, "test-capture"), null);
    });
  });

  // ── rétention ────────────────────────────────────────────────────────────

  describe("rétention et collecte", () => {
    test("plafonne à 50 snapshots et collecte les objets orphelins", () => {
      const db = makeLedger();
      for (let i = 0; i < 60; i += 1) {
        addTask(db, `t${i}`);
        assert.ok(capture(db, "test-capture", `t${i}`), `capture ${i} doit réussir`);
      }

      const catalog = readCatalog();
      assert.equal(catalog.snapshots.length, 50, "rétention 50");
      assert.equal(listSnapshots().length, 50);
      assert.equal(objectFiles().length, 50, "les 10 objets orphelins sont collectés");
      assert.equal(catalog.snapshots[0], catalog.latest, "le plus récent en tête");
      // le manifeste le plus ancien a bien été supprimé du disque
      assert.equal(existsSync(join(snapRoot(), "snapshots", `${catalog.snapshots[49]}.json`)), true);
    });

    test("le plancher retient au minimum `floor` snapshots même si keep est plus bas", () => {
      const db = makeLedger();
      for (let i = 0; i < 6; i += 1) {
        addTask(db, `t${i}`);
        capture(db, "test-capture");
      }
      const catalog = readCatalog();
      catalog.retention = { keep: 1, floor: 3 };
      writeFileSync(join(snapRoot(), "catalog.json"), JSON.stringify(catalog), "utf-8");

      addTask(db, "dernier");
      capture(db, "test-capture");

      const after = readCatalog();
      assert.equal(after.snapshots.length, 3, "le plancher de 3 l'emporte sur keep=1");
      assert.equal(after.retention.keep, 1, "la politique demandée est conservée");
    });

    test("prune ne supprime jamais le snapshot le plus récent", () => {
      const db = makeLedger();
      addTask(db, "t1");
      capture(db, "test-capture");
      const before = readCatalog().latest;
      const result = prune();
      assert.equal(result.removed, 0);
      assert.equal(readCatalog().latest, before);
      assert.equal(snapStatus().count, 1);
    });
  });

  // ── vérification ─────────────────────────────────────────────────────────

  describe("verifySnapshot", () => {
    test("valide le hash de l'objet et integrity_check = ok", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      const result = verifySnapshot(shot.id);
      assert.equal(result.success, true, result.message);
      assert.match(result.message, /integrity_check = ok/);
    });

    test("détecte un objet corrompu", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      const objectPath = join(snapRoot(), "objects", shot.object.slice(0, 2), `${shot.object}.db.gz`);
      writeFileSync(objectPath, "ceci n'est pas du gzip");

      const result = verifySnapshot(shot.id);
      assert.equal(result.success, false, "un objet corrompu doit être refusé");
    });

    test("signale un snapshot inexistant", () => {
      assert.equal(verifySnapshot("ffffffffffff").success, false);
      assert.equal(verifySnapshot("pas-un-id").success, false);
    });
  });

  // ── diff ─────────────────────────────────────────────────────────────────

  describe("diffSnapshots", () => {
    test("montre les lignes ajoutées entre deux snapshots", () => {
      const db = makeLedger();
      addTask(db, "t1", "première");
      const before = capture(db, "test-capture");
      assert.ok(before);

      addTask(db, "t2", "seconde");
      const after = capture(db, "test-capture");
      assert.ok(after);

      const diff = diffSnapshots(before.id, after.id);
      assert.equal(diff.changedTables, 1, "seule la table tasks change");
      assert.equal(diff.tables.length, 1);
      assert.equal(diff.tables[0].table, "tasks");
      assert.equal(diff.tables[0].status, "changed");
      assert.equal(diff.tables[0].rowsBefore, 1);
      assert.equal(diff.tables[0].rowsAfter, 2);
      assert.equal(diff.tables[0].rows.length, 1);
      assert.equal(diff.tables[0].rows[0].before, null, "ligne ajoutée : pas d'avant");
      assert.equal((diff.tables[0].rows[0].after as { id: string }).id, "t2");
      assert.equal(diff.truncated, false);
    });

    test("détecte une modification de ligne, pas seulement un ajout", () => {
      const db = makeLedger();
      addTask(db, "t1", "avant");
      const before = capture(db, "test-capture");
      assert.ok(before);

      db.prepare("UPDATE tasks SET status = 'done' WHERE id = 't1'").run();
      const after = capture(db, "test-capture");
      assert.ok(after);

      const diff = diffSnapshots(before.id, after.id);
      assert.equal(diff.changedTables, 1);
      const row = diff.tables[0].rows[0];
      assert.equal((row.before as { status: string }).status, "open");
      assert.equal((row.after as { status: string }).status, "done");
    });

    test("un ledger identique donne un diff vide", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      const diff = diffSnapshots(shot.id, shot.id);
      assert.equal(diff.changedTables, 0);
      assert.deepEqual(diff.tables, []);
    });

    test("compare un snapshot au ledger courant", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      addTask(db, "t2");
      addTask(db, "t3");

      const diff = diffSnapshots(shot.id, null, join(home, "novahiz.sqlite"));
      assert.equal(diff.to, "courant");
      assert.equal(diff.changedTables, 1);
      assert.equal(diff.tables[0].rowsAfter, 3);
      assert.equal(diff.tables[0].rowsBefore, 1);
    });

    test("signale un snapshot inconnu", () => {
      assert.throws(() => diffSnapshots("ffffffffffff", null), /introuvable/);
    });
  });

  // ── restore ──────────────────────────────────────────────────────────────

  describe("restoreSnapshot", () => {
    test("refuse sans --force et laisse le ledger intact", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      addTask(db, "t2");
      const result = restoreSnapshot(db, shot.id);
      assert.equal(result.success, false);
      assert.match(result.message, /--force/);
      assert.equal(count(db, "tasks"), 2, "le ledger n'a pas bougé");
      assert.equal(readdirSync(join(snapRoot(), "backups")).length, 0, "pas de sauvegarde inutile");
    });

    test("restaure l'état, écrit une sauvegarde et garde la connexion utilisable", () => {
      const db = makeLedger();
      addTask(db, "t1");
      addTodo(db, "d1", "t1");
      const good = capture(db, "test-capture");
      assert.ok(good);

      for (let i = 2; i <= 6; i += 1) {
        addTask(db, `t${i}`);
        addTodo(db, `d${i}`, `t${i}`);
      }
      assert.equal(count(db, "tasks"), 6);

      const result = restoreSnapshot(db, good.id, { force: true });
      assert.equal(result.success, true, result.message);
      assert.equal(count(db, "tasks"), 1, "retour à l'état du snapshot");
      assert.equal(count(db, "todos"), 1);

      const check = (db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>);
      assert.equal(Object.values(check)[0], "ok");

      const backups = readdirSync(join(snapRoot(), "backups"));
      assert.equal(backups.length, 1, "une copie de sécurité avant écrasement");

      // la connexion reste utilisable après la restauration transactionnelle
      addTask(db, "t-apres");
      assert.equal(count(db, "tasks"), 2);
    });

    test("respecte les clés étrangères pendant la restauration", () => {
      const db = makeLedger();
      addTask(db, "t1");
      addTodo(db, "d1", "t1");
      const good = capture(db, "test-capture");
      assert.ok(good);

      // state cible : un todo orphelin serait une violation
      addTask(db, "t2");
      addTodo(db, "d2", "t2");
      db.exec("DELETE FROM tasks WHERE id = 't1'"); // cascade supprime d1
      assert.equal(count(db, "todos"), 1);

      const result = restoreSnapshot(db, good.id, { force: true });
      assert.equal(result.success, true, result.message);
      assert.equal(count(db, "tasks"), 1);
      assert.equal(count(db, "todos"), 1);
      assert.equal(
        (db.prepare("SELECT count(*) AS c FROM todos WHERE task_id NOT IN (SELECT id FROM tasks)").get() as { c: number }).c,
        0,
        "aucun todo orphelin après restauration"
      );
    });

    test("recrée une colonne que le ledger principal n'a plus", () => {
      const db = makeLedger();
      addTask(db, "t1");
      db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT");
      db.prepare("UPDATE tasks SET priority = 'haute' WHERE id = 't1'").run();
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      // simule un ledger redescendu à un schéma antérieur
      db.exec("ALTER TABLE tasks DROP COLUMN priority");
      assert.equal(columns(db, "tasks").includes("priority"), false);

      const result = restoreSnapshot(db, shot.id, { force: true });
      assert.equal(result.success, true, result.message);
      assert.equal(columns(db, "tasks").includes("priority"), true, "colonne recréée par ALTER");
      const row = db.prepare("SELECT priority FROM tasks WHERE id = 't1'").get() as { priority: string };
      assert.equal(row.priority, "haute", "donnée restaurée avec la colonne");
    });

    test("laisse telles quelles les colonnes que le snapshot ignore", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      db.exec("ALTER TABLE tasks ADD COLUMN note TEXT");
      db.prepare("UPDATE tasks SET note = 'ajouté après' WHERE id = 't1'").run();

      const result = restoreSnapshot(db, shot.id, { force: true });
      assert.equal(result.success, true, result.message);
      assert.equal(columns(db, "tasks").includes("note"), true, "colonne conservée");
      // les lignes sont remplacées par celles du snapshot : la colonne reste, sa valeur suit le snapshot
      const row = db.prepare("SELECT note FROM tasks WHERE id = 't1'").get() as { note: string | null };
      assert.equal(row.note, null);
    });

    test("signale un snapshot inconnu", () => {
      const db = makeLedger();
      const result = restoreSnapshot(db, "ffffffffffff", { force: true });
      assert.equal(result.success, false);
      assert.match(result.message, /introuvable/);
    });
  });

  // ── export ───────────────────────────────────────────────────────────────

  describe("exportSnapshot", () => {
    test("écrit une base autonome lisible dans le workspace", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      const target = join(home, "export.db");
      const result = exportSnapshot(shot.id, target);
      assert.equal(result.success, true, result.message);
      assert.equal(existsSync(target), true);

      const exported = new DatabaseSync(target, { readOnly: true });
      try {
        const row = exported.prepare("SELECT count(*) AS c FROM tasks").get() as { c: number };
        assert.equal(row.c, 1);
      } finally {
        exported.close();
      }
    });

    test("refuse un chemin hors workspace", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      const result = exportSnapshot(shot.id, join(tmpdir(), "novahiz-snap-escape.db"));
      assert.equal(result.success, false);
      assert.match(result.message, /hors workspace/);
      assert.equal(existsSync(join(tmpdir(), "novahiz-snap-escape.db")), false);
    });

    test("refuse d'écraser sans --force", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const shot = capture(db, "test-capture");
      assert.ok(shot);

      const target = join(home, "export.db");
      assert.equal(exportSnapshot(shot.id, target).success, true);
      const again = exportSnapshot(shot.id, target);
      assert.equal(again.success, false);
      assert.match(again.message, /--force/);
      assert.equal(exportSnapshot(shot.id, target, { force: true }).success, true);
    });
  });

  // ── status ───────────────────────────────────────────────────────────────

  describe("snapStatus", () => {
    test("rapporte un store vierge puis peuplé", () => {
      const empty = snapStatus();
      assert.equal(empty.initialized, false);
      assert.equal(empty.count, 0);
      assert.equal(empty.latest, null);
      assert.equal(empty.retention.keep, 50);
      assert.equal(empty.retention.floor, 10);

      const db = makeLedger();
      addTask(db, "t1");
      capture(db, "test-capture");

      const full = snapStatus();
      assert.equal(full.initialized, true);
      assert.equal(full.count, 1);
      assert.ok(full.bytes > 0, "les objets occupent de la place");
      assert.equal(full.latest?.operation, "test-capture");
      assert.match(full.root, /\.snap$/);
    });
  });

  // ── captures différées (transaction ouverte) ─────────────────────────────

  describe("captures refusées en transaction", () => {
    test("un capture pendant un savepoint est différé, visible, puis résolu", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const initial = capture(db, "test-capture");
      assert.ok(initial);

      db.exec("SAVEPOINT done_sp");
      addTask(db, "t2");
      assert.equal(capture(db, "test-capture", "dans savepoint"), null, "refusé en transaction");
      db.exec("RELEASE done_sp");

      const shot = capture(db, "test-capture", "après release");
      assert.ok(shot, "la capture hors transaction doit réussir");
      assert.equal(snapStatus().deferred, 0, "le report est résolu par la capture suivante");

      const diff = diffSnapshots(initial.id, shot.id);
      assert.equal(diff.changedTables, 1, "le changement différé est bien enregistré");
      assert.equal(diff.tables[0].rowsAfter, 2);
    });

    test("un savepoint annulé ne laisse pas de report bloqué", () => {
      const db = makeLedger();
      addTask(db, "t1");
      assert.ok(capture(db, "test-capture"));

      db.exec("SAVEPOINT sp");
      addTask(db, "t2");
      assert.equal(capture(db, "test-capture"), null);
      db.exec("ROLLBACK TO sp");
      db.exec("RELEASE sp");

      // la capture suivante voit un ledger inchangé : le report se résout
      // sans produire de snapshot fictif
      const count = snapStatus().count;
      assert.equal(capture(db, "test-capture"), null);
      assert.equal(snapStatus().count, count, "pas de snapshot fantôme");
      assert.equal(snapStatus().deferred, 0);
    });
  });

  // ── intégration : flux réel du ledger ────────────────────────────────────

  describe("intégration ledger réel", () => {
    test("le flux MCP action=done produit un snapshot du todo complété", () => {
      // openDb crée le schéma réel et capture lui-même à l'ouverture
      const db = openDb(join(home, "ledger.db"));
      open.push(db);
      assert.ok(snapStatus().count >= 1, "openDb capture à l'ouverture");

      const task = createTask(db, { title: "tâche d'intégration" });
      const [todo] = addTodos(db, task.id, [{ label: "étape 1" }]);
      const afterCreate = snapStatus().count;
      assert.ok(afterCreate >= 2, "createTask et addTodos capturent");

      // reproduction exacte du handler MCP (mcp/novahiz-tools/index.mjs)
      db.exec("SAVEPOINT done_sp");
      completeTodo(db, todo.id, "preuve : test");
      recordTodoDone(db, task.id);
      db.exec("RELEASE done_sp");
      capture(db, "todo-completed", todo.id);

      const status = snapStatus();
      assert.equal(status.deferred, 0, "aucun report en attente");
      assert.ok(status.count > afterCreate, "un snapshot du todo complété a été pris");

      const latest = status.latest;
      assert.ok(latest);
      assert.equal(latest.operation, "todo-completed");
      const verification = verifySnapshot(latest.id);
      assert.equal(verification.success, true, verification.message);

      // le snapshot courant reflète l'état live : diff vide
      const diff = diffSnapshots(latest.id, null, join(home, "ledger.db"));
      assert.equal(diff.changedTables, 0, "le dernier snapshot == ledger courant");
    });

    test("insertTodo (savepoint imbriqué) produit lui aussi un snapshot", () => {
      const db = openDb(join(home, "ledger.db"));
      open.push(db);
      const task = createTask(db, { title: "insert" });
      const before = snapStatus().count;

      insertTodo(db, task.id, { label: "insérée" }, "start");

      const status = snapStatus();
      assert.ok(status.count > before, "insertTodo capture après RELEASE");
      assert.equal(status.deferred, 0);
      assert.equal(status.latest?.operation, "todos-added");
    });
  });

  // ── WAL non checkpointé : la règle -wal/-shm ──────────────────────────────
  // restore réécrit les lignes dans la connexion ouverte : il ne remplace
  // jamais le fichier, donc ni le -wal ni le -shm en cours n'ont à être
  // remplacés (ce qu'un swap de fichier ne pourrait pas faire sous Windows).

  describe("WAL non checkpointé (règle -wal/-shm)", () => {
    test("la capture lit à travers le WAL et restore opère avec les sidecars vivants", () => {
      const db = makeLedger();
      addTask(db, "wal-1", "écrit avant tout checkpoint");
      const walPath = join(home, "novahiz.sqlite-wal");
      assert.ok(existsSync(walPath), "les écritures vivent encore dans le -wal");

      const snapshot = capture(db, "wal-test");
      assert.ok(snapshot, "VACUUM INTO voit les lignes du WAL");
      assert.ok(existsSync(walPath), "la capture n'a pas eu besoin de vider le WAL");

      addTask(db, "wal-2", "écrit après le snapshot");
      assert.equal(count(db, "tasks"), 2);

      const restored = restoreSnapshot(db, snapshot.id, { force: true });
      assert.equal(restored.success, true, restored.message);
      assert.equal(count(db, "tasks"), 1, "seul l'état snapshoté est revenu");
      assert.ok(existsSync(join(home, "novahiz.sqlite")), "le fichier principal n'a jamais été remplacé");

      // la même connexion repart immédiatement : ni fichier à rouvrir, ni sidecar orphelin
      addTask(db, "wal-3", "écrit après la restauration");
      assert.equal(count(db, "tasks"), 2);
      const check = db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
      assert.equal(Object.values(check)[0], "ok");
    });
  });

  // ── openDb : ce qu'il capture en ouvrant ──────────────────────────────────

  describe("openDb — capture à l'ouverture", () => {
    test("un ledger neuf reçoit son point de base, une réouverture non", () => {
      const path = join(home, "fresh.sqlite");
      const first = openDb(path);
      open.push(first);
      const opened = snapStatus();
      assert.ok(opened.count >= 1, "le schéma créé est snapshoté");
      assert.equal(opened.latest?.operation, "init");
      const id = opened.latest?.id;

      first.close();
      const second = openDb(path);
      open.push(second);
      assert.equal(snapStatus().count, opened.count, "une réouverture sans changement ne snapshot rien");
      assert.equal(snapStatus().latest?.id, id);
    });

    test("capture:false laisse l'appelant étiqueter son propre snapshot", () => {
      const db = openDb(join(home, "manual.sqlite"), { capture: false });
      open.push(db);
      assert.equal(snapStatus().count, 0, "openDb n'a rien capturé");

      const made = capture(db, "manual", "point de contrôle");
      assert.ok(made);
      assert.equal(snapStatus().latest?.operation, "manual");
      assert.equal(snapStatus().latest?.detail, "point de contrôle");
    });

    test("des sessions expirées sont supprimées et snapshotées sous leur vrai label", () => {
      const path = join(home, "pruning.sqlite");
      const seed = openDb(path, { capture: false });
      open.push(seed);
      const expired = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // TTL = 4 h
      seed
        .prepare("INSERT INTO sessions (id, agent, categories, required_skills, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("ses_expiree", null, "[]", "[]", expired);
      seed.close();
      const before = snapStatus().count;

      const reopened = openDb(path);
      open.push(reopened);
      const after = snapStatus();
      assert.ok(after.count > before, "pruner change le ledger, donc un snapshot est pris");
      assert.equal(after.latest?.operation, "prune-sessions");
      const left = reopened
        .prepare("SELECT count(*) AS c FROM sessions WHERE id = ?")
        .get("ses_expiree") as { c: number };
      assert.equal(left.c, 0, "la session expirée a bien été supprimée");
    });

    test("pruneSessions rend le nombre de lignes supprimées", () => {
      const db = openDb(join(home, "prunecount.sqlite"), { capture: false });
      open.push(db);
      assert.equal(pruneSessions(db), 0, "rien de périmé : 0");

      const expired = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      db.prepare("INSERT INTO sessions (id, agent, categories, required_skills, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("ses_b", null, "[]", "[]", expired);
      assert.ok(pruneSessions(db) >= 1, "au moins la session qu'on vient d'ajouter");
      assert.equal(pruneSessions(db), 0, "second appel : plus rien à supprimer");
    });
  });

  // ── préfixes d'identifiants (toutes les sous-commandes qui prennent un id) ─

  describe("matchingIds", () => {
    test("résout l'id exact et tout préfixe qui ne vise qu'un snapshot", () => {
      const db = makeLedger();
      addTask(db, "t1");
      const made = capture(db, "prefix-test");
      assert.ok(made);

      assert.deepEqual(matchingIds(made.id), [made.id], "l'id exact");
      assert.deepEqual(matchingIds(made.id.slice(0, 8)), [made.id], "8 caractères suffisent");
      assert.deepEqual(matchingIds(made.id.toUpperCase()), [made.id], "insensible à la casse");
    });

    test("un préfixe partagé par plusieurs snapshots les renvoie tous", () => {
      const dir = join(snapRoot(), "snapshots");
      mkdirSync(dir, { recursive: true });
      for (const id of ["abc000000001", "abc000000002", "abc000000003"]) {
        writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id }), "utf8");
      }
      assert.equal(matchingIds("abc00000000").length, 3, "3 candidats : l'appelant doit refuser");
      assert.equal(matchingIds("abc000000001").length, 1);
    });

    test("refuse un préfixe non hexadécimal ou qui ne vise aucun snapshot", () => {
      assert.deepEqual(matchingIds(""), []);
      assert.deepEqual(matchingIds("zz"), []);
      assert.deepEqual(matchingIds("g1c4"), []);
      assert.deepEqual(matchingIds("deadbeefdead"), [], "aucun snapshot à cet endroit");
    });
  });
});
