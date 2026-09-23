import { test } from "node:test";
import assert from "node:assert/strict";
import { grantsQuestionIn } from "../src/commands/doctor.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("grantsQuestionIn reads the agent permission block", () => {
  assert.equal(grantsQuestionIn("permission:\n  question: allow\n"), true);
  assert.equal(grantsQuestionIn("permission:\n  question: deny\n"), false);
  assert.equal(grantsQuestionIn("mode: primary\ntemperature: 0.2\n"), false);
});

test("grantsQuestionIn is not fooled by a comment about the setting", () => {
  const agent = "# opencode denies question by default\npermission:\n  question: deny\n";
  assert.equal(grantsQuestionIn(agent), false);
});

test("SKILL_CLI map is documented as intentionally empty", () => {
  // Doctor's external-CLI check is a no-op while web-extract replaced defuddle.
  const doctor = readFileSync(join(import.meta.dirname, "..", "src", "commands", "doctor.ts"), "utf8");
  assert.ok(doctor.includes("const SKILL_CLI: Record<string, string> = {}"));
  assert.ok(doctor.includes("none required (web-extract replaced defuddle)"));
});
