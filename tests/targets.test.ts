import { test } from "node:test";
import assert from "node:assert/strict";
import { extractShellPaths, extractTargetPaths, tokenizeShell } from "../src/targets.ts";

test("extracts filePath from edit and write args", () => {
  assert.deepEqual(extractTargetPaths("edit", { filePath: "src/a.ts", oldString: "x" }), ["src/a.ts"]);
  assert.deepEqual(extractTargetPaths("write", { filePath: "src/b.ts", content: "x" }), ["src/b.ts"]);
  assert.deepEqual(extractTargetPaths("edit", { file_path: "src/c.ts" }), ["src/c.ts"]);
});

test("extracts paths from a patch payload including Move to", () => {
  const patchText = [
    "*** Begin Patch",
    "*** Update File: src/one.ts",
    "*** Add File: src/two.ts",
    "*** Delete File: src/three.ts",
    "*** Move to: src/four.ts",
    "*** End Patch"
  ].join("\n");
  assert.deepEqual(extractTargetPaths("patch", { patchText }), [
    "src/one.ts",
    "src/two.ts",
    "src/three.ts",
    "src/four.ts"
  ]);
});

test("tokenizer keeps quotes together and drops file descriptor digits", () => {
  assert.deepEqual(tokenizeShell("echo hi > out.txt"), ["echo", "hi", ">", "out.txt"]);
  assert.deepEqual(tokenizeShell("cmd 2> err.log"), ["cmd", ">", "err.log"]);
  assert.deepEqual(tokenizeShell("cmd 2>&1 | next"), ["cmd", ">", "&", "1", "|", "next"]);
});

test("does not treat fd duplication or a following pipe as a target", () => {
  assert.deepEqual(extractShellPaths("node cli.ts check 2>&1 | Select-String x"), []);
  assert.deepEqual(extractShellPaths("cmd > out.log 2>&1"), ["out.log"]);
});

test("detects shell redirections and tee", () => {
  assert.deepEqual(extractShellPaths("echo hi > out.txt"), ["out.txt"]);
  assert.deepEqual(extractShellPaths("cat a >> b.md"), ["b.md"]);
  assert.deepEqual(extractShellPaths("cmd &> both.txt"), ["both.txt"]);
  assert.deepEqual(extractShellPaths("npm run build | tee build.log"), ["build.log"]);
});

test("detects unix copy and move", () => {
  assert.deepEqual(extractShellPaths("cp -r src dist"), ["dist"]);
  assert.deepEqual(extractShellPaths("mv old.txt new.txt"), ["new.txt"]);
});

test("detects powershell write cmdlets", () => {
  assert.deepEqual(extractShellPaths('Set-Content -Path foo.css -Value "x"'), ["foo.css"]);
  assert.deepEqual(extractShellPaths("Set-Content -Encoding utf8 out.txt"), ["out.txt"]);
  assert.deepEqual(extractShellPaths('Add-Content -LiteralPath notes.md -Value "x"'), ["notes.md"]);
  assert.deepEqual(extractShellPaths("New-Item -ItemType Directory -Path outdir"), ["outdir"]);
});

test("detects powershell item cmdlets", () => {
  assert.deepEqual(extractShellPaths("Copy-Item a.ts b.ts"), ["b.ts"]);
  assert.deepEqual(extractShellPaths("Move-Item a b"), ["b"]);
  assert.deepEqual(extractShellPaths("Remove-Item -Recurse -Force dist"), ["dist"]);
});

test("detects cmd builtins", () => {
  assert.deepEqual(extractShellPaths("cmd /c copy a b"), ["b"]);
  assert.deepEqual(extractShellPaths("del old.txt"), ["old.txt"]);
});

test("detects touch, sed -i, and dd", () => {
  assert.deepEqual(extractShellPaths("touch a.ts b.ts"), ["a.ts", "b.ts"]);
  assert.deepEqual(extractShellPaths("sed -i 's/a/b/' file.txt"), ["file.txt"]);
  assert.deepEqual(extractShellPaths("dd if=in.bin of=out.img"), ["out.img"]);
});

test("does not flag read-only commands or package installs", () => {
  assert.deepEqual(extractShellPaths("git status"), []);
  assert.deepEqual(extractShellPaths("ls -la"), []);
  assert.deepEqual(extractShellPaths("pip install -r requirements.txt"), []);
  assert.deepEqual(extractShellPaths("npm install lodash"), []);
});

test("does not treat a command word used as an argument as a write", () => {
  assert.deepEqual(extractShellPaths("grep mkdir README.md"), []);
  assert.deepEqual(extractShellPaths("echo mv a b"), []);
  assert.deepEqual(extractShellPaths("rg sed docs/README.md"), []);
});

test("detects rm and windows delete flags", () => {
  assert.deepEqual(extractShellPaths("rm -rf dist"), ["dist"]);
  assert.deepEqual(extractShellPaths("rd /s /q builddir"), ["builddir"]);
});

test("keeps numeric destinations", () => {
  assert.deepEqual(extractShellPaths("cp -r src 123"), ["123"]);
});

test("detects wrappers before the real command", () => {
  assert.deepEqual(extractShellPaths("sudo rm -rf dist"), ["dist"]);
  assert.deepEqual(extractShellPaths("cmd /c copy a b"), ["b"]);
});

test("looks through wrappers with arguments", () => {
  assert.deepEqual(extractShellPaths("sudo -u root rm -rf dist"), ["dist"]);
  assert.deepEqual(extractShellPaths("env FOO=bar rm -rf dist"), ["dist"]);
  assert.deepEqual(extractShellPaths("nice -n 10 rm -rf dist"), ["dist"]);
  assert.deepEqual(extractShellPaths("timeout 5 rm -rf dist"), ["dist"]);
});

test("keeps unix absolute paths instead of treating them as windows flags", () => {
  assert.deepEqual(extractShellPaths("rm /a"), ["/a"]);
  assert.deepEqual(extractShellPaths("cp -r src /d"), ["/d"]);
});

test("ignores device redirection targets", () => {
  assert.deepEqual(extractShellPaths("rm -rf dist 2>/dev/null"), ["dist"]);
});

test("extractTargetPaths reads shell commands", () => {
  assert.deepEqual(extractTargetPaths("bash", { command: "echo x > report.md" }), ["report.md"]);
});
