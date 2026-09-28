import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- install/lib.mjs is untyped JavaScript by design
import { copyInto, defaultConfig, mergeCreated, nodeVersionOk, parseArgs, readJson, skillNamesIn } from "../install/lib.mjs";

test("parses flags with equals and space forms", () => {
  const flags = parseArgs(["--harness=opencode", "--home", "/tmp/x", "--dry-run"]);
  assert.equal(flags.harness, "opencode");
  assert.equal(flags.home, "/tmp/x");
  assert.equal(flags["dry-run"], true);
});

test("node version check accepts current runtime", () => {
  assert.equal(nodeVersionOk([22, 18, 0]), true);
});

test("copyInto reports newly created files only", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-"));
  const src = join(base, "src");
  const dest = join(base, "dest");
  mkdirSync(join(src, "a"), { recursive: true });
  writeFileSync(join(src, "a", "one.txt"), "1");
  writeFileSync(join(src, "two.txt"), "2");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "two.txt"), "pre-existing");

  const result = copyInto(src, dest);
  assert.equal(result.total, 2);
  assert.deepEqual(result.created, [join(dest, "a", "one.txt")]);
  assert.equal(existsSync(join(dest, "a", "one.txt")), true);
  rmSync(base, { recursive: true, force: true });
});

test("mergeCreated deduplicates and drops missing paths", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-"));
  const present = join(base, "present.txt");
  writeFileSync(present, "x");
  const merged = mergeCreated([present], [present, join(base, "missing.txt")]);
  assert.deepEqual(merged, [present]);
  rmSync(base, { recursive: true, force: true });
});

test("skillNamesIn lists only directories that hold a SKILL.md", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-"));
  const first = join(base, "first");
  const second = join(base, "second");
  mkdirSync(join(first, "alpha"), { recursive: true });
  writeFileSync(join(first, "alpha", "SKILL.md"), "---\nname: alpha\n---\n");
  mkdirSync(join(first, "empty"), { recursive: true });
  mkdirSync(join(second, "beta"), { recursive: true });
  writeFileSync(join(second, "beta", "SKILL.md"), "---\nname: beta\n---\n");

  const names = skillNamesIn([first, join(base, "missing"), second]);

  assert.deepEqual([...names].sort(), ["alpha", "beta"]);
  rmSync(base, { recursive: true, force: true });
});

test("fresh-install config mirrors the shipped example (all skill roots, cron disabled)", () => {
  const config = defaultConfig();
  const example = readJson(join(fileURLToPath(new URL("..", import.meta.url)), "novahiz.config.example.json"));
  assert.deepEqual(config.skillRoots, example.skillRoots);
  assert.deepEqual(config.providers.disabled, ["cron"]);
  assert.equal(config.gate.mode, "block");
});

// npm builds the bin shims from the target's shebang: without
// `#!/usr/bin/env node`, novahiz-install/novahiz-uninstall shipped shims that
// executed the .mjs bare — no Node interpreter, no file association on
// Windows, so the published community command hung or exited silently.
test("every bin target starts with the node shebang", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const pkg = readJson(join(root, "package.json"));
  for (const [name, relative] of Object.entries(pkg.bin as Record<string, string>)) {
    const firstLine = readFileSync(join(root, relative), "utf8").split("\n", 1)[0];
    assert.equal(firstLine, "#!/usr/bin/env node", `bin "${name}" -> ${relative} is missing the shebang`);
  }
});
