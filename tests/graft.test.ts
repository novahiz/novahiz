import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportGraft, restoreGraft } from "../src/graft.ts";

// Fixture: an isolated home with a `.graft/` directory (initialized) and a
// graft binary override. `graftBinary()` honors NOVAHIZ_GRAFT_BIN lazily and
// `node --version` exits 0, which is all `isGraftAvailable()` checks. Running
// in its own test file gives a fresh module-level binary cache.
const base = mkdtempSync(join(tmpdir(), "novahiz-graft-"));
const home = join(base, "home");
mkdirSync(join(home, ".graft"), { recursive: true });

const saved = {
  home: process.env.NOVAHIZ_HOME,
  bin: process.env.NOVAHIZ_GRAFT_BIN,
  db: process.env.NOVAHIZ_DB
};
process.env.NOVAHIZ_HOME = home;
process.env.NOVAHIZ_GRAFT_BIN = process.execPath;
process.env.NOVAHIZ_DB = join(home, "novahiz.sqlite");

after(() => {
  for (const key of ["home", "bin", "db"] as const) {
    const value = saved[key];
    const envKey = key === "home" ? "NOVAHIZ_HOME" : key === "bin" ? "NOVAHIZ_GRAFT_BIN" : "NOVAHIZ_DB";
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  }
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

test("restore without --force refuses and never touches the ledger", () => {
  const result = restoreGraft("deadbeef");
  assert.equal(result.success, false);
  assert.match(result.message, /without --force/);
  // No backup, no checkout: the ledger file was not even created.
  assert.equal(existsSync(join(home, "novahiz.sqlite")), false);
});

test("export outside the workspace is refused", () => {
  const outside = join(tmpdir(), `novahiz-graft-outside-${Date.now().toString(36)}.sqlite`);
  const result = exportGraft("deadbeef", outside);
  assert.equal(result.success, false);
  assert.match(result.message, /outside the workspace refused/);
});

test("export onto an existing file refuses without --force", () => {
  const target = join(home, "snapshot.sqlite");
  writeFileSync(target, "placeholder");
  const result = exportGraft("deadbeef", target);
  assert.equal(result.success, false);
  assert.match(result.message, /already exists/);
});
