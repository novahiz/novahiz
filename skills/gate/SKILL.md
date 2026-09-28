---
name: gate
description: |
  gate is the guardian of the Novahiz system. Mandatory check before and after task
  execution: call novahiz_gate, resolve any FAIL, never modify code until it passes.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.1.0"
---

# Novahiz Gate Skill

This skill is mandatory before and after task execution.

1. Call the MCP tool `novahiz_gate`.
2. If the gate fails (FAIL), resolve the displayed rule violations.
3. Never proceed with code modifications until the gate passes.
4. Once validated, execute the plan or move to post-task.

## Auto-repair (automatic, no user interaction)

When a tool call is denied with `Novahiz gate blocked`, the denial carries an
AUTO-REPAIR block. Execute it immediately:

1. Load every skill the block names: `skill({ name: "..." })`.
2. Retry the exact same call once.
3. Continue the user's task where it left off — do not ask the user, do not stop.

If the same skills are still reported missing on the retry, the loads did not
register: run `novahiz doctor`, then report honestly to the user and stop.

The repair never grants the call by itself — only loaded skills turn the gate
green. Never bypass: no `NOVAHIZ_GATE`, no alternate tool, no shell write.

For the full reading of block messages, index semantics, and the escape hatch, load `novahiz-gate`.
