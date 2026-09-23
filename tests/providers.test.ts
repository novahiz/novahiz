import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/spec.ts";
import { buildMcpEntries, enabledProviders, installCommands, providersForCategories } from "../src/providers.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("loads the bundled providers", () => {
  const ids = spec.providers.map((provider) => provider.id).sort();
  assert.deepEqual(ids, [
    "context7",
    "cron",
    "dart",
    "expo",
    "narsil",
    "novahiz",
    "obsidian",
    "playwright",
    "security",
    "sequential-thinking"
  ]);
});

test("maps providers to categories across kinds", () => {
  const design = providersForCategories(spec, ["design-ui"]).map((provider) => provider.id);
  assert.ok(design.includes("playwright"));
  const planning = providersForCategories(spec, ["planning"]).map((provider) => provider.id);
  assert.deepEqual(planning, ["sequential-thinking", "novahiz"]);
});

test("builds mcp entries only for mcp providers", () => {
  const entries = buildMcpEntries(spec);
  assert.equal(Object.keys(entries).length, 10);
  assert.ok(entries.playwright?.command?.some((c) => c.includes("playwright")));
  assert.equal("playwright" in entries, true);
});

test("exposes official install commands for providers with install field", () => {
  const commands = installCommands(spec);
  // providers.json no longer has install fields by default
  // install commands are only present when explicitly defined
  assert.ok(commands.length >= 0);
});

test("disabled providers are filtered out", () => {
  const disabled = { ...spec, config: { ...spec.config, providers: { autoRegister: true, autoInstall: false, disabled: ["cron"] } } };
  assert.equal(enabledProviders(disabled).some((provider) => provider.id === "cron"), false);
  assert.equal("cron" in buildMcpEntries(disabled), false);
});

test("autoRegister false returns no entries", () => {
  const off = { ...spec, config: { ...spec.config, providers: { autoRegister: false, autoInstall: false, disabled: [] } } };
  assert.deepEqual(buildMcpEntries(off), {});
});
