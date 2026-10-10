// S1: robustesse — index atomique (tmp+rename), auto-heal E_INDEX depuis les
// fichiers slots, verrou par racine (.lock pid + peremption). Caracterise les
// NOUVEAUX comportements S1; les tests de base restent dans memory.test.ts.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireRootLock,
  ensureMemoryRoot,
  getSlot,
  listSlots,
  readIndex,
  rebuildIndex,
  writeEntry,
  writeIndex
} from "../src/memory.ts";
import type { MemoryError } from "../src/memory.ts";

const errCode = (error: unknown): string => (error as MemoryError).code;

describe("memory.ts - S1 robustesse (atomique, auto-heal, verrou)", () => {
  const roots: string[] = [];
  const children: ChildProcess[] = [];

  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-s1-"));
    roots.push(root);
    return root;
  };

  const corrupt = (root: string): void => {
    ensureMemoryRoot(root);
    writeFileSync(join(root, "index.json"), "NOT JSON {", "utf8");
  };

  afterEach(() => {
    for (const child of children.splice(0)) {
      try {
        child.kill();
      } catch {
        // Deja termine.
      }
    }
    while (roots.length > 0) {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    }
  });

  describe("ecriture atomique de l'index", () => {
    test("aucun temporaire .tmp- ne subsiste apres 20 ecritures", () => {
      const root = makeRoot();
      let index = ensureMemoryRoot(root);
      for (let i = 0; i < 20; i += 1) {
        index = writeIndex(root, { ...index });
      }
      const leftovers = readdirSync(root).filter((name) => name.includes(".tmp-"));
      assert.deepEqual(leftovers, []);
      assert.equal(readIndex(root).slots.length, 0);
    });

    test("remplace un index existant (rename par-dessus) sans perte de fichier", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      writeEntry({ root, title: "ee ff gg hh", content: "two" });
      const index = readIndex(root);
      writeIndex(root, { ...index, slots: index.slots.slice(0, 1) });
      assert.equal(readIndex(root).slots.length, 1);
      // les fichiers slots sont intacts: un rebuild retrouve tout
      assert.equal(rebuildIndex(root).slots.length, 2);
    });

    test("l'index reste du JSON valide apres une ecriture sous verrou", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      const disk = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as {
        version: number;
        slots: unknown[];
      };
      assert.equal(disk.version, 1);
      assert.equal(disk.slots.length, 1);
    });
  });

  describe("auto-heal E_INDEX (S1)", () => {
    test("ensureMemoryRoot: index illisible -> reconstruit depuis les slots, healed true", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      writeEntry({ root, title: "ee ff gg hh", content: "two" });
      corrupt(root);
      const healed = ensureMemoryRoot(root);
      assert.equal(healed.healed, true);
      assert.deepEqual(
        healed.slots.map((slot) => slot.id),
        ["slot-001", "slot-002"]
      );
      // le disque ne voit JAMAIS la marque healed (memoire seule)
      const disk = JSON.parse(
        readFileSync(join(root, "index.json"), "utf8")
      ) as Record<string, unknown>;
      assert.equal("healed" in disk, false);
      assert.equal((disk.slots as unknown[]).length, 2);
    });

    test("heal une seule fois: l'appel suivant est normal", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      corrupt(root);
      assert.equal(ensureMemoryRoot(root).healed, true);
      assert.equal(ensureMemoryRoot(root).healed, undefined);
    });

    test("writeEntry passe sous heal: ecriture reussie, healed signale, verrou libere", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      corrupt(root);
      const result = writeEntry({ root, title: "ee ff gg hh", content: "two" });
      assert.equal(result.index.healed, true);
      assert.equal(result.slot.id, "slot-002");
      assert.match(getSlot("slot-001", root).body.details, /one/);
      assert.match(getSlot("slot-002", root).body.details, /two/);
      assert.equal(existsSync(join(root, ".lock")), false);
    });

    test("listSlots (chemin lecture MCP) heal aussi", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      corrupt(root);
      const index = listSlots(root);
      assert.equal(index.healed, true);
      assert.equal(index.slots.length, 1);
    });

    test("readIndex brut reste strict: pas de guerison silencieuse au niveau bas", () => {
      const root = makeRoot();
      corrupt(root);
      assert.throws(
        () => readIndex(root),
        (error: unknown) => errCode(error) === "E_INDEX"
      );
    });
  });

  describe("verrou par racine", () => {
    test("aucun .lock ne subsiste apres writeEntry", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      assert.equal(existsSync(join(root, ".lock")), false);
    });

    test("verrou perime (pid mort) vole: l'ecriture reussit quand meme", () => {
      const root = makeRoot();
      ensureMemoryRoot(root);
      writeFileSync(join(root, ".lock"), `4194304\n${Date.now() - 60_000}\n`, "utf8");
      const result = writeEntry({ root, title: "aa bb cc dd", content: "one" });
      assert.equal(result.slot.id, "slot-001");
      assert.equal(existsSync(join(root, ".lock")), false);
    });

    test("verrou perime (horodatage ancien meme si pid vivant) vole aussi", () => {
      const root = makeRoot();
      ensureMemoryRoot(root);
      writeFileSync(join(root, ".lock"), `${process.pid}\n${Date.now() - 60_000}\n`, "utf8");
      const result = writeEntry({ root, title: "aa bb cc dd", content: "one" });
      assert.equal(result.slot.id, "slot-001");
      assert.equal(existsSync(join(root, ".lock")), false);
    });

    test("verrou tenu par un processus vivant: E_LOCK apres le delai, verrou intact", async () => {
      const root = makeRoot();
      ensureMemoryRoot(root);
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
        stdio: "ignore"
      });
      children.push(child);
      await once(child, "spawn");
      writeFileSync(join(root, ".lock"), `${child.pid}\n${Date.now()}\n`, "utf8");
      const started = Date.now();
      assert.throws(
        () => acquireRootLock(root, 200),
        (error: unknown) => errCode(error) === "E_LOCK"
      );
      assert.ok(Date.now() - started >= 150, "doit patienter avant d'echouer");
      assert.equal(existsSync(join(root, ".lock")), true, "verrou d'autrui intact");
    });

    test("verrou au contenu dechire et mtime frais: E_LOCK, jamais de vol sur lecture incertaine", () => {
      const root = makeRoot();
      ensureMemoryRoot(root);
      // Lecture reussie mais contenu illisible (fichier dechire): l'incertain
      // ne doit jamais etre confondu avec un verrou perime. C'etait la porte
      // d'entree du vol sur verrou vivant: un EPERM de lecture (filtre
      // antivirus sous charge Windows) retournait "perime" et le detenteur
      // actif perdait son verrou — deux sections critiques, une ecriture
      // ecrasee, un marqueur perdu sans erreur.
      writeFileSync(join(root, ".lock"), "pas-un-pid\nquand-meme\n", "utf8");
      assert.throws(
        () => acquireRootLock(root, 150),
        (error: unknown) => errCode(error) === "E_LOCK"
      );
      assert.equal(
        readFileSync(join(root, ".lock"), "utf8"),
        "pas-un-pid\nquand-meme\n",
        "verrou d'autrui intact"
      );
    });

    test("verrou dechire abandonne par un crash (mtime ancien): retire, l'ecriture reprend", () => {
      const root = makeRoot();
      ensureMemoryRoot(root);
      writeFileSync(join(root, ".lock"), "dechire\n", "utf8");
      const past = new Date(Date.now() - 60_000);
      utimesSync(join(root, ".lock"), past, past);
      const release = acquireRootLock(root, 500);
      assert.ok(
        readFileSync(join(root, ".lock"), "utf8").startsWith(String(process.pid)),
        "le verrou nous appartient desormais"
      );
      release();
      assert.equal(existsSync(join(root, ".lock")), false, "liberation effective");
    });

    test("rebuildIndex tourne sous verrou et le libere", () => {
      const root = makeRoot();
      writeEntry({ root, title: "aa bb cc dd", content: "one" });
      rebuildIndex(root);
      assert.equal(existsSync(join(root, ".lock")), false);
    });

    test("concurrence 2 processus: l'ecriture patiente sur le verrou puis reussit", async () => {
      const root = makeRoot();
      const work = makeRoot(); // dossier de travail du script fils
      const script = join(work, "holder.mjs");
      const ready = join(work, "ready");
      // URL derivee du test lui-meme: un chemin absolu local casserait sur un
      // autre poste ou sur le runner CI (echec release v0.5.0).
      const memoryUrl = new URL("../src/memory.ts", import.meta.url).href;
      writeFileSync(
        script,
        [
          `import { acquireRootLock } from "${memoryUrl}";`,
          'import { writeFileSync } from "node:fs";',
          "const root = process.argv[2];",
          "const ready = process.argv[3];",
          "const release = acquireRootLock(root);",
          'writeFileSync(ready, "1");',
          "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);",
          "release();"
        ].join("\n"),
        "utf8"
      );
      const child = spawn(
        process.execPath,
        ["--experimental-strip-types", script, root, ready],
        { stdio: "ignore" }
      );
      children.push(child);
      const deadline = Date.now() + 10_000;
      while (!existsSync(ready)) {
        if (Date.now() > deadline) throw new Error("le fils ne s'est jamais signale pret");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const started = Date.now();
      const result = writeEntry({
        root,
        title: "charge partagee conteneur",
        content: "sous verrou d'autrui"
      });
      const waited = Date.now() - started;
      assert.equal(result.slot.id, "slot-001");
      assert.ok(waited >= 100, `doit avoir patiente sur le verrou (obtenu ${waited}ms)`);
      assert.match(getSlot("slot-001", root).body.details, /sous verrou d'autrui/);
      assert.equal(existsSync(join(root, ".lock")), false);
      if (child.exitCode === null) await once(child, "exit");
    });
  });
});
