import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isReadOnlyCommand } from "../src/readonly.ts";

describe("readonly: commandes shell en lecture seule", () => {
  test("git en lecture seule", () => {
    for (const command of [
      "git status",
      "git status --short",
      "git log --oneline -5",
      "git diff HEAD~1",
      "git show HEAD:src/app.ts",
      "git branch -a",
      "git rev-parse --show-toplevel",
      "git ls-files",
      "git -C C:/repo status"
    ]) {
      assert.equal(isReadOnlyCommand(command), true, command);
    }
  });

  test("git qui ecrit ou execute reste gate", () => {
    for (const command of [
      "git branch -D main",
      "git checkout main",
      "git reset --hard",
      "git clean -fdx",
      "git apply patch.diff",
      "git -c core.pager=calc log",
      "git --exec-path=C:/evil status",
      "git diff --output=out.txt",
      "git stash list"
    ]) {
      assert.equal(isReadOnlyCommand(command), false, command);
    }
  });

  test("lecteurs de fichiers et de recherche", () => {
    for (const command of [
      "ls -la",
      "dir",
      "Get-ChildItem -Recurse",
      "gci src",
      "Get-Content package.json",
      "gc README.md",
      "cat README.md",
      "type README.md",
      "rg gate src",
      "grep -n function src/app.ts",
      "Select-String -Path src/app.ts -Pattern gate",
      "findstr gate src/app.ts",
      "stat file.txt",
      "wc -l README.md"
    ]) {
      assert.equal(isReadOnlyCommand(command), true, command);
    }
  });

  test("chainage, redirection et substitution refusent l'exemption", () => {
    for (const command of [
      "git status && rm -rf src",
      "git status; rm -rf src",
      "git status | Out-File x",
      "Get-Content a > b",
      "echo $(rm -rf src)",
      "git status\nrm -rf src",
      "git status & calc"
    ]) {
      assert.equal(isReadOnlyCommand(command), false, command);
    }
  });

  test("runtimes: version seulement, jamais un script", () => {
    for (const command of ["node --version", "node -v", "python --version", "dart --version", "flutter --version", "npm --version"]) {
      assert.equal(isReadOnlyCommand(command), true, command);
    }
    for (const command of ["node src/cli.ts", "python -c \"import os\"", "npm test", "dart analyze", "flutter build apk"]) {
      assert.equal(isReadOnlyCommand(command), false, command);
    }
  });

  test("une commande vide ou inconnue reste gatee", () => {
    assert.equal(isReadOnlyCommand(""), false);
    assert.equal(isReadOnlyCommand("   "), false);
    assert.equal(isReadOnlyCommand("rm -rf src"), false);
    assert.equal(isReadOnlyCommand("Set-Content a b"), false);
    assert.equal(isReadOnlyCommand("curl https://example.com"), false);
    // `find -exec` and `less` can execute or write without a shell metacharacter.
    assert.equal(isReadOnlyCommand("find . -exec rm {} +"), false);
    assert.equal(isReadOnlyCommand("find . -delete"), false);
    assert.equal(isReadOnlyCommand("less README.md"), false);
  });
});
