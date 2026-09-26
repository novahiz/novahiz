import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRepairDirective, parseGateFailure } from "../src/gate-repair.ts";

test("parses a structured FAIL payload", () => {
  const failure = parseGateFailure(
    JSON.stringify({
      allow: false,
      tool: "edit",
      missingSkills: ["novahiz-implement", "code-standards"],
      reasons: ["missing skill: novahiz-implement", "missing skill: code-standards"]
    })
  );
  assert.ok(failure);
  assert.equal(failure.tool, "edit");
  assert.deepEqual(failure.missingSkills, ["novahiz-implement", "code-standards"]);
  assert.equal(failure.reasons.length, 2);
  assert.equal(failure.error, null);
});

test("returns null for unparseable or malformed payloads", () => {
  assert.equal(parseGateFailure("not json"), null);
  assert.equal(parseGateFailure('"just a string"'), null);
  assert.equal(parseGateFailure("null"), null);
  const failure = parseGateFailure(JSON.stringify({ allow: false, missingSkills: "oops" }));
  assert.ok(failure);
  assert.deepEqual(failure.missingSkills, []);
  assert.equal(failure.tool, "tool");
});

test("attempt 1 builds the load-then-retry protocol", () => {
  const directive = buildRepairDirective(
    { tool: "edit", missingSkills: ["novahiz-plan", "novahiz-implement"], reasons: [], error: null },
    1
  );
  assert.match(directive, /AUTO-REPAIR/);
  assert.match(directive, /skill\(\{name:"novahiz-plan"\}\)/);
  assert.match(directive, /skill\(\{name:"novahiz-implement"\}\)/);
  assert.match(directive, /retry this exact edit call/i);
  assert.match(directive, /continue the user's task/);
  assert.match(directive, /Never bypass the gate/);
  // The directive must not offer an escape hatch as a remedy.
  assert.doesNotMatch(directive, /NOVAHIZ_GATE=off/);
});

test("attempt 2 escalates to diagnosis instead of looping", () => {
  const directive = buildRepairDirective(
    { tool: "write", missingSkills: ["novahiz-plan"], reasons: [], error: null },
    2
  );
  assert.match(directive, /AUTO-REPAIR FAILED on attempt 2/);
  assert.match(directive, /novahiz doctor/);
  assert.match(directive, /novahiz sync/);
  assert.match(directive, /report that honestly to the user and stop/);
  assert.doesNotMatch(directive, /NOVAHIZ_GATE=off/);
});

test("a block with no missing skills states the rule instead of a repair loop", () => {
  const directive = buildRepairDirective(
    { tool: "bash", missingSkills: [], reasons: ["placeholder file"], error: null },
    1
  );
  assert.match(directive, /Blocked by rule, not by a missing skill: placeholder file/);
  assert.doesNotMatch(directive, /skill\(\{/);
});

test("a structured error field wins over empty reasons", () => {
  const directive = buildRepairDirective(
    { tool: "edit", missingSkills: [], reasons: [], error: "loadSpec failed: corrupt" },
    1
  );
  assert.match(directive, /loadSpec failed: corrupt/);
});
