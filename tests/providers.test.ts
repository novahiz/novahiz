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
    "impeccable",
    "narsil",
    "skillenforce",
    "obsidian",
    "playwright",
    "security",
    "sequential-thinking",
    "supabase"
  ]);
});

test("maps providers to categories across kinds", () => {
  const design = providersForCategories(spec, ["design-ui"]).map((provider) => provider.id);
  assert.ok(design.includes("playwright"));
  assert.ok(design.includes("impeccable"));
  const planning = providersForCategories(spec, ["planning"]).map((provider) => provider.id);
  assert.deepEqual(planning, ["sequential-thinking", "skillenforce"]);
});

test("builds mcp entries only for mcp providers", () => {
  const entries = buildMcpEntries(spec);
  assert.equal(Object.keys(entries).length, 11);
  assert.deepEqual(entries.playwright.command, ["npx", "-y", "@playwright/mcp@0.0.81"]);
  assert.equal("impeccable" in entries, false);
});

test("exposes official install commands for every provider", () => {
  const commands = installCommands(spec);
  assert.equal(commands.length, 8);
  const impeccable = commands.find((entry) => entry.id === "impeccable");
  assert.equal(impeccable?.kind, "skill");
  assert.deepEqual(impeccable?.command.slice(0, 3), ["npx", "-y", "impeccable@4.1.0"]);
  for (const entry of commands) assert.ok(entry.source === "" || entry.source.startsWith("https://"));
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
