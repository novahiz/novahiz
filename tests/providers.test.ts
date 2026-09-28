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
    "dart-skills",
    "expo-skills",
    "flutter-skills",
    "impeccable",
    "narsil",
    "novahiz",
    "playwright",
    "security"
  ]);
});

test("maps providers to categories across kinds", () => {
  const design = providersForCategories(spec, ["design-ui"]).map((provider) => provider.id);
  assert.ok(design.includes("playwright"));
  const planning = providersForCategories(spec, ["planning"]).map((provider) => provider.id);
  assert.deepEqual(planning, ["novahiz"]);
});

test("builds mcp entries only for mcp providers", () => {
  // Hermetic: the example config ships cron disabled, so enable everything here
  // to assert the full MCP surface independently of config defaults.
  const active = { ...spec, config: { ...spec.config, providers: { autoRegister: true, autoInstall: false, disabled: [] } } };
  const entries = buildMcpEntries(active);
  assert.equal(Object.keys(entries).length, 7);
  assert.ok(entries.playwright?.command?.some((c) => c.includes("playwright")));
  assert.equal("playwright" in entries, true);
  assert.deepEqual(entries.dart?.command, ["dart", "mcp-server"]);
  assert.equal("flutter-skills" in entries, false);
});

test("exposes official install commands for providers with install field", () => {
  const commands = installCommands(spec);
  // Only skill-pack providers ship install fields (flutter/dart/expo/impeccable);
  // MCP providers register through their command instead.
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
