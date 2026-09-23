import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const sourcePlugin = join(root, "adapters", "opencode", "novahiz.ts");

function pluginSource(): string {
  return readFileSync(sourcePlugin, "utf8");
}

function installedPluginPath(): string {
  const dir =
    process.env.OPENCODE_CONFIG_DIR && process.env.OPENCODE_CONFIG_DIR.length > 0
      ? process.env.OPENCODE_CONFIG_DIR
      : join(homedir(), ".config", "opencode");
  return join(dir, "plugins", "novahiz.ts");
}

test("plugin source has no relative import into ../../src (breaks after install)", () => {
  const source = pluginSource();
  const bad = source.match(/from\s+["'](\.\.\/)+src\//);
  assert.equal(bad, null, `installed plugin cannot resolve: ${bad?.[0] ?? ""}`);
});

test("plugin source inlines autodocs helpers instead of importing them", () => {
  const source = pluginSource();
  assert.ok(
    source.includes("function autoDocsEnabled"),
    "autoDocsEnabled must be inlined"
  );
  assert.ok(source.includes("function markDirty"), "markDirty must be inlined");
  assert.ok(source.includes("function isMajorPath"), "isMajorPath must be inlined");
  assert.ok(source.includes("function readState"), "readState must be inlined");
  assert.ok(
    !source.includes('from "../../src/autodocs.ts"'),
    "must not import src/autodocs.ts"
  );
});

test("plugin source registers autodocs hooks", () => {
  const source = pluginSource();
  assert.ok(source.includes("session.idle"), "session.idle flush hook");
  assert.ok(source.includes("tool.execute.after"), "tool.execute.after markDirty hook");
});

test("installed plugin does not import a non-existent ../../src path", () => {
  const installed = installedPluginPath();
  if (!existsSync(installed)) return; // no install yet — skip
  const source = readFileSync(installed, "utf8");
  const bad = source.match(/from\s+["'](\.\.\/)+src\//);
  if (bad) {
    // Resolve relative to the installed file and require the target to exist.
    const importPath = /from\s+["']([^"']+)["']/.exec(source.slice(0, 200));
    assert.equal(
      bad,
      null,
      `installed plugin still has relative src import (rerun installer). First import: ${importPath?.[1] ?? "?"}`
    );
  }
  // Prefer byte equality with source when both exist (what doctor checks).
  assert.equal(
    source,
    pluginSource(),
    "installed plugin outdated — rerun install/install.mjs then restart opencode"
  );
});

test("README counts match catalog (15 categories, 12 rules, 10 providers)", () => {
  const rules = JSON.parse(readFileSync(join(root, "catalog", "rules.json"), "utf8"));
  const categories = JSON.parse(
    readFileSync(join(root, "catalog", "categories.json"), "utf8")
  );
  const providers = JSON.parse(
    readFileSync(join(root, "catalog", "providers.json"), "utf8")
  );
  const ruleCount = Array.isArray(rules) ? rules.length : Object.keys(rules).length;
  const catList = Array.isArray(categories)
    ? categories
    : (categories.categories ?? Object.values(categories));
  const provList = Array.isArray(providers)
    ? providers
    : (providers.providers ?? Object.values(providers));
  assert.equal(Array.isArray(catList) ? catList.length : 0, 15);
  assert.equal(ruleCount, 12);
  assert.equal(Array.isArray(provList) ? provList.length : 0, 10);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.ok(readme.includes("173 skills"), "README skill count");
  assert.ok(readme.includes("12 gate rules"), "README rule count");
  assert.ok(readme.includes("10 MCP providers"), "README provider count");
  assert.ok(readme.includes("12 health checks") || readme.includes("12-check"), "README doctor count");
  assert.ok(!/185 skills/.test(readme), "stale 185 skills");
  assert.ok(!/11 gate rules/.test(readme), "stale 11 gate rules");
  assert.ok(!/12 MCP providers/.test(readme), "stale 12 MCP providers");
  assert.ok(!/10-check/.test(readme), "stale 10-check doctor");
});
