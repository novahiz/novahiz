// P5: commandes `novahiz memory` — .tmp et doublons inter-slots (clean),
// retention d'archives et decay "jamais lu" (prune), plus la source de
// donnees du decay: memory_get trace last_read. Dry-run par defaut prouve
// partout (fichiers intacts), --apply execute, GC jamais destructif.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { rebuildIndex, writeEntry } from "../src/memory.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const DAY_MS = 86_400_000;

let home: string;
let ws: string;
let mem: string;

type Run = { status: number | null; stdout: string; stderr: string };

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
  home = mkdtempSync(join(tmpdir(), "novahiz-memp5h-"));
  ws = mkdtempSync(join(tmpdir(), "novahiz-memp5-"));
  mem = join(ws, "project-memory");
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

describe("novahiz memory clean — .tmp et doublons inter-slots", () => {
  // Ecrit au PREMIER TEST, jamais a l'import (mem n'existe qu'apres before();
  // un writeEntry d'import polluerait le cwd reel du lanceur de tests).
  let seeded: ReturnType<typeof writeEntry>;

  test("doublon inter-slots: dry-run le signale sans archiver", () => {
    seeded = writeEntry({
      root: mem,
      title: "fait a dupliquer",
      content: "fait identique rejoue deux fois par la file pending"
    });
    // Copie byte-identique avec autre id (frontmatter) — adoptee par reindex.
    const src = join(mem, seeded.slot.file);
    const copy = join(mem, "slots", "slot-003.md");
    copyFileSync(src, copy);
    writeFileSync(copy, readFileSync(copy, "utf8").replace(/slot-001/g, "slot-003"), "utf8");
    rebuildIndex(mem);

    const run = memory(["clean", "--json"]);
    assert.equal(run.status, 0, run.stderr);
    const value = asJson(run);
    assert.equal(value.apply, false);
    const dup = value.actions.find((action: { kind: string }) => action.kind === "duplicate-slot");
    assert.ok(dup, "une action duplicate-slot est attendue");
    assert.ok(dup.detail.includes("slot-003"), dup.detail);
    // Rien execute en dry-run: slot-003 toujours actif.
    const index = JSON.parse(readFileSync(indexPath(), "utf8")) as { slots: { id: string; status: string }[] };
    assert.equal(index.slots.find((slot) => slot.id === "slot-003")?.status, "active");
  });

  test("doublon inter-slots: --apply archive le plus recent, fichier conserve", () => {
    const run = memory(["clean", "--apply", "--json"]);
    assert.equal(run.status, 0, run.stderr);
    const value = asJson(run);
    const dup = value.actions.find((action: { kind: string }) => action.kind === "duplicate-slot");
    assert.ok(dup?.result?.includes("1 doublon(s) archive(s)"), JSON.stringify(dup));
    const index = JSON.parse(readFileSync(indexPath(), "utf8")) as { slots: { id: string; status: string }[] };
    assert.equal(index.slots.find((slot) => slot.id === "slot-003")?.status, "archived");
    assert.ok(existsSync(join(mem, "slots", "slot-003.md")), "GC: le fichier est conserve");
    assert.equal(index.slots.find((slot) => slot.id === "slot-001")?.status, "active", "le plus ancien est garde");
  });

  test(".tmp: dry-run le signale, fichiers intacts; --apply les retire", () => {
    const rootTmp = join(mem, "index.json.tmp-777");
    const slotTmp = join(mem, "slots", "slot-001.md.tmp-888");
    writeFileSync(rootTmp, "ecriture interrompue", "utf8");
    writeFileSync(slotTmp, "ecriture interrompue", "utf8");

    const dry = memory(["clean", "--json"]);
    assert.equal(dry.status, 0, dry.stderr);
    const value = asJson(dry);
    const tmp = value.actions.find((action: { kind: string }) => action.kind === "tmp-junk");
    assert.ok(tmp, "une action tmp-junk est attendue");
    assert.ok(existsSync(rootTmp) && existsSync(slotTmp), "dry-run: intacts");

    const apply = memory(["clean", "--apply", "--json"]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.equal(existsSync(rootTmp), false, "fragment root retire");
    assert.equal(existsSync(slotTmp), false, "fragment slots retire");
    // Un .md voisin ne doit jamais etre touche (fichier slugge: slot-001-<slug>.md).
    assert.ok(existsSync(join(mem, seeded.slot.file)));
  });
});

describe("novahiz memory prune — retention et decay", () => {
  test("retention: dry-run liste les vieilles copies sans bouger, --apply deplace", () => {
    const archiveDir = join(mem, "slots", "archive");
    mkdirSync(archiveDir, { recursive: true });
    const vieux = join(archiveDir, "slot-001-precompact-vieux.md");
    const frais = join(archiveDir, "slot-001-precompact-frais.md");
    writeFileSync(vieux, "# copie pre-compact ancienne\n", "utf8");
    writeFileSync(frais, "# copie pre-compact recente\n", "utf8");
    const old = new Date(Date.now() - 100 * DAY_MS);
    utimesSync(vieux, old, old);

    const dry = memory(["prune", "--retention", "30", "--json"]);
    assert.equal(dry.status, 0, dry.stderr);
    const value = asJson(dry);
    assert.equal(value.retention.files.length, 1);
    assert.equal(value.retention.files[0].name, "slot-001-precompact-vieux.md");
    assert.ok(existsSync(vieux), "dry-run: rien bouge");
    assert.equal(existsSync(join(archiveDir, "retention")), false);
    const expected = readFileSync(vieux, "utf8");

    const apply = memory(["prune", "--retention", "30", "--apply", "--json"]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.equal(existsSync(vieux), false, "deplace de l'archive active");
    assert.ok(existsSync(join(archiveDir, "retention", "slot-001-precompact-vieux.md")));
    assert.equal(
      readFileSync(join(archiveDir, "retention", "slot-001-precompact-vieux.md"), "utf8"),
      expected,
      "GC: contenu byte-identique"
    );
    assert.ok(existsSync(frais), "la copie fraiche reste en place");
  });

  test("decay: slot jamais lu et ancien -> candidat (dry-run) puis archive", () => {
    // Slot-001 (actif) redate: ecriture et creation il y a 100 jours, jamais lu.
    const oldIso = new Date(Date.now() - 100 * DAY_MS).toISOString();
    editIndex((index) => {
      const slot = index.slots.find((entry: { id: string }) => entry.id === "slot-001");
      slot.updated = oldIso;
      slot.created = oldIso;
      delete slot.last_read;
    });

    const dry = memory(["prune", "--decay", "90", "--json"]);
    assert.equal(dry.status, 0, dry.stderr);
    const value = asJson(dry);
    assert.ok(value.decay.candidates.some((entry: { id: string }) => entry.id === "slot-001"));
    assert.equal(value.apply, false);

    const apply = memory(["prune", "--decay", "90", "--apply", "--json"]);
    assert.equal(apply.status, 0, apply.stderr);
    const done = asJson(apply);
    assert.ok(done.decay.archived.includes("slot-001"));
    const index = JSON.parse(readFileSync(indexPath(), "utf8")) as {
      slots: { id: string; status: string; file: string }[];
    };
    const archivedMeta = index.slots.find((slot) => slot.id === "slot-001");
    assert.equal(archivedMeta?.status, "archived");
    assert.ok(archivedMeta && existsSync(join(mem, archivedMeta.file)), "GC: fichier conserve");
  });

  test("lecture recente (last_read) protege: ni --days ni --decay ne candidate", () => {
    const fresh = writeEntry({ root: mem, title: "note protegee", content: "lue recemment, ecrite il y a longtemps" });
    const oldIso = new Date(Date.now() - 100 * DAY_MS).toISOString();
    editIndex((index) => {
      const slot = index.slots.find((entry: { id: string }) => entry.id === fresh.slot.id);
      slot.updated = oldIso;
      slot.created = oldIso;
      slot.last_read = new Date().toISOString();
    });

    const run = memory(["prune", "--days", "30", "--decay", "90", "--json"]);
    assert.equal(run.status, 0, run.stderr);
    const value = asJson(run);
    assert.equal(value.candidates.length, 0, "--days: la lecture recente prolonge la vie");
    assert.equal(value.decay.candidates.length, 0, "--decay: last_read present => jamais-lu faux");
  });
});

describe("P5 - MCP memory_get trace last_read (source du decay)", () => {
  const MCP = join(process.cwd(), "mcp", "novahiz-tools", "index.mjs");
  const cwd = mkdtempSync(join(tmpdir(), "novahiz-memp5mcp-"));
  const env = { ...process.env, NOVAHIZ_DB: join(cwd, "fts.sqlite") };

  after(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const call = (tool: string, input: string) =>
    spawnSync(process.execPath, [MCP, "--call", tool], { encoding: "utf8", input, cwd, env, timeout: 60_000 });

  test("memory_get positionne last_read dans index.json", () => {
    const write = call("memory_write", JSON.stringify({ title: "note lue", content: "consultation explicite tracee" }));
    assert.equal(write.status, 0, write.stderr);
    const get = call("memory_get", JSON.stringify({ id: "slot-001" }));
    assert.equal(get.status, 0, get.stderr);

    const index = JSON.parse(readFileSync(join(cwd, "project-memory", "index.json"), "utf8")) as {
      slots: { id: string; last_read?: string }[];
    };
    const slot = index.slots.find((entry) => entry.id === "slot-001");
    assert.ok(slot?.last_read, "last_read absent: le decay n'aurait aucune donnee");
    assert.ok(Number.isFinite(Date.parse(slot.last_read)));
  });
});

describe("P5 - MCP autonome sans home novahiz (packageRoot walk-up)", () => {
  const MCP = join(process.cwd(), "mcp", "novahiz-tools", "index.mjs");
  const cwd = mkdtempSync(join(tmpdir(), "novahiz-standalone-"));
  const home = mkdtempSync(join(tmpdir(), "novahiz-emptyhome-"));
  // Reproduit la CI et le chemin communautaire: NOVAHIZ_HOME sans catalog.
  // Avant la correction, packageRoot() ne montait qu'un niveau depuis
  // mcp/<srv>/index.mjs (-> mcp/catalog/, absent) et chaque appel degraderait
  // avec « Invalid or missing catalog file » — red CI Linux, memoire morte
  // sur un npm-global non installe. Le walk-up doit trouver le catalog du
  // paquet. Les deux assertions ci-dessous sont les deux echecs CI du
  // 2026-10-08 (engine=fts, index.json absent).
  const env = {
    ...process.env,
    NOVAHIZ_HOME: home,
    NOVAHIZ_DB: join(cwd, "fts.sqlite")
  };

  after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  const call = (tool: string, input: string) =>
    spawnSync(process.execPath, [MCP, "--call", tool], { encoding: "utf8", input, cwd, env, timeout: 60_000 });

  const payloadOf = (res: { status: number | null; stdout: string; stderr: string }): Record<string, unknown> => {
    assert.equal(res.status, 0, res.stderr);
    const envelope = JSON.parse(res.stdout.trim()) as {
      result: { content: { type: string; text: string }[] };
    };
    return JSON.parse(envelope.result.content[0].text) as Record<string, unknown>;
  };

  test("memory_write/search ne degradent pas sans catalog en home", () => {
    const written = payloadOf(
      call("memory_write", JSON.stringify({ title: "install sans home", content: "le paquet porte son propre catalog" }))
    );
    assert.notEqual(written.failed, true, String(written.error));

    const search = payloadOf(call("memory_search", JSON.stringify({ query: "install sans home", limit: 5 })));
    assert.notEqual(search.failed, true, String(search.error));
    assert.equal(search.engine, "fts", "index derive present via le catalog du paquet");

    const index = JSON.parse(readFileSync(join(cwd, "project-memory", "index.json"), "utf8")) as {
      slots: { id: string }[];
    };
    assert.ok(index.slots.length >= 1, "ecriture bien materialisee dans cwd");
  });
});
