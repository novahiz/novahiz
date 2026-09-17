---
name: novahiz-converge
description: |
  Step 6 of the Novahiz pipeline: close the gap between intent and code.
  Build the intent inventory (request, plan, acceptance criteria, ledger steps,
  project principles), evaluate the current code state, classify each element as
  satisfied, partial, or unsatisfied, and add remainders as traced steps.
  Add-only: rewrite nothing, delete no step, do not touch the code.
  Use at the end of an implementation, before declaring work done.
  Triggers on: "is it done?", verify the feature, convergence, gap analysis,
  "what remains", closure.
license: MIT
compatibility: opencode
---

# novahiz-converge: close the gap

**Step 6 of 6** in the pipeline. It runs after implementation, never during.

Previous step: `novahiz-implement`.

## Do not confuse with audit

`novahiz-converge` measures the gap between what was requested and what the code does. `novahiz-audit` measures session compliance with rules. The first is about work; the second is about method.

## Intent source

Intent comes from artifacts, not from your memory:

- the original request,
- the plan,
- task acceptance criteria,
- the execution ledger: `novahiz_task action="status"` and `action="signals"`,
- project principles, starting with `AGENTS.md`.

Build the inventory: every identified and traceable element.

## Evaluation

Look at the current state of the code. This is not a diff: no git, no branch, no history. You evaluate what the code does now.

Classify each element:

- **satisfied**: the code does what is requested, and the proof shows it.
- **partial**: part holds, the rest is missing or unproven.
- **unsatisfied**: nothing covers the element.

A closed step without proof does not count as satisfied, even if the ledger says `done`.

## Add-only writing

- The only permitted writing is adding remainders to the ledger, each becoming a traced step: `novahiz_task action="insert"`.
- You modify neither the plan, nor the criteria, nor existing steps.
- You rename, renumber, reorder, and delete no step.
- Acceptance of open remainders is asked through the `question` tool: accept the remainders, handle them now, or trace them for later. A remainder not explicitly accepted keeps the closure open.
- You do not touch application code.

If everything is satisfied, you touch nothing and report a clean result. An empty report is not a clean result.

## Severity

A violation of a MUST principle in `AGENTS.md` is the highest level and produces a remediation step. If principles are absent, state it and continue.

## Closure

Report three lists: what is satisfied and proven, what remains open, what could not be evaluated and why. Work is finished when the open list is empty, or when the user explicitly accepts the remainders.

## Categories involved

The convergence step appears in `code`, `debug`, `test`, `audit`, `browser`, `design-ui`, `database-supabase`, `docs-writing`, `planning`, `devops`, and `data`.

## Pitfalls

- Declare as satisfied what was never executed.
- Confuse "the step is checked" with "the behavior exists".
- Rewrite the plan to match the obtained result.
