import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { scopedCommit } from "../src/gitguard.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return (result.stdout ?? "").trim();
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "novahiz-git-"));
  made.push(root);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Novahiz Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "a.txt"), "a0\n", "utf8");
  writeFileSync(join(root, "b.txt"), "b0\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

describe("commit scopé: n'absorbe jamais l'index d'une autre session", () => {
  test("un dossier demande n'est pas signale comme une intrusion", () => {
    // Mesure du 2026-10-29 : `--files wireframes/controle-de-theme` a commite
    // les deux fichiers du dossier puis les a declares « not requested », parce
    // que la verification comparait le commit aux arguments litteraux.
    const root = repo();
    mkdirSync(join(root, "wireframes", "ecran", "sections"), { recursive: true });
    writeFileSync(join(root, "wireframes", "ecran", "screen.md"), "# ecran\n", "utf8");
    writeFileSync(join(root, "wireframes", "ecran", "sections", "01-a.md"), "# a\n", "utf8");

    const outcome = scopedCommit(root, { message: "wireframe", files: ["wireframes/ecran"] });
    assert.equal(outcome.ok, true, outcome.error ?? "");
    assert.deepEqual(
      outcome.committed.sort(),
      ["wireframes/ecran/screen.md", "wireframes/ecran/sections/01-a.md"]
    );
  });

  test("un fichier staged par ailleurs reste hors du commit", () => {
    const root = repo();
    writeFileSync(join(root, "a.txt"), "a1\n", "utf8");
    writeFileSync(join(root, "b.txt"), "b1\n", "utf8");
    // L'autre session a déjà indexé b.txt.
    git(root, ["add", "b.txt"]);

    const outcome = scopedCommit(root, { message: "a seul", files: ["a.txt"] });
    const committed = git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean);
    const stillStaged = git(root, ["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
    const bState = git(root, ["show", "HEAD:b.txt"]);

    assert.equal(outcome.ok, true, outcome.error);
    assert.deepEqual(committed, ["a.txt"]);
    assert.deepEqual(stillStaged, ["b.txt"]);
    assert.equal(bState, "b0", "b.txt ne doit pas entrer dans le commit");
    assert.ok(outcome.leftStaged.includes("b.txt"));
  });

  test("un message vide est refusé sans toucher au dépôt", () => {
    const root = repo();
    writeFileSync(join(root, "a.txt"), "a2\n", "utf8");
    const before = git(root, ["rev-parse", "HEAD"]);
    const outcome = scopedCommit(root, { message: "   ", files: ["a.txt"] });
    const head = git(root, ["rev-parse", "HEAD"]);

    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error), /message is empty/);
    assert.equal(head, before);
  });

  test("hors dépôt git, l'erreur est explicite", () => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-nogit-"));
    made.push(root);
    const outcome = scopedCommit(root, { message: "x", files: ["a.txt"] });
    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error), /not a git repository/);
  });
});
