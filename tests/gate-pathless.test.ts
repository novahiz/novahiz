import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, fileClass } from "../src/gate.ts";
import { loadSpec } from "../src/spec.ts";

const spec = loadSpec();

const base = {
  spec,
  tool: "shell",
  loaded: ["novahiz-implement"],
  prompt: "run the tests",
  pathless: true
} as const;

// Regression: evaluateGate dereferenced input.filePath at gate.ts:353 and
// inside fileClass (gate.ts:85), so any pathless call without a filePath threw
// `Cannot read properties of undefined (reading 'replace')`.
// GateInput.filePath is REQUIRED (gate.ts:320), so a typed caller cannot omit
// it — but the gate runs under --experimental-strip-types, where no type is
// enforced at runtime, and a throw surfaces to the plugin as a spurious
// "gate unavailable" block. The cast below tests exactly that path.
const noFilePath = () => evaluateGate({ ...base, filePath: undefined as unknown as string });

test("fileClass tolere un chemin absent sans perdre la classification", () => {
  assert.equal(fileClass(undefined), "other");
  assert.equal(fileClass(""), "other");
  // .js -> "code" is the mapping the gate itself reports for e.js, so the
  // guard did not flatten real paths into "other".
  assert.equal(fileClass("src/app.js"), "code");
});

test("evaluateGate pathless sans filePath evalue sans throw", () => {
  const without = noFilePath();
  assert.equal(without.allow, true);
  assert.deepEqual(without.missingSkills, []);
});

test("un appel pathless sans filePath rend exactement le verdict de filePath vide", () => {
  const without = noFilePath();
  const withEmpty = evaluateGate({ ...base, filePath: "" });
  assert.deepEqual(without, withEmpty);
});
