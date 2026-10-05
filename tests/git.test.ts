// Suite de tests de la couche git (src/git.ts) : depot temporaire reel —
// commits, blame borne, statut de working tree, chemins invalides, et
// reponse repo:false hors depot. Les cas git reels sont skips quand git
// n'est pas sur le PATH.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitAvailable, gitBlame, gitModified, gitRecent } from "../src/git.ts";

const T_PAST = Date.now() - 600_000;

let home: string;
const workspaces: string[] = [];

before(() => {
  home = mkdtempSync(join(tmpdir(), "lodestone-gittest-"));
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lodestone-gitws-"));
  workspaces.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  git(["init", "--quiet"], dir);
  git(["config", "user.name", "Lodestone Test"], dir);
  git(["config", "user.email", "lodestone@test.local"], dir);
  return dir;
}

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

describe("gitAvailable", () => {
  test("false hors depot", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestone-nogit-"));
    workspaces.push(dir);
    assert.equal(gitAvailable(dir), false);
  });

  test("true dans un depot", { skip: !hasGit }, () => {
    const dir = makeRepo({ "a.ts": "export const a = 1;" });
    assert.equal(gitAvailable(dir), true);
  });
});

describe("gitRecent", () => {
  test("repo:false hors depot", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestone-nogit-"));
    workspaces.push(dir);
    const result = gitRecent(dir);
    assert.equal(result.repo, false);
    assert.deepEqual(result.commits, []);
  });

  test("commits avec hash, auteur, date, sujet", { skip: !hasGit }, () => {
    const dir = makeRepo({ "a.ts": "export const a = 1;" });
    git(["add", "a.ts"], dir);
    git(["commit", "--quiet", "-m", "initial commit"], dir);
    writeFileSync(join(dir, "a.ts"), "export const a = 2;");
    git(["add", "a.ts"], dir);
    git(["commit", "--quiet", "-m", "bump a"], dir);
    const result = gitRecent(dir, 10);
    assert.equal(result.repo, true);
    assert.equal(result.commits.length, 2);
    assert.equal(result.commits[0].subject, "bump a");
    assert.equal(result.commits[0].author, "Lodestone Test");
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result.commits[0].date));
    assert.ok(result.commits[0].hash.length >= 7);
  });

  test("limite et troncature", { skip: !hasGit }, () => {
    const dir = makeRepo({ "a.ts": "export const a = 1;" });
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, "a.ts"), `export const a = ${i + 2};`);
      git(["add", "a.ts"], dir);
      git(["commit", "--quiet", "-m", `commit ${i}`], dir);
    }
    const result = gitRecent(dir, 3);
    assert.equal(result.commits.length, 3);
    assert.equal(result.truncated, true);
  });
});

describe("gitBlame", () => {
  test("repo:false hors depot", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestone-nogit-"));
    workspaces.push(dir);
    const result = gitBlame(dir, "a.ts", 1, 10);
    assert.equal(result.repo, false);
    assert.deepEqual(result.entries, []);
  });

  test("blame sur une ligne commitee", { skip: !hasGit }, () => {
    const dir = makeRepo({
      "a.ts": ["export const a = 1;", "export const b = 2;", "export const c = 3;"].join("\n"),
    });
    git(["add", "a.ts"], dir);
    git(["commit", "--quiet", "-m", "add a.ts"], dir);
    const result = gitBlame(dir, "a.ts", 2, 1);
    assert.equal(result.repo, true);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].line, 2);
    assert.equal(result.entries[0].author, "Lodestone Test");
    assert.ok(result.entries[0].commit.length >= 7);
  });

  test("chemin absolu ou evadant refuse", { skip: !hasGit }, () => {
    const dir = makeRepo({ "a.ts": "export const a = 1;" });
    git(["add", "a.ts"], dir);
    git(["commit", "--quiet", "-m", "add a.ts"], dir);
    assert.equal(gitBlame(dir, join(dir, "a.ts"), 1, 1).repo, false);
    assert.equal(gitBlame(dir, "../outside.ts", 1, 1).repo, false);
  });
});

describe("gitModified", () => {
  test("repo:false hors depot", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestone-nogit-"));
    workspaces.push(dir);
    const result = gitModified(dir);
    assert.equal(result.repo, false);
    assert.deepEqual(result.staged, []);
  });

  test("staged, untracked et working tree propre", { skip: !hasGit }, () => {
    const dir = makeRepo({ "a.ts": "export const a = 1;" });
    git(["add", "a.ts"], dir);
    git(["commit", "--quiet", "-m", "initial"], dir);
    writeFileSync(join(dir, "a.ts"), "export const a = 2;");
    writeFileSync(join(dir, "b.ts"), "export const b = 1;");
    git(["add", "a.ts"], dir);
    const result = gitModified(dir);
    assert.equal(result.repo, true);
    assert.deepEqual(result.staged, ["a.ts"]);
    assert.deepEqual(result.untracked, ["b.ts"]);
    assert.deepEqual(result.conflicted, []);
  });
});
