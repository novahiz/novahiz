---
name: skillenforce-converge
description: |
  Step 6 of the skillenforce pipeline: close the gap between intention and code.
  Builds the intention inventory (request, plan, acceptance criteria, ledger steps,
  project principles), evaluates the current code state, classifies each element as
  satisfied, partial, or unsatisfied, and adds the remaining items as tracked steps.
  Add-only: does not rewrite anything, does not delete any step, does not touch the
  application code.
  Use at the end of an implementation, before declaring work done.
  Triggers on: "is it done?", verify feature, convergence, gap analysis,
  "what's left", closure.
license: MIT
compatibility: opencode
---

# skillenforce-converge: close the gap

**Step 6 of 6** in the pipeline. It runs after implementation, never during.

Previous step: `skillenforce-implement`.

## Don't confuse with audit

`skillenforce-converge` measures the gap between what was requested and what the code does. `skillenforce-audit` measures session compliance with rules. The first is about the work; the second is about the method.

## Source of intention

Intention comes from artifacts, not from your memory:

- the initial request,
- the plan,
- the task acceptance criteria,
- the execution ledger: `skillenforce_task action="status"` and `action="signals"`,
- the project principles, starting with `AGENTS.md`.

Build the inventory: each item identified and traceable.

## Evaluation

Look at the current code state. This is not a diff: neither git, nor branch, nor history. You evaluate what the code does now.

Classify each item:

- **satisfied**: the code does what is requested, and the proof shows it.
- **partial**: part holds, the rest is missing or unproven.
- **unsatisfied**: nothing covers the item.

A step closed without proof does not count as satisfied, even if the ledger says `done`.

## Add-only writing

- The only allowed writes are adding remaining items to the ledger, each becoming a tracked step: `skillenforce_task action="insert"`.
- You do not modify the plan, the criteria, or existing steps.
- You do not rename, renumber, reorder, or delete any step.
- Acceptance of the open remainder is requested through the harness `question` tool: accept the remainder, handle it now, or track it for later. A remainder not explicitly accepted keeps the closure open.
- You do not touch the application code.

If everything is satisfied, you touch nothing and report a clean result. An empty report is not a clean result.

## Severity

A violation of an `AGENTS.md` MUST principle is the highest level and produces a remediation step. If the principles are missing, say so and continue.

## Closure

Report three lists: what is satisfied and proven, what remains open, and what could not be evaluated and why. The work is finished when the open list is empty, or when the user explicitly accepts the remainder.

## Categories involved

The convergence step appears in `code`, `debug`, `test`, `audit`, `browser`, `design-ui`, `database-supabase`, `docs-writing`, `planning`, `devops`, and `data`.

## Pitfalls

- Declaring satisfied what was never executed.
- Confusing "step is checked" with "behavior exists".
- Rewriting the plan so it matches the result obtained.
