import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand, runScript, unsafeToken } from "../src/exec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("unsafeToken accepts tokens with no shell metacharacters", () => {
  assert.equal(unsafeToken(["npm", "-y", "@playwright/mcp@latest", "--help"]), null);
  assert.equal(unsafeToken(["uv", "tool", "install", "specify-cli"]), null);
  assert.equal(unsafeToken(["npx", "@playwright/mcp@latest", "--help"]), null);
});

test("unsafeToken flags every shell metacharacter", () => {
  assert.equal(unsafeToken(["a; b"]), "a; b");
  assert.equal(unsafeToken(["|"]), "|");
  assert.equal(unsafeToken(["a && b"]), "a && b");
  assert.equal(unsafeToken(["$(id)"]), "$(id)");
  assert.equal(unsafeToken(["%PATH%"]), "%PATH%");
  assert.equal(unsafeToken(["a`b"]), "a`b");
  assert.equal(unsafeToken(["a*b"]), "a*b");
  assert.equal(unsafeToken([""]), "");
});

test("unsafeToken returns the first offending token", () => {
  assert.equal(unsafeToken(["ok", "bad;one", "bad|two"]), "bad;one");
});

test("runCommand refuses an unsafe argument without spawning", () => {
  const result = runCommand("echo", ["hello; rm -rf /"]);
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.error ?? "", /refused unsafe token/);
});

test("runScript refuses an unsafe binary and an empty argv", () => {
  const unsafe = runScript(["node; echo pwned", "--version"]);
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error ?? "", /refused unsafe token/);
  assert.equal(runScript([]).ok, false);
});

test("runCommand runs a safe command", () => {
  const result = runCommand("node", ["--version"]);
  assert.equal(result.ok, true, result.error ?? result.stderr);
  assert.match(result.stdout.trim(), /^v\d+/);
});

test("runScript runs a safe bootstrap argv", () => {
  const result = runScript(["node", "--version"]);
  assert.equal(result.ok, true, result.error ?? result.stderr);
  assert.match(result.stdout.trim(), /^v\d+/);
});

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && /\.(ts|mjs|js)$/.test(entry.name)) files.push(full);
  }
  return files;
}

test("no source file spawns a process with shell: true", () => {
  const offenders = walk(join(root, "src")).filter((file) => /shell\s*:\s*true/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});
