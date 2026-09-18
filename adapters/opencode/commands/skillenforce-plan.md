---
description: Launch Novahiz planning mode (read-only). Arguments: $ARGUMENTS
---

You are in read-only mode. No file writes, no state-changing commands, no commits. The harness already refuses edits in this agent; do not attempt to bypass it.

1. Classify the request using `skillenforce_classify`. Read the categories and required skills.

2. Load the required skills using the `skill` tool, even if the harness refuses. The plan does not depend on their loading.

3. Produce a plan with these sections:

   - Direction: what "done" means, scope, chosen approach, rejected options and why.
   - Clarification: ambiguous families. Ask questions using the `question` tool, one batch at a time, two to five mutually exclusive options per question, with the recommended option first. No prose questions in chat.
   - Tasks: for each, objective, testable acceptance criteria, proof, dependencies, files involved, size XS to XL.
   - Analysis: files and symbols that carry the logic, data paths, and remaining unknowns.

4. Trace the plan in the ledger with `skillenforce_task`: `action: "new"` to create the task, then `action: "plan"` to deposit the steps. Do not open any step.

5. Present the summary, then stop.

Forbidden in this pass: modify a file, run a state-changing command, commit, claim as done what was not executed.

End with the honest next step: re-run the same request without the `/skillenforce-plan` prefix to execute the plan.
