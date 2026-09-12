import { test } from "node:test";
import assert from "node:assert/strict";
import { grantsQuestionIn } from "../src/commands/doctor.ts";

test("grantsQuestionIn reads the agent permission block", () => {
  assert.equal(grantsQuestionIn("permission:\n  question: allow\n"), true);
  assert.equal(grantsQuestionIn("permission:\n  question: deny\n"), false);
  assert.equal(grantsQuestionIn("mode: primary\ntemperature: 0.2\n"), false);
});

test("grantsQuestionIn is not fooled by a comment about the setting", () => {
  const agent = "# opencode denies question by default\npermission:\n  question: deny\n";
  assert.equal(grantsQuestionIn(agent), false);
});
