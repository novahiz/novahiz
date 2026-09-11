import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/spec.ts";
import { buildMcpEntries, enabledProviders, providersForCategories } from "../src/providers.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("loads the six bundled providers", () => {
  const ids = spec.providers.map((provider) => provider.id).sort();
  assert.deepEqual(ids, ["context7", "cron", "narsil", "playwright", "security", "sequential-thinking"]);
});

test("maps providers to categories", () => {
  const browser = providersForCategories(spec, ["browser"]).map((provider) => provider.id);
  assert.ok(browser.includes("playwright"));
  const audit = providersForCategories(spec, ["audit"]).map((provider) => provider.id);
  assert.ok(audit.includes("security"));
  assert.ok(audit.includes("narsil"));
});

test("builds local mcp entries for enabled providers", () => {
  const entries = buildMcpEntries(spec);
  assert.equal(entries.playwright.type, "local");
  assert.deepEqual(entries.playwright.command, ["playwright-mcp"]);
  assert.equal(entries.security.command?.[0], "security-mcp");
});

test("disabled providers are filtered out", () => {
  const disabled = { ...spec, config: { ...spec.config, providers: { autoRegister: true, disabled: ["cron"] } } };
  assert.equal(enabledProviders(disabled).some((provider) => provider.id === "cron"), false);
  assert.equal("cron" in buildMcpEntries(disabled), false);
});

test("autoRegister false returns no entries", () => {
  const off = { ...spec, config: { ...spec.config, providers: { autoRegister: false, disabled: [] } } };
  assert.deepEqual(buildMcpEntries(off), {});
});
