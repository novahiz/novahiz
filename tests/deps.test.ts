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
  const speckit = status.find((entry) => entry.id === "speckit");
  assert.deepEqual(speckit?.requires, ["uv"]);
});

test("provides a bootstrap command per platform for uv", () => {
  const speckit = spec.providers.find((provider) => provider.id === "speckit");
  assert.ok(speckit);
  assert.ok((bootstrapFor(speckit, "win32") ?? "").includes("uv"));
  assert.ok((bootstrapFor(speckit, "linux") ?? "").includes("uv"));
});

test("missingPrerequisites returns only unmet requirements", () => {
  const missing = missingPrerequisites(spec);
  assert.ok(Array.isArray(missing));
  for (const entry of missing) assert.ok(entry.missing.length > 0);
});
