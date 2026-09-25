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

test("README counts match catalog (17 categories, 11 rules, 10 providers)", () => {
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
  assert.equal(Array.isArray(catList) ? catList.length : 0, 17);
  assert.equal(ruleCount, 11);
  assert.equal(Array.isArray(provList) ? provList.length : 0, 10);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.ok(readme.includes("95 skills"), "README skill count");
  assert.ok(!/84 skills/.test(readme), "stale 84 skills");
  assert.ok(!/42 skills/.test(readme), "stale 42 skills");
  assert.ok(readme.includes("11 gate rules"), "README rule count");
  assert.ok(readme.includes("7 MCP providers"), "README provider count");
  assert.ok(readme.includes("12 health checks") || readme.includes("12-check"), "README doctor count");
  assert.ok(!/185 skills/.test(readme), "stale 185 skills");
  assert.ok(!/173 skills/.test(readme), "stale 173 skills");
  assert.ok(!/10 gate rules/.test(readme), "stale 10 gate rules");
  assert.ok(!/12 gate rules/.test(readme), "stale 12 gate rules");
  assert.ok(!/12 MCP providers/.test(readme), "stale 12 MCP providers");
  assert.ok(!/10 MCP providers/.test(readme), "stale 10 MCP providers");
  assert.ok(!/6 MCP providers/.test(readme), "stale 6 MCP providers");
  assert.ok(!/10-check/.test(readme), "stale 10-check doctor");
});

test("skill category lists stay aligned with categories.json", () => {
  const categories = JSON.parse(
    readFileSync(join(root, "catalog", "categories.json"), "utf8")
  );
  const catList = Array.isArray(categories)
    ? categories
    : (categories.categories ?? Object.values(categories));
  const ids = new Set(catList.map((entry: { id: string }) => entry.id));

  // Count words used in the skill docs, checked against the real token count.
  const words: Record<string, number> = {
    Zero: 0, One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7,
    Eight: 8, Nine: 9, Ten: 10, Eleven: 11, Twelve: 12, Thirteen: 13,
    Fourteen: 14, Fifteen: 15, Sixteen: 16, Seventeen: 17, Eighteen: 18,
    Nineteen: 19, Twenty: 20,
  };

  // 1. The planner's canonical list equals the catalog: nothing missing, no ghost category.
  const planner = readFileSync(
    join(root, "skills", "novahiz-planner", "SKILL.md"),
    "utf8"
  );
  const heading = planner.match(/^## The (\d+) categories$/m);
  assert.ok(heading, "planner heading '## The N categories'");
  assert.equal(Number(heading![1]), ids.size, "planner heading count vs categories.json");
  const plannerLine = planner.split(/\r?\n/).find((line) => /^code, /.test(line)) ?? "";
  const plannerIds = plannerLine
    .replace(/\.$/, "")
    .split(",")
    .map((value) => value.trim());
  assert.deepEqual(new Set(plannerIds), ids, "planner list vs categories.json");

  // 2. Each pipeline skill's category paragraph names only real categories, and a
  //    count word (heading or paragraph), when present, matches the listed count.
  //    These lists are intentionally partial, so membership — not completeness — is checked.
  const files = [
    "novahiz-plan",
    "novahiz-task",
    "novahiz-analyse",
    "novahiz-implement",
    "novahiz-converge",
    "novahiz-audit",
  ];
  const countWords =
    /\b(Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty)\b/;
  for (const name of files) {
    const body = readFileSync(join(root, "skills", name, "SKILL.md"), "utf8");
    const lines = body.split(/\r?\n/);
    const at = lines.findIndex((line) => /^## .*categor/i.test(line));
    assert.ok(at >= 0, `${name}: categories heading`);
    const paragraph: string[] = [];
    let started = false;
    for (let i = at + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^## /.test(line)) break;
      if (line.trim() === "") {
        if (started) break;
        continue;
      }
      started = true;
      paragraph.push(line);
    }
    const text = paragraph.join(" ");
    // The plan paragraph also names the `novahiz-plan` skill; category ids never start with novahiz-.
    const tokens = [...text.matchAll(/`([a-z0-9-]+)`/g)]
      .map((match) => match[1])
      .filter((token) => !token.startsWith("novahiz-"));
    assert.ok(tokens.length > 0, `${name}: category tokens`);
    for (const token of tokens) {
      assert.ok(ids.has(token), `${name}: unknown category '${token}'`);
    }
    const counted = `${lines[at]} ${text}`.match(countWords);
    if (counted) {
      assert.equal(words[counted[1]], tokens.length, `${name}: count word '${counted[1]}'`);
    }
  }
});
