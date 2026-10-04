// P4: suite de la CLI `novahiz memory status|clean|prune` (src/commands/memory.ts),
// executee reellement en sous-processus: dry-run par defaut prouve par absence
// d'ecriture (fichiers intacts, mtime inchange), --apply qui execute, GC sans
// destruction (archive conservant le fichier, ferraille retiree seulement), et
// codes de sortie erreurs. Le workspace de test est le cwd: la racine par
// defaut (process.cwd()) est couverte implicitement.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeEntry } from "../src/memory.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const DAY_MS = 86_400_000;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let home: string;
let ws: string;
let mem: string;

function memory(args: string[]): Run {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", CLI, "memory", ...args],
    { encoding: "utf8", cwd: ws, env: { ...process.env, NOVAHIZ_HOME: home }, timeout: 60_000 }
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asJson = (run: Run): any => JSON.parse(run.stdout);

const indexPath = (): string => join(mem, "index.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editIndex = (mutate: (index: any) => void): void => {
  const index = JSON.parse(readFileSync(indexPath(), "utf8"));
  mutate(index);
  writeFileSync(indexPath(), JSON.stringify(index, null, 2), "utf8");
};

before(() => {
  home = mkdtempSync(join(tmpdir(), "novahiz-memclih-"));
  ws = mkdtempSync(join(tmpdir(), "novahiz-memcli-"));
  mem = join(ws, "project-memory");
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

describe("novahiz memory status", () => {
  test("memoire absente: rapporte l'absence sans creer le dossier", () => {
    const run = memory(["status", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.exists, false);
    assert.equal(value.index.state, "absent");
    assert.equal(existsSync(mem), false, "status ne doit rien ecrire");
  });

  test("memoire seedee: etat sain, compte exact, root resolu", () => {
    writeEntry({ root: mem, title: "note seed initiale", content: "corps de la note seed pour la CLI P4" });
    // Deuxieme slot adopte par reindexation: copie frontmatter idem autre id.
    const names = readdirSync(join(mem, "slots")).filter((name) => name.endsWith(".md"));
    assert.equal(names.length, 1);
    const raw = readFileSync(join(mem, "slots", names[0]), "utf8");
    writeFileSync(join(mem, "slots", "slot-002-copie.md"), raw.replace(/slot-001/g, "slot-002"), "utf8");

    const run = memory(["status", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.root, mem);
    assert.equal(value.exists, true);
    assert.equal(value.index.state, "sain");
    assert.equal(value.disk.files, 2, "deux .md sur disque");
    assert.equal(value.slots.total, 1, "l'index n'a pas encore adopte l'orphelin");
    assert.deepEqual(value.disk.orphans.length, 1, "l'orphelin est signale");
    assert.ok(value.disk.orphans[0].includes("slot-002"), "orphelin = slot-002");
  });

  test("status est strictement en lecture: mtime de l'index inchange", () => {
    const before = statSync(indexPath()).mtimeMs;
    const run = memory(["status", "--json"]);
    assert.equal(run.status, 0);
    const after = statSync(indexPath()).mtimeMs;
    assert.equal(after, before, "aucune ecriture cachee");
  });
});

describe("novahiz memory clean (dry-run par defaut)", () => {
  test("planifie verrou periime + failed-*.json + reindexation sans rien toucher", () => {
    // Ferraille: verrou malforme, echec de drain, fichier non-.md dans slots/.
    writeFileSync(join(mem, ".lock"), "garbage sans pid\n", "utf8");
    mkdirSync(join(mem, ".pending"), { recursive: true });
    writeFileSync(join(mem, ".pending", "failed-x.json"), JSON.stringify({ name: "memory_write" }), "utf8");
    writeFileSync(join(mem, "slots", "notes.txt"), "junk", "utf8");

    const run = memory(["clean", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.apply, false, "dry-run par defaut");
    assert.equal(value.changed, 0, "rien d'applique");
    const kinds = value.actions.map((action: { kind: string }) => action.kind);
    assert.deepEqual(kinds.sort(), ["lock-stale", "pending-failed", "reindex"]);
    assert.ok(
      value.observations.some((note: string) => note.includes("notes.txt")),
      "le junk non-.md est observe, jamais supprime"
    );
    // Dry-run: tout est encore la.
    assert.equal(existsSync(join(mem, ".lock")), true, "verrou intact en dry-run");
    assert.equal(existsSync(join(mem, ".pending", "failed-x.json")), true, "failed intact en dry-run");
    assert.equal(existsSync(join(mem, "slots", "notes.txt")), true, "junk intact");
    const status = asJson(memory(["status", "--json"]));
    assert.equal(status.slots.total, 1, "index non reconstruit en dry-run");
  });

  test("--apply execute: verrou et failed retires, orphelin adopte, junk conserve", () => {
    const run = memory(["clean", "--apply", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.apply, true);
    assert.equal(value.changed, 3, "lock-stale + pending-failed + reindex");
    assert.equal(existsSync(join(mem, ".lock")), false, "verrou periime retire");
    assert.equal(existsSync(join(mem, ".pending", "failed-x.json")), false, "failed retire");
    assert.equal(existsSync(join(mem, "slots", "notes.txt")), true, "junk jamais supprime");
    const status = asJson(memory(["status", "--json"]));
    assert.equal(status.slots.total, 2, "orphelin adopte par le reindex");
    assert.deepEqual(status.disk.orphans, []);
    assert.equal(status.lock.present, false);
    assert.equal(status.pending.failed, 0);
  });
});

describe("novahiz memory prune (dry-run par defaut, GC sans destruction)", () => {
  test("dry-run: seul l'actif plus vieux que 30 jours est candidat", () => {
    editIndex((index) => {
      const old = index.slots.find((slot: { id: string }) => slot.id === "slot-001");
      old.updated = new Date(Date.now() - 40 * DAY_MS).toISOString();
    });
    const run = memory(["prune", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.apply, false);
    assert.equal(value.days, 30, "defaut 30 jours");
    assert.deepEqual(value.candidates.map((slot: { id: string }) => slot.id), ["slot-001"]);
    assert.deepEqual(value.archived, [], "dry-run n'archive pas");
    const status = asJson(memory(["status", "--json"]));
    assert.equal(status.slots.active, 2, "toujours actifs en dry-run");
  });

  test("--apply archive sans jamais supprimer de fichier", () => {
    const run = memory(["prune", "--apply", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.deepEqual(value.archived, ["slot-001"]);
    const status = asJson(memory(["status", "--json"]));
    assert.equal(status.slots.archived, 1, "slot-001 archive");
    assert.equal(status.slots.active, 1, "slot-002 (recent) epargne");
    const slotFile = readdirSync(join(mem, "slots")).find((name) => name.includes("slot-001"));
    assert.ok(slotFile, "le fichier archive existe toujours sur disque");
    assert.ok(readFileSync(join(mem, "slots", slotFile), "utf8").includes("status: archived"));
  });

  test("index corrompu: refus net (exit 1) avec renvoi vers clean", () => {
    writeFileSync(indexPath(), "{ index casse", "utf8");
    const run = memory(["prune", "--apply"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /clean --apply/);
  });

  test("sous-commande inconnue: exit 1 + usage des sous-commandes", () => {
    const run = memory(["wololo"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /status \| clean \| prune/);
  });
});
