// D : suite `novahiz memory check-docs` — les citations novahiz-docs des slots
// confrontees a un index fixture (versions et fetched_at pilotables), au
// catalogue reel copie dans un home temporaire, et au journal d'usage.
// Preuves attendues : dry-run par defaut (index.json intact), les cinq
// verdicts (absent, unindexed, version-drift, refetched, ok), le nudge
// consulte-sans-slot, --apply qui ajoute le marqueur UNE FOIS (append,
// idempotent), --slot qui filtre, et les codes de sortie d'erreur.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSlot, writeEntry } from "../src/memory.ts";
import { splitMarkdown } from "../mcp/novahiz-docs/src/chunk.ts";
import { indexPage, openStore } from "../mcp/novahiz-docs/src/store.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));
const DAY_MS = 86_400_000;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let home: string;
let ws: string;
let mem: string;
let dbPath: string;
let usageFile: string;
const slotOf = new Map<string, string>();

function memory(args: string[]): Run {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "memory", ...args], {
    encoding: "utf8",
    cwd: ws,
    env: {
      ...process.env,
      NOVAHIZ_HOME: home,
      NOVAHIZ_DOCS_DB: dbPath,
      NOVAHIZ_DOCS_USAGE: usageFile
    },
    timeout: 60_000
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asJson = (run: Run): any => JSON.parse(run.stdout);

const indexPath = (): string => join(mem, "index.json");

/** Slot dedie + ecriture dirigee : chaque cas de citation a son propre slot. */
function seedSlot(key: string, title: string, content: string): string {
  const made = createSlot(mem, { title });
  writeEntry({ root: mem, slotId: made.meta.id, title, content });
  slotOf.set(key, made.meta.id);
  return made.meta.id;
}

const markerCount = (slotId: string): number => {
  const files = readdirSync(join(mem, "slots"));
  const file = files.find((name) => name.includes(slotId));
  assert.ok(file, `fichier de ${slotId} trouve`);
  const raw = readFileSync(join(mem, "slots", file), "utf8");
  return raw.split("⚠ docs à revérifier (check-docs").length - 1;
};

before(() => {
  home = mkdtempSync(join(tmpdir(), "novahiz-cd-home-"));
  ws = mkdtempSync(join(tmpdir(), "novahiz-cd-"));
  mem = join(ws, "project-memory");

  // Home temporaire portant le catalogue reel : check-docs lit le bouquet via
  // NovahizHome(), jamais depuis le depot de travail.
  mkdirSync(join(home, "mcp", "novahiz-docs", "data"), { recursive: true });
  copyFileSync(
    join(REPO, "mcp", "novahiz-docs", "data", "catalog.json"),
    join(home, "mcp", "novahiz-docs", "data", "catalog.json")
  );

  // Index fixture : react existe en 19.1.0 mais rafraichi dans le futur
  // (signal refetched une fois le drift eprouve) ; vue est ancienne (signal ok).
  dbPath = join(ws, "index.sqlite");
  const store = openStore(dbPath);
  const page = splitMarkdown("# Doc\n\ncontenu fixture pour l'index de test\n");
  indexPage(
    store,
    {
      library: "react",
      version: "19.1.0",
      sourceUrl: "https://example.test/react",
      license: "CC-BY-4.0",
      fetchedAt: new Date(Date.now() + DAY_MS).toISOString()
    },
    page
  );
  indexPage(
    store,
    {
      library: "vue",
      version: "3.5.0",
      sourceUrl: "https://example.test/vue",
      license: "CC-BY-4.0",
      fetchedAt: new Date(Date.now() - DAY_MS).toISOString()
    },
    page
  );
  store.close();

  // Journal d'usage : zod consulte sans slot (nudge), react cite (exclu),
  // garbage hors catalogue (exclu), axios hors fenetre 7 jours (exclu).
  usageFile = join(ws, "usage.jsonl");
  const nowIso = new Date().toISOString();
  writeFileSync(
    usageFile,
    [
      JSON.stringify({ ts: nowIso, library: "react", query: "useState", count: 2 }),
      JSON.stringify({ ts: nowIso, library: "zod", query: "parse", count: 1 }),
      JSON.stringify({ ts: nowIso, library: "garbage", query: "x", count: 1 }),
      JSON.stringify({ ts: new Date(Date.now() - 30 * DAY_MS).toISOString(), library: "axios", query: "get", count: 1 }),
      "ligne parasite pas-du-json"
    ].join("\n") + "\n",
    "utf8"
  );

  seedSlot("drift", "cas drift react", "Decision : on garde l'etat. novahiz-docs/react@1.2.3");
  seedSlot("refetched", "cas rafraichi react", "Decision : hook custom. novahiz-docs/react");
  seedSlot("ok", "cas a jour vue", "Decision : reactive core. novahiz-docs/vue@3.5.0");
  seedSlot("absent", "cas hors bouquet", "Decision : script exotique. novahiz-docs/nosuchlib");
  seedSlot("unindexed", "cas non indexe", "Decision : build tool. novahiz-docs/svelte");
  seedSlot("none", "cas sans citation", "Note de contexte sans aucune reference de documentation.");
  seedSlot(
    "path",
    "cas chemins de fichiers",
    "Chemins internes qui ne sont pas des citations : mcp/novahiz-docs/data/usage.jsonl ni mcp/novahiz-docs/COMPARE.md."
  );
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

describe("novahiz memory check-docs (dry-run par defaut)", () => {
  test("les cinq verdicts + nudge consulte-sans-slot, sans rien ecrire", () => {
    const mtime = statSync(indexPath()).mtimeMs;
    const run = memory(["check-docs", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.apply, false, "dry-run par defaut");
    assert.equal(value.corpus.catalog, true);
    assert.equal(value.corpus.index, true);

    const verdictOf = (key: string): { verdict: string; detail: string } => {
      const row = value.citations.find((item: { slot: string }) => item.slot === slotOf.get(key));
      assert.ok(row, `citation presente pour ${key}`);
      return row;
    };
    assert.equal(verdictOf("drift").verdict, "version-drift");
    assert.match(verdictOf("drift").detail, /1\.2\.3.*19\.1\.0/);
    assert.equal(verdictOf("refetched").verdict, "refetched");
    assert.equal(verdictOf("ok").verdict, "ok");
    assert.equal(verdictOf("absent").verdict, "absent");
    assert.equal(verdictOf("unindexed").verdict, "unindexed");
    assert.equal(
      value.citations.filter((item: { slot: string }) => item.slot === slotOf.get("none")).length,
      0,
      "une note sans citation ne produit aucune ligne"
    );
    assert.equal(
      value.citations.filter((item: { slot: string }) => item.slot === slotOf.get("path")).length,
      0,
      "les chemins mcp/novahiz-docs/... ne passent pas pour des citations"
    );

    assert.deepEqual([...value.staleSlots].sort(), [
      slotOf.get("absent"),
      slotOf.get("drift"),
      slotOf.get("refetched"),
      slotOf.get("unindexed")
    ].sort());
    assert.deepEqual(value.marked, [], "dry-run n'ecrit aucun marqueur");
    assert.deepEqual(value.usage.nudge, ["zod"], "seule la lib consultee, au catalogue et non citee, remonte");
    assert.equal(value.usage.consulted, 3, "fenetre 7 j : react, zod, garbage (hors catalogue exclu du nudge)");

    assert.equal(statSync(indexPath()).mtimeMs, mtime, "dry-run strictement en lecture");
    assert.deepEqual(value.errors, []);
  });

  test("--slot <id> ne verifie qu'un seul slot", () => {
    const run = memory(["check-docs", "--json", "--slot", slotOf.get("drift")!]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.slot, slotOf.get("drift"));
    assert.equal(value.citations.length, 1, "une seule citation examinee");
    assert.equal(value.citations[0].verdict, "version-drift");
    assert.deepEqual(value.staleSlots, [slotOf.get("drift")]);
  });

  test("slot inconnu : exit 1, refus net", () => {
    const run = memory(["check-docs", "--slot", "slot-999-inconnu"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /slot inconnu/);
  });

  test("index de docs absent : observation, fraicheur non jugee, pas de faux verdict", () => {
    const broken = join(ws, "index-missing.sqlite");
    const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "memory", "check-docs", "--json"], {
      encoding: "utf8",
      cwd: ws,
      env: {
        ...process.env,
        NOVAHIZ_HOME: home,
        NOVAHIZ_DOCS_DB: broken,
        NOVAHIZ_DOCS_USAGE: usageFile
      },
      timeout: 60_000
    });
    assert.equal(result.status, 0);
    const value = JSON.parse(result.stdout ?? "{}");
    assert.equal(value.corpus.index, false);
    assert.ok(value.observations.some((note: string) => note.includes("index novahiz-docs absent")));
    const verdicts = new Set(value.citations.map((row: { verdict: string }) => row.verdict));
    assert.ok(!verdicts.has("refetched") && !verdicts.has("version-drift"), "pas de verdict de fraicheur sans index");
  });
});

describe("novahiz memory check-docs --apply (marqueur append, idempotent)", () => {
  test("ajoute un marqueur par slot stale — jamais sur le slot a jour", () => {
    const run = memory(["check-docs", "--apply", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.equal(value.apply, true);
    assert.deepEqual([...value.marked].sort(), [
      slotOf.get("absent"),
      slotOf.get("drift"),
      slotOf.get("refetched"),
      slotOf.get("unindexed")
    ].sort());
    assert.equal(markerCount(slotOf.get("drift")!), 1, "marqueur present une fois");
    assert.equal(markerCount(slotOf.get("ok")!), 0, "slot a jour jamais marque");
    assert.equal(markerCount(slotOf.get("none")!), 0, "slot sans citation jamais marque");
    const status = asJson(memory(["status", "--json"]));
    assert.equal(status.slots.active, 7, "append : aucun slot perdu ni archive");
  });

  test("second --apply : idempotent, aucun doublon de marqueur", () => {
    const run = memory(["check-docs", "--apply", "--json"]);
    assert.equal(run.status, 0);
    const value = asJson(run);
    assert.deepEqual(value.marked, [], "rien de nouveau marque");
    assert.deepEqual([...value.alreadyMarked].sort(), [
      slotOf.get("absent"),
      slotOf.get("drift"),
      slotOf.get("refetched"),
      slotOf.get("unindexed")
    ].sort());
    for (const key of ["drift", "refetched", "absent", "unindexed"]) {
      assert.equal(markerCount(slotOf.get(key)!), 1, `${key} : toujours un seul marqueur`);
    }
  });
});

describe("novahiz memory check-docs — codes de sortie", () => {
  test("index memoire corrompu : exit 1 avec renvoi vers clean", () => {
    writeFileSync(indexPath(), "{ index casse", "utf8");
    const run = memory(["check-docs"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /clean --apply/);
  });

  test("sous-commande inconnue : l'usage affiche check-docs", () => {
    const run = memory(["wololo"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /status \| clean \| prune \| check-docs/);
  });
});
