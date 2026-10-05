// Tests du skill second-memory : init, lint, fix (2 phases), sync
// bidirectionnel, status. Vault et mémoire hermétiques via NOVAHIZ_SM_VAULT /
// NOVAHIZ_SM_MEMORY — rien n'atteint le vault réel de l'utilisateur.
import assert from "node:assert/strict";
import { describe, test, before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { updateSlot, writeEntry } from "../src/memory.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root: string;
let VAULT: string;
let MEM: string;

function sm(args: string[]): Run {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "second-memory", ...args], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, NOVAHIZ_SM_VAULT: VAULT, NOVAHIZ_SM_MEMORY: MEM },
    timeout: 60_000
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asJson = (run: Run): any => JSON.parse(run.stdout);

const indexPath = (): string => join(MEM, "index.json");

const loadIndex = (): any => JSON.parse(readFileSync(indexPath(), "utf8"));

const age = (seconds: number): Date => new Date(Date.now() - seconds * 1000);

before(() => {
  root = mkdtempSync(join(tmpdir(), "novahiz-sm-"));
  VAULT = join(root, "vault");
  MEM = join(root, "memory");
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("novahiz second-memory — cycle complet", () => {
  test("init crée la structure de base", () => {
    const run = sm(["init", "--json"]);
    assert.equal(run.status, 0, "init exits 0");
    const value = asJson(run);
    assert.ok(value.created.some((path: string) => path.endsWith("INDEX.md")), "INDEX.md créé");
    assert.ok(existsSync(join(VAULT, "Inbox")), "Inbox créé");
    assert.ok(existsSync(join(VAULT, "Archive")), "Archive créé");
    assert.ok(existsSync(join(VAULT, "Templates", "project.md")), "template projet créé");
    assert.ok(existsSync(join(VAULT, "log.md")), "log créé");
  });

  test("lint sans problème sur un vault initialisé", () => {
    const run = sm(["lint", "--json"]);
    assert.equal(run.status, 0, "lint exits 0");
    assert.equal(asJson(run).count, 0, "aucun problème après init");
  });

  test("fix répare les liens Home/MOC et retire les liens morts", () => {
    mkdirSync(join(VAULT, "Art"), { recursive: true });
    writeFileSync(
      join(VAULT, "Art", "_MOC.md"),
      "---\ntype: moc\ntitle: Art MOC\n---\n\n# Art MOC\n\n## Notes\n- [[Art/clean-note]]\n"
    );
    writeFileSync(join(VAULT, "Art", "clean-note.md"), "---\ntype: wiki\ntitle: Clean note\n---\n\n# Clean note\n");
    const indexFile = join(VAULT, "INDEX.md");
    writeFileSync(indexFile, readFileSync(indexFile, "utf8") + "\n- [[Home]]\n- [[Art MOC]]\n- [[Dead Note]]\n");

    const lint = asJson(sm(["lint", "--json"]));
    const fixes = lint.issues.map((issue: any) => issue.fix);
    assert.ok(fixes.includes("rewrite-link"), "Home et Art MOC signalés non canoniques");
    assert.ok(fixes.includes("remove-link"), "lien mort signalé");

    const dry = asJson(sm(["fix", "--json"]));
    assert.equal(dry.apply, false, "dry-run par défaut");
    assert.ok(dry.linksRewritten.some((line: string) => line.includes("[[Home]]")), "dry-run annonce la réécriture");
    assert.ok(dry.linksRemoved.some((line: string) => line.includes("[[Dead Note]]")), "dry-run annonce le retrait");

    const apply = asJson(sm(["fix", "--apply", "--json"]));
    assert.ok(apply.linksRewritten.some((line: string) => line.includes("[[INDEX|Home]]")), "Home réécrit");
    const text = readFileSync(indexFile, "utf8");
    assert.ok(text.includes("[[INDEX|Home]]"), "INDEX pointe vers INDEX");
    assert.ok(text.includes("[[Art/_MOC|Art MOC]]"), "MOC en forme canonique");
    assert.ok(!text.includes("[[Dead Note]]"), "lien mort retiré");
    assert.ok(existsSync(join(VAULT, "Archive", ".backup", "INDEX.md.bak")), "backup avant réécriture");
    assert.equal(asJson(sm(["lint", "--json"])).count, 0, "lint propre après réparation");
  });

  test("fix renomme, crée le MOC et relie l'orphelin", () => {
    mkdirSync(join(VAULT, "Code"), { recursive: true });
    writeFileSync(join(VAULT, "Code", "BAD NAME.md"), "---\ntype: project\ntitle: Test\n---\n\n# Test\n\nContenu de test.\n");

    const lint = asJson(sm(["lint", "--json"]));
    const fixes = lint.issues.map((issue: any) => issue.fix);
    assert.ok(fixes.includes("rename"), "nom incorrect signalé");
    assert.ok(fixes.includes("create-moc"), "MOC manquant signalé");
    assert.ok(fixes.includes("link"), "orphelin signalé");

    const dry = asJson(sm(["fix", "--json"]));
    assert.ok(dry.renamed.some((line: string) => line.startsWith("would rename: Code/BAD NAME.md")), "dry-run annonce le renommage");
    assert.ok(dry.mocCreated.some((line: string) => line.includes("Code/_MOC.md")), "dry-run annonce le MOC");

    const apply = asJson(sm(["fix", "--apply", "--json"]));
    assert.ok(existsSync(join(VAULT, "Code", "bad-name.md")), "fichier renommé en minuscules");
    assert.ok(!existsSync(join(VAULT, "Code", "BAD NAME.md")), "ancien nom parti");
    assert.ok(existsSync(join(VAULT, "Code", "_MOC.md")), "MOC créé");
    assert.ok(existsSync(join(VAULT, "Archive", ".backup", "Code__BAD NAME.md.bak")), "backup du renommage");
    assert.ok(apply.orphansLinked.some((line: string) => line.includes("Code/bad-name.md")), "orphelin relié");
    assert.ok(readFileSync(join(VAULT, "INDEX.md"), "utf8").includes("[[Code/_MOC|Code MOC]]"), "MOC relié depuis INDEX");
    assert.equal(asJson(sm(["lint", "--json"])).count, 0, "lint propre après correction");
  });

  test("sync crée une note à partir d'un slot mémoire", () => {
    const { slot } = writeEntry({
      title: "Trading plan",
      description: "Plan de trading",
      content: "Détails du plan de trading.",
      tags: ["trading"],
      root: MEM
    });

    const dry = asJson(sm(["sync", "--json"]));
    assert.equal(dry.apply, false, "sync dry-run par défaut");
    assert.ok(
      dry.actions.some((action: string) => action.startsWith("would create note: Trading/") && action.includes(slot.id)),
      `dry-run annonce la note: ${JSON.stringify(dry.actions)}`
    );

    const apply = asJson(sm(["sync", "--apply", "--json"]));
    assert.ok(apply.actions.some((action: string) => action.startsWith(`create note: Trading/${slot.id}`)), "note créée");
    const notePath = join(VAULT, "Trading", `${slot.id}-trading-plan.md`);
    assert.ok(existsSync(notePath), "fichier de note présent");
    const noteText = readFileSync(notePath, "utf8");
    assert.ok(noteText.includes(`novahiz_slot_id: ${slot.id}`), "frontmatter lié au slot");
    assert.ok(noteText.includes("novahiz_synced_at"), "horodatage de synchro présent");
    assert.ok(noteText.includes("Détails du plan de trading."), "contenu du slot dans la note");
    assert.ok(existsSync(join(VAULT, "Trading", "_MOC.md")), "catégorie émergente avec MOC");

    const again = asJson(sm(["sync", "--apply", "--json"]));
    assert.equal(again.actions.length, 0, `sync stable: ${JSON.stringify(again.actions)}`);
    assert.equal(asJson(sm(["lint", "--json"])).count, 0, "vault propre après création");
  });

  test("sync tire dans la note une mise à jour du slot (pull)", () => {
    const slot = loadIndex().slots.find((entry: any) => entry.title === "Trading plan");
    assert.ok(slot, "slot présent dans l'index");
    const notePath = join(VAULT, "Trading", `${slot.id}-trading-plan.md`);
    const oldStamp = age(60).toISOString();
    const noteText = readFileSync(notePath, "utf8");
    writeFileSync(notePath, noteText.replace(/novahiz_synced_at: .*/, `novahiz_synced_at: ${oldStamp}`));
    utimesSync(notePath, age(60), age(60));
    updateSlot({ id: slot.id, root: MEM, mode: "append", content: "- ligne ajoutée dans le slot" });

    const dry = asJson(sm(["sync", "--json"]));
    assert.ok(
      dry.actions.some((action: string) => action.startsWith(`would pull: slot ${slot.id}`)),
      `dry-run annonce le pull: ${JSON.stringify(dry.actions)}`
    );

    const apply = asJson(sm(["sync", "--apply", "--json"]));
    assert.ok(apply.actions.some((action: string) => action.startsWith(`pull: slot ${slot.id}`)), "pull exécuté");
    const updated = readFileSync(notePath, "utf8");
    assert.ok(updated.includes("ligne ajoutée dans le slot"), "contenu du slot tiré dans la note");
    assert.ok(!updated.includes(`novahiz_synced_at: ${oldStamp}`), "horodatage de synchro rafraîchi");

    const again = asJson(sm(["sync", "--apply", "--json"]));
    assert.equal(again.actions.length, 0, `stable après pull: ${JSON.stringify(again.actions)}`);
  });

  test("sync écrit dans le slot une note modifiée (push)", () => {
    const index = loadIndex();
    const slot = index.slots.find((entry: any) => entry.title === "Trading plan");
    assert.ok(slot, "slot présent dans l'index");
    // Le slot devient plus ancien que la note : la note prime (last-writer-wins).
    index.slots = index.slots.map((entry: any) =>
      entry.id === slot.id ? { ...entry, updated: age(60).toISOString() } : entry
    );
    writeFileSync(indexPath(), JSON.stringify(index, null, 2), "utf8");

    const notePath = join(VAULT, "Trading", `${slot.id}-trading-plan.md`);
    const noteText = readFileSync(notePath, "utf8");
    const edited = noteText
      .replace(/novahiz_synced_at: .*/, `novahiz_synced_at: ${age(60).toISOString()}`)
      .concat("\n- note enrichie par l'utilisateur\n");
    writeFileSync(notePath, edited, "utf8");

    const dry = asJson(sm(["sync", "--json"]));
    assert.ok(
      dry.actions.some((action: string) => action.startsWith(`would push: Trading/${slot.id}`)),
      `dry-run annonce le push: ${JSON.stringify(dry.actions)}`
    );

    const apply = asJson(sm(["sync", "--apply", "--json"]));
    assert.ok(apply.actions.some((action: string) => action.startsWith(`push: Trading/${slot.id}`)), "push exécuté");
    const slotText = readFileSync(join(MEM, slot.file), "utf8");
    assert.ok(slotText.includes("note enrichie par l'utilisateur"), "contenu de la note poussé dans le slot");

    const again = asJson(sm(["sync", "--apply", "--json"]));
    assert.equal(again.actions.length, 0, `stable après push: ${JSON.stringify(again.actions)}`);
  });

  test("sync crée un slot depuis une note marquée novahiz_slot_sync", () => {
    const flagged = join(VAULT, "Art", "flagged-note.md");
    writeFileSync(
      flagged,
      "---\ntype: wiki\ntitle: Flagged note\nnovahiz_slot_sync: true\ntags: [doc]\n---\n\n# Flagged note\n\n## Summary\nResume de la note.\n\n## Details\nDetails de la note.\n"
    );
    const before = loadIndex().slots.length;

    const dry = asJson(sm(["sync", "--json"]));
    assert.ok(
      dry.actions.some((action: string) => action.startsWith("would create slot: Art/flagged-note.md")),
      `dry-run annonce le slot: ${JSON.stringify(dry.actions)}`
    );

    const apply = asJson(sm(["sync", "--apply", "--json"]));
    assert.ok(apply.actions.some((action: string) => action.startsWith("create slot: Art/flagged-note.md")), "slot créé");
    assert.equal(loadIndex().slots.length, before + 1, "un slot de plus dans l'index");
    assert.match(readFileSync(flagged, "utf8"), /novahiz_slot_id: slot-/, "note estampillée");

    const again = asJson(sm(["sync", "--apply", "--json"]));
    assert.equal(again.actions.length, 0, `stable après création de slot: ${JSON.stringify(again.actions)}`);

    // La note reste orpheline : le correctif la relie dans le MOC de sa catégorie.
    asJson(sm(["fix", "--apply", "--json"]));
    assert.equal(asJson(sm(["lint", "--json"])).count, 0, "vault propre en fin de parcours");
  });

  test("sync reconstruit une note legacy sans novahiz_synced_at (sens sûr)", () => {
    const { slot } = writeEntry({ title: "Note legacy", description: "Slot riche", content: "- detail precieux du slot", tags: ["legacy"], root: MEM });
    // Stub sans horodatage, comme créé par une version antérieure de la sync.
    writeFileSync(
      join(VAULT, "Trading", `${slot.id}-note-legacy.md`),
      `---\ntype: resource\ntitle: Note legacy\nnovahiz_slot_id: ${slot.id}\ntags: [legacy]\n---\n\n# Note legacy\n\n## Summary\nStub.\n`
    );

    const dry = asJson(sm(["sync", "--json"]));
    assert.ok(
      dry.actions.some((action: string) => action.startsWith(`would rebuild: Trading/${slot.id}-note-legacy.md`)),
      `dry-run annonce le rebuild: ${JSON.stringify(dry.actions)}`
    );
    assert.ok(!dry.actions.some((action: string) => action.includes("push")), "aucune poussée destructive");

    const slotBefore = readFileSync(join(MEM, slot.file), "utf8");
    const apply = asJson(sm(["sync", "--apply", "--json"]));
    assert.ok(apply.actions.some((action: string) => action.startsWith(`rebuild: Trading/${slot.id}-note-legacy.md`)), "rebuild exécuté");

    const noteText = readFileSync(join(VAULT, "Trading", `${slot.id}-note-legacy.md`), "utf8");
    assert.ok(noteText.includes("detail precieux du slot"), "contenu du slot dans la note reconstruite");
    assert.ok(noteText.includes("novahiz_synced_at"), "horodatage posé après rebuild");
    assert.equal(readFileSync(join(MEM, slot.file), "utf8"), slotBefore, "mémoire inchangée (jamais écrasée)");
    assert.equal(asJson(sm(["sync", "--apply", "--json"])).actions.length, 0, "stable après rebuild");

    asJson(sm(["fix", "--apply", "--json"]));
    assert.equal(asJson(sm(["lint", "--json"])).count, 0, "vault propre");
  });

  test("status résume le vault, les catégories et la mémoire", () => {
    const run = sm(["status", "--json"]);
    assert.equal(run.status, 0, "status exits 0");
    const value = asJson(run);
    assert.equal(value.exists, true);
    assert.ok(value.notes > 0, "notes comptées");
    assert.ok(value.categories.includes("Trading"), "catégorie Trading émergente");
    assert.equal(value.issues, 0, "aucune issue résiduelle");
    assert.equal(value.memory, MEM, "racine mémoire résolue");
  });
});
