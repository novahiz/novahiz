import { test } from "node:test";
import assert from "node:assert/strict";
import { extractShellPaths, extractTargetPaths, tokenizeShell } from "../src/targets.ts";

test("extracts filePath from edit and write args", () => {
  assert.deepEqual(extractTargetPaths("edit", { filePath: "src/a.ts", oldString: "x" }), ["src/a.ts"]);
  assert.deepEqual(extractTargetPaths("write", { filePath: "src/b.ts", content: "x" }), ["src/b.ts"]);
});

test("extracts paths from a patch payload", () => {
  const patchText = [
    "*** Begin Patch",
    "*** Update File: src/one.ts",
    "@@",
    "-a",
    "+b",
    "*** Add File: src/two.ts",
    "+new",
    "*** Delete File: src/three.ts",
    "*** End Patch"
  ].join("\n");
  assert.deepEqual(extractTargetPaths("patch", { patchText }), ["src/one.ts", "src/two.ts", "src/three.ts"]);
});

test("returns no paths for unrelated args", () => {
  assert.deepEqual(extractTargetPaths("edit", { oldString: "x" }), []);
  assert.deepEqual(extractTargetPaths("edit", null), []);
});

test("tokenizer keeps quotes together and drops file descriptor digits", () => {
  assert.deepEqual(tokenizeShell("echo hi > out.txt"), ["echo", "hi", ">", "out.txt"]);
  assert.deepEqual(tokenizeShell("cmd 2> err.log"), ["cmd", ">", "err.log"]);
  assert.deepEqual(tokenizeShell('cp "a b" c'), ["cp", "a b", "c"]);
});

test("detects shell redirections", () => {
  assert.deepEqual(extractShellPaths("echo hi > out.txt"), ["out.txt"]);
  assert.deepEqual(extractShellPaths("cat a >> b.md"), ["b.md"]);
  assert.deepEqual(extractShellPaths("cmd > out.log 2>&1"), ["out.log"]);
  assert.deepEqual(extractShellPaths("cmd &> both.txt"), ["both.txt"]);
});

test("detects pipe and copy targets", () => {
  assert.deepEqual(extractShellPaths("npm run build | tee build.log"), ["build.log"]);
  assert.deepEqual(extractShellPaths("cp -r src dist"), ["dist"]);
  assert.deepEqual(extractShellPaths("mv old.txt new.txt"), ["new.txt"]);
});

test("detects powershell write cmdlets", () => {
  assert.deepEqual(extractShellPaths('Set-Content -Path foo.css -Value "x"'), ["foo.css"]);
  assert.deepEqual(extractShellPaths('Add-Content -LiteralPath notes.md -Value "x"'), ["notes.md"]);
  assert.deepEqual(extractShellPaths("New-Item -ItemType Directory -Path outdir"), ["outdir"]);
});

test("detects touch, sed -i, and dd", () => {
  assert.deepEqual(extractShellPaths("touch a.ts b.ts"), ["a.ts", "b.ts"]);
  assert.deepEqual(extractShellPaths("sed -i 's/a/b/' file.txt"), ["file.txt"]);
  assert.deepEqual(extractShellPaths("dd if=in.bin of=out.img"), ["out.img"]);
});

test("returns nothing for read-only and status commands", () => {
  assert.deepEqual(extractShellPaths("git status"), []);
  assert.deepEqual(extractShellPaths("ls -la"), []);
  assert.deepEqual(extractShellPaths("echo hello"), []);
});

test("extractTargetPaths reads shell commands", () => {
  assert.deepEqual(extractTargetPaths("bash", { command: "echo x > report.md" }), ["report.md"]);
});
