// S5: securite memoire — resolution de root unique (resolveMemoryDir),
// archive avant compaction (jamais de perte silencieuse, incident slot-005),
// no-swallow (fold des titres ## + aller-retour de parse stable),
// id orphelin (aucune collision ni ecrasement de fichier).
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSlot,
  getSlot,
  listSlots,
  rebuildIndex,
  resolveMemoryDir,
  updateSlot,
  writeEntry
} from "../src/memory.ts";
import type { MemoryError } from "../src/memory.ts";

const errCode = (error: unknown): string => (error as MemoryError).code;

const throwsCode = (fn: () => unknown, code: string): void => {
  assert.throws(fn, (error: unknown) => errCode(error) === code);
};

describe("memory.ts - S5 securite (root, archive pre-compact, no-swallow, orphelins)", () => {
  const roots: string[] = [];

  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-s5-"));
    roots.push(root);
    return root;
  };

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    }
  });

  describe("resolveMemoryDir", () => {
    test("root vide -> <workspace>/project-memory canonique", () => {
      const ws = makeRoot();
      const resolved = resolveMemoryDir(undefined, ws);
      assert.equal(resolved.dir, join(ws, "project-memory"));
      assert.equal(resolved.layout, "canonical");
    });

    test("root = dossier deja nomme project-memory -> tel quel", () => {
      const ws = makeRoot();
      const target = join(ws, "project-memory");
      mkdirSync(target, { recursive: true });
      const resolved = resolveMemoryDir(target, ws);
      assert.equal(resolved.dir, target);
      assert.equal(resolved.layout, "canonical");
    });

    test("root = racine projet avec project-memory existant -> dedans (canonique prime)", () => {
      const ws = makeRoot();
      mkdirSync(join(ws, "project-memory"), { recursive: true });
      const resolved = resolveMemoryDir(ws, ws);
      assert.equal(resolved.dir, join(ws, "project-memory"));
      assert.equal(resolved.layout, "canonical");
    });

    test("root = racine fraiche sans project-memory -> <root>/project-memory", () => {
      const ws = makeRoot();
      const fresh = join(ws, "fresh");
      mkdirSync(fresh, { recursive: true });
      const resolved = resolveMemoryDir(fresh, ws);
      assert.equal(resolved.dir, join(fresh, "project-memory"));
      assert.equal(resolved.layout, "canonical");
    });

    test("ancien layout (index.json + slots/ a la racine) -> legacy accepte tel quel", () => {
      const ws = makeRoot();
      const legacy = join(ws, "oldproj");
      mkdirSync(join(legacy, "slots"), { recursive: true });
      writeFileSync(join(legacy, "index.json"), "{}", "utf8");
      const resolved = resolveMemoryDir(legacy, ws);
      assert.equal(resolved.dir, legacy);
      assert.equal(resolved.layout, "legacy");
    });

    test("canonique prime sur l'ancien index place a la racine du projet", () => {
      const ws = makeRoot();
      const proj = join(ws, "mixed");
      mkdirSync(join(proj, "slots"), { recursive: true });
      writeFileSync(join(proj, "index.json"), "{}", "utf8");
      mkdirSync(join(proj, "project-memory"), { recursive: true });
      const resolved = resolveMemoryDir(proj, ws);
      assert.equal(resolved.dir, join(proj, "project-memory"));
      assert.equal(resolved.layout, "canonical");
    });

    test("hors workspace -> E_ROOT (Invalid params: memory root outside the workspace)", () => {
      const ws = makeRoot();
      const outside = makeRoot(); // dossier frere de ws, donc hors workspace
      try {
        resolveMemoryDir(outside, ws);
        assert.fail("doit lever E_ROOT");
      } catch (error) {
        assert.equal(errCode(error), "E_ROOT");
        assert.match((error as Error).message, /memory root outside the workspace/);
      }
    });
  });

  describe("archive avant compaction (S5)", () => {
    test("writeEntry compacte: copie complete ecrite AVANT reduction", () => {
      const root = makeRoot();
      let res = writeEntry({
        root,
        title: "securite archive",
        content:
          "## Section A\n\n" +
          "ligne utile ".repeat(120) +
          "\n\n## Section B\n\n" +
          "ligne utile ".repeat(120)
      });
      let guard = 0;
      while (!res.compacted && guard < 30) {
        res = writeEntry({
          root,
          title: "securite archive",
          content: `bloc ${guard} — ` + "remplissage pour forcer la compaction ".repeat(120)
        });
        guard++;
      }
      assert.equal(res.compacted, true);
      const archivedTo = res.archivedTo;
      assert.ok(archivedTo, "archivedTo doit etre renvoye quand la compaction frappe");
      const archivePath = join(root, archivedTo);
      assert.ok(existsSync(archivePath), "fichier d'archive attendu sur disque");
      const archived = readFileSync(archivePath, "utf8");
      // le contenu PRE-compaction, titres ## intacts dans la copie
      assert.match(archived, /^## Section A/m);
      assert.match(archived, /^## Section B/m);
    });

    test("updateSlot compacte: archivedTo + archive contient le contenu d'origine", () => {
      const root = makeRoot();
      writeEntry({ root, title: "cible update", content: "contenu initial" });
      const block = (i: number): string =>
        `bloc maj ${i} — ` + "remplissage update ".repeat(100);
      let res = updateSlot({ id: "slot-001", root, mode: "append", content: block(0) });
      let guard = 1;
      while (!res.compacted && guard < 40) {
        res = updateSlot({ id: "slot-001", root, mode: "append", content: block(guard) });
        guard++;
      }
      assert.equal(res.compacted, true);
      const archivedTo = res.archivedTo;
      assert.ok(archivedTo, "archivedTo doit etre renvoye par updateSlot");
      const archived = readFileSync(join(root, archivedTo), "utf8");
      assert.match(archived, /contenu initial/);
      assert.match(archived, /bloc maj 0/);
    });

    test("les archives sortent du scan: rebuildIndex ne voit que les slots reels", () => {
      const root = makeRoot();
      let res = writeEntry({ root, title: "securite scan", content: "## A\n" + "ligne ".repeat(200) });
      let guard = 0;
      while (!res.compacted && guard < 30) {
        res = writeEntry({
          root,
          title: "securite scan",
          content: `bloc ${guard} — ` + "remplissage scan ".repeat(120)
        });
        guard++;
      }
      assert.equal(res.compacted, true);
      const rebuilt = rebuildIndex(root);
      // chaque slot scanne est un fichier de premier niveau (jamais slots/archive/...)
      for (const slot of rebuilt.slots) {
        assert.equal(slot.file.split(/[\\/]/).length, 2, `scan non recursif attendu: ${slot.file}`);
      }
      const topLevel = readdirSync(join(root, "slots")).filter((name) => name.endsWith(".md"));
      assert.equal(rebuilt.slots.length, topLevel.length);
      assert.ok(existsSync(join(root, "slots", "archive")), "le dossier archive existe bien");
    });
  });

  describe("no-swallow (fold demote + aller-retour)", () => {
    test("resume compacte sans titre ## parasite, contenu present, reparse identique", () => {
      const root = makeRoot();
      let res = writeEntry({
        root,
        title: "Round trip demo",
        content: "## Entete initiale\npremiere note courte\nseconde note courte"
      });
      let guard = 0;
      while (!res.compacted && guard < 60) {
        res = writeEntry({
          root,
          title: "Round trip demo",
          content:
            `## Bloc ${guard}\n` +
            `ligne courte numero un du bloc ${guard}\n` +
            `ligne courte numero deux du bloc ${guard}\n` +
            `ligne courte numero trois du bloc ${guard}\n` +
            `ligne courte numero quatre du bloc ${guard}`
        });
        guard++;
      }
      assert.equal(res.compacted, true);
      const file = getSlot(res.slot.id, root);
      // le fold est demote: aucun titre "## " dans le Resume
      assert.doesNotMatch(file.body.summary, /^## /m);
      // le contenu du fold y est bien present
      assert.match(file.body.summary, /Bloc/);
      // aller-retour: reparse du fichier == corps en memoire (aucun avalage)
      const again = getSlot(res.slot.id, root);
      assert.equal(again.body.summary, file.body.summary);
      assert.equal(again.body.details, file.body.details);
      // la section Resume du fichier ne contient aucun titre parasite
      const raw = readFileSync(join(root, file.meta.file), "utf8");
      const summarySection = raw.split("## Résumé")[1]?.split("## Détails")[0] ?? "";
      assert.doesNotMatch(summarySection, /^## /m);
    });
  });

  describe("id orphelin", () => {
    test("orphelin au meme slug: l'id suivant saute, le fichier reste intact", () => {
      const root = makeRoot();
      createSlot(root, { title: "alpha" });
      const orphanPath = join(root, "slots", "slot-002-beta.md");
      const orphanBody = [
        "---",
        "id: slot-002",
        "title: beta",
        "description: ",
        "created: 2026-10-04T00:00:00.000Z",
        "updated: 2026-10-04T00:00:00.000Z",
        "chars: 32",
        "lines: 5",
        "limit_chars: 8000",
        "limit_lines: 200",
        "status: active",
        "tags: ",
        "---",
        "",
        "## Résumé",
        "ORPHAN-MARKER",
        "",
        "## Détails",
        "contenu orphelin a preserver",
        ""
      ].join("\n");
      writeFileSync(orphanPath, orphanBody, "utf8");
      const next = createSlot(root, { title: "beta" });
      assert.equal(next.meta.id, "slot-003");
      assert.equal(next.meta.file, join("slots", "slot-003-beta.md"));
      assert.equal(readFileSync(orphanPath, "utf8"), orphanBody, "l'orphelin ne doit pas etre ecrase");
      assert.equal(listSlots(root).slots.filter((slot) => slot.id === "slot-003").length, 1);
    });

    test("orphelin sans slug (slot-009.md) pris en compte par l'allocation", () => {
      const root = makeRoot();
      createSlot(root, { title: "gamma" });
      writeFileSync(join(root, "slots", "slot-009.md"), "id: slot-009\n", "utf8");
      const next = createSlot(root, { title: "delta" });
      assert.equal(next.meta.id, "slot-010");
    });
  });

  // garde-fou: les codes d'erreur S5 restent atteignables via la meme convention
  test("E_SLOT reste le code d'un slot inconnu (contrat d'erreur stable)", () => {
    const root = makeRoot();
    writeEntry({ root, title: "existant", content: "x" });
    throwsCode(() => getSlot("slot-999", root), "E_SLOT");
  });

  describe("P1 chaos et concurrence", () => {
    test("index tronque: auto-heal depuis les fichiers + warnings sur slot corrompu", () => {
      const root = makeRoot();
      createSlot(root, { title: "alpha" });
      createSlot(root, { title: "bravo" });
      // Un « slot » corrompu: un DOSSIER porte un nom .md (EISDIR en lecture).
      mkdirSync(join(root, "slots", "corrupt.md"), { recursive: true });
      // Index illisible (ecriture tronquee apres crash).
      writeFileSync(join(root, "index.json"), '{ version: 1, "slots": [', "utf8");

      const healed = listSlots(root);
      assert.equal(healed.healed, true, "l'index doit etre auto-heale");
      assert.equal(healed.slots.length, 2, "les slots sains survivent");
      assert.ok(
        healed.warnings?.some((warning) => warning.includes("corrupt.md")),
        `warnings attendus: ${JSON.stringify(healed.warnings)}`
      );
    });

    test("rebuildIndex signale les slots illisibles sans planer, sans persister les warnings", () => {
      const root = makeRoot();
      createSlot(root, { title: "delta" });
      mkdirSync(join(root, "slots", "broken.md"), { recursive: true });

      const rebuilt = rebuildIndex(root);
      assert.equal(rebuilt.slots.length, 1);
      assert.ok(
        rebuilt.warnings?.some((warning) => warning.includes("broken.md")),
        `warnings attendus: ${JSON.stringify(rebuilt.warnings)}`
      );
      // Les warnings sont runtime uniquement (comme healed): jamais dans l'index.
      const persisted = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as {
        warnings?: unknown;
      };
      assert.equal(persisted.warnings, undefined);
    });

    test("concurrence multi-processus: N sessions ecrivent sans perte ni E_LOCK", async () => {
      const root = makeRoot();
      const srcUrl = pathToFileURL(join(import.meta.dirname, "..", "src", "memory.ts")).href;
      const childScript = join(tmpdir(), `novahiz-conc-${process.pid}-${Date.now()}.mjs`);
      writeFileSync(
        childScript,
        [
          `import { writeEntry } from ${JSON.stringify(srcUrl)};`,
          "const [root, tag, count] = process.argv.slice(2);",
          "for (let i = 0; i < Number(count); i += 1) {",
          "  writeEntry({",
          "    root,",
          "    title: `concurrence session ${tag}`,",
          "    content: `marker ${tag}-${i} bloc de charge unique ${'x'.repeat(40)}`",
          "  });",
          "}",
          ""
        ].join("\n"),
        "utf8"
      );

      try {
        const tags = ["alpha", "bravo", "charly", "delta"];
        const perChild = 5;
        const children = tags.map((tag) =>
          spawn(
            process.execPath,
            ["--experimental-strip-types", childScript, root, tag, String(perChild)],
            { stdio: ["ignore", "ignore", "pipe"] }
          )
        );
        const exits = await Promise.all(
          children.map(
            (child) =>
              new Promise<{ code: number | null; stderr: string }>((resolveExit) => {
                let stderr = "";
                child.stderr?.on("data", (chunk: Buffer) => {
                  stderr += chunk.toString();
                });
                child.on("exit", (code) => resolveExit({ code, stderr }));
                child.on("error", (error) => resolveExit({ code: -1, stderr: String(error) }));
              })
          )
        );
        for (const exit of exits) {
          assert.equal(exit.code, 0, `session enfant en echec (E_LOCK ou crash): ${exit.stderr.slice(0, 400)}`);
        }

        // Zero perte: chaque marqueur unique ecrit par une session est lu.
        const index = listSlots(root);
        let all = "";
        for (const slot of index.slots) {
          const file = getSlot(slot.id, root);
          all += `${file.body.summary}\n${file.body.details}\n`;
        }
        for (const tag of tags) {
          for (let i = 0; i < perChild; i += 1) {
            assert.ok(all.includes(`marker ${tag}-${i}`), `marqueur perdu: marker ${tag}-${i}`);
          }
        }
        assert.equal((all.match(/marker /g) ?? []).length, tags.length * perChild, "aucun doublon ni perte");
        // Index final coherent: chaque entree pointe un fichier reel.
        assert.ok(index.slots.length > 0);
        for (const slot of index.slots) {
          assert.ok(existsSync(join(root, slot.file)), `fichier manquant pour ${slot.id}`);
        }
      } finally {
        rmSync(childScript, { force: true });
      }
    });
  });
});
