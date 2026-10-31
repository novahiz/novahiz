import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import {
  GENESIS,
  appendEvolution,
  digestEntry,
  evolutionHealth,
  evolutionPath,
  readEvolution,
  verifyEvolution,
} from "../src/evolution.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "novahiz-evolution-"));
  made.push(home);
  return home;
}

const base = { kind: "rule", target: "R13", reason: "un skill de design etait exige sur une tache sans UI" };

describe("evolution: le registre se verifie, il ne se croit pas", () => {
  test("append ecrit une ligne chainee a GENESIS", () => {
    const home = makeHome();
    const entry = appendEvolution(home, base, new Date("2026-01-01T00:00:00Z"));

    assert.equal(entry.prev, GENESIS);
    assert.equal(entry.hash, digestEntry(entry, GENESIS));
    assert.equal(entry.provenance, "user");
    assert.equal(entry.verdict, "applied");
    const lines = readFileSync(evolutionPath(home), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
  });

  test("le second enregistrement pointe sur le hash du premier", () => {
    const home = makeHome();
    const first = appendEvolution(home, base, new Date("2026-01-01T00:00:00Z"));
    const second = appendEvolution(home, { ...base, target: "R14" }, new Date("2026-01-01T00:01:00Z"));
    assert.equal(second.prev, first.hash);
    assert.equal(verifyEvolution(home).ok, true);
  });

  test("une modification de contenu casse la chaine", () => {
    const home = makeHome();
    appendEvolution(home, base, new Date("2026-01-01T00:00:00Z"));
    const path = evolutionPath(home);
    const record = JSON.parse(readFileSync(path, "utf8").trim()) as Record<string, unknown>;
    record.reason = "raison reecrite apres coup";
    writeFileSync(path, JSON.stringify(record) + "\n", "utf8");

    const verdict = verifyEvolution(home);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join(" "), /content altered/);
  });

  test("supprimer une ligne du milieu casse la chaine", () => {
    const home = makeHome();
    appendEvolution(home, base, new Date("2026-01-01T00:00:00Z"));
    appendEvolution(home, { ...base, target: "R14" }, new Date("2026-01-01T00:01:00Z"));
    appendEvolution(home, { ...base, target: "R15" }, new Date("2026-01-01T00:02:00Z"));
    const path = evolutionPath(home);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, [lines[0], lines[2]].join("\n") + "\n", "utf8");

    const verdict = verifyEvolution(home);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join(" "), /chain broken/);
  });

  test("une provenance inconnue est refusee", () => {
    const home = makeHome();
    assert.throws(() => appendEvolution(home, { ...base, provenance: "guess" as never }), /unknown provenance/);
    assert.equal(readEvolution(home).entries.length, 0);
  });

  test("une raison d'un mot est refusee", () => {
    const home = makeHome();
    assert.throws(() => appendEvolution(home, { ...base, reason: "fix" }), /reason must be a sentence/);
  });

  test("kind et target sont obligatoires", () => {
    const home = makeHome();
    assert.throws(() => appendEvolution(home, { ...base, kind: "" }), /kind is required/);
    assert.throws(() => appendEvolution(home, { ...base, target: "  " }), /target is required/);
  });

  test("une ligne illisible est signalee, pas ignoree", () => {
    const home = makeHome();
    appendEvolution(home, base, new Date("2026-01-01T00:00:00Z"));
    writeFileSync(evolutionPath(home), readFileSync(evolutionPath(home), "utf8") + "{ pas du json\n", "utf8");

    const { entries, problems } = readEvolution(home);
    assert.equal(entries.length, 1);
    assert.equal(problems.length, 1);
    assert.equal(verifyEvolution(home).ok, false);
  });

  test("health: rouge sans registre, vert avec une chaine intacte", () => {
    const home = makeHome();
    assert.equal(evolutionHealth(home).ok, false);
    appendEvolution(home, base, new Date("2026-01-01T00:00:00Z"));
    const health = evolutionHealth(home);
    assert.equal(health.ok, true);
    assert.match(health.detail, /chain intact/);
  });
});
