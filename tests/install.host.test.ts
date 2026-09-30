import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error -- install/lib.mjs is untyped JavaScript by design
import { spawnHost, unsafeHostToken } from "../install/lib.mjs";

// The installer's Windows branch joins tokens into one cmd.exe line. The
// validator is the only thing standing between a future argument and command
// injection, so every real call-site shape must pass and every character a
// shell can reinterpret must be refused before a process is spawned.

test("unsafeHostToken accepts every real installer argv shape", () => {
  assert.equal(unsafeHostToken(["npm", "install", "-g", "narsil-mcp"]), null);
  assert.equal(unsafeHostToken(["npm", "install", "-g", "@upstash/context7-mcp"]), null);
  assert.equal(
    unsafeHostToken(["npx", "-y", "skills", "add", "flutter/tests", "--skill", "*", "-g", "-a", "opencode", "-y"]),
    null
  );
  assert.equal(unsafeHostToken(["npm", "outdated", "--json"]), null);
  assert.equal(unsafeHostToken(["npm", "update"]), null);
});

test("unsafeHostToken refuses every shell metacharacter", () => {
  assert.equal(unsafeHostToken(["np&whoami"]), "np&whoami");
  assert.equal(unsafeHostToken(["a|b"]), "a|b");
  assert.equal(unsafeHostToken(["%PATH%"]), "%PATH%");
  assert.equal(unsafeHostToken(["a b"]), "a b");
  assert.equal(unsafeHostToken([""]), "");
  assert.equal(unsafeHostToken(["$(id)"]), "$(id)");
  assert.equal(unsafeHostToken(["a`b"]), "a`b");
  assert.equal(unsafeHostToken(["a; b"]), "a; b");
  assert.equal(unsafeHostToken(["a>b"]), "a>b");
  assert.equal(unsafeHostToken(['a"b']), 'a"b');
  assert.equal(unsafeHostToken(["a^b"]), "a^b");
  assert.equal(unsafeHostToken(["a?b"]), "a?b");
  assert.equal(unsafeHostToken(["a#b"]), "a#b");
});

test("spawnHost refuses an unsafe cmd token without spawning", { skip: process.platform !== "win32" }, () => {
  const result = spawnHost("np&whoami", ["--version"]);
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), /refused unsafe token/);
});

test("spawnHost refuses an unsafe argument without spawning", { skip: process.platform !== "win32" }, () => {
  const result = spawnHost("npm", ["install", "-g", "x&whoami"]);
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), /refused unsafe token/);
});
