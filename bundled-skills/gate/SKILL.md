---
name: gate
description: The guard of the skillenforce system
---

# Skillenforce Gate Skill

This skill is MANDATORY before and after executing a task.

1. Call the `skillenforce_gate` MCP tool.
2. If the Gate fails (FAIL), resolve the displayed rule violations.
3. NEVER proceed with code changes until the Gate is PASS.
4. Once validated, you can execute the plan or move to the post-task.
