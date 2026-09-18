---
name: gate
description: The guardian of the skillenforce system
---

# skillenforce Gate Skill

This skill is MANDATORY before and after task execution.

1. Call the MCP tool `skillenforce_gate`.
2. If the gate fails (FAIL), resolve the displayed rule violations.
3. Never proceed with code modifications until the gate passes.
4. Once validated, execute the plan or move to post-task.
