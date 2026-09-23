import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/spec.ts";
import { bootstrapFor, checkDependencies, commandExists, missingPrerequisites } from "../src/deps.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);

test("detects an installed command", () => {
  assert.equal(commandExists("node"), true);
});

test("detects a missing command", () => {
  assert.equal(commandExists("novahiz-definitely-missing-cmd"), false);
});

test("checks dependencies for every provider", () => {
  const status = checkDependencies(spec);
  assert.equal(status.length, spec.providers.length);
});

test("provides a bootstrap command per platform", () => {
  const provider = {
    id: "test-boot",
    requires: ["uv"],
    bootstrap: { win32: ["uv", "--version"], default: ["uv", "--version"] }
  } as never;
  assert.ok((bootstrapFor(provider, "win32") ?? []).join(" ").includes("uv"));
  assert.ok((bootstrapFor(provider, "linux") ?? []).join(" ").includes("uv"));
});

test("missingPrerequisites returns only unmet requirements", () => {
  const missing = missingPrerequisites(spec);
  assert.ok(Array.isArray(missing));
  for (const entry of missing) assert.ok(entry.missing.length > 0);
});
