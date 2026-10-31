import assert from "node:assert/strict";
import test from "node:test";

import { TASK_ACTIONS, TASK_TOOL } from "../mcp/novahiz-tools/index.mjs";

/**
 * NX-39 : le schéma MCP, la description de l'outil et la liste acceptée par le
 * handler doivent dire la même chose. Avant ce correctif, la description
 * omettait `history` alors que l'enum et le handler l'acceptaient.
 */

test("l'enum du schéma est exactement la liste des actions", () => {
  const enumActions = TASK_TOOL.inputSchema.properties.action.enum;
  assert.deepEqual(enumActions, TASK_ACTIONS);
});

test("la description annonce chaque action", () => {
  for (const action of TASK_ACTIONS) {
    assert.match(
      TASK_TOOL.description,
      new RegExp(`\\b${action}\\b`),
      `action absente de la description : ${action}`,
    );
  }
});

test("les actions sont uniques et non vides", () => {
  assert.equal(new Set(TASK_ACTIONS).size, TASK_ACTIONS.length);
  assert.ok(TASK_ACTIONS.every((action: string) => typeof action === "string" && action.length > 0));
});

test("history fait partie du contrat", () => {
  assert.ok(TASK_ACTIONS.includes("history"));
  assert.match(TASK_TOOL.description, /history/);
});
