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
  version: "2.0.0"
---

# Novahiz Gate Skill

This skill is mandatory before and after task execution.

1. Call the MCP tool `novahiz_gate`.
2. If the gate fails (FAIL), resolve the displayed rule violations.
3. Never proceed with code modifications until the gate passes.
4. Once validated, execute the plan or move to post-task.

For the full reading of block messages, index semantics, and the escape hatch, load `novahiz-gate`.
