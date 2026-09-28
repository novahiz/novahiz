---
name: novahiz-converge
description: |
  novahiz-converge, step 6 of the Novahiz pipeline: close the gap between intent
  and code. Build the intent inventory (request, plan, acceptance criteria, ledger steps,
  project principles), read the current code state, classify each element as satisfied,
  partial, or unsatisfied, then add the remainders as traced steps. Add-only: rewrite
  nothing, delete no step, touch no code.
  Use at the end of an implementation, before declaring work done.
  Triggers on: "is it done?", verify the feature, convergence, gap analysis,
  "what remains", closure.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-converge: close the gap

**Step 6 of 6** in the pipeline. It runs after implementation. It never runs during it.

Previous: `novahiz-implement`.

## Do not confuse with audit

`novahiz-converge` measures the distance between what was requested and what the code does. `novahiz-audit` measures whether the session followed the rules. One is about the work; the other is about the method.

## Intent source

Intent comes from artifacts, never from your memory:

- the original request,
- the plan,
- task acceptance criteria,
- the execution ledger: `novahiz_task action="status"` and `action="signals"`,
- project principles, starting with `AGENTS.md`.

Assemble the inventory: every identified element you can trace.

## Evaluation

Read the current state of the code, with no interest in git, branch, or history. You grade what the code does now.

Classify each element:

- **satisfied**: the code does what was asked, and the proof shows it.
- **partial**: part holds; the rest is missing or unproven.
- **unsatisfied**: nothing covers the element.

A closed step without proof never counts as satisfied, whatever the ledger says about `done`.

## Add-only writing

- The only permitted writing is adding remainders to the ledger, each one a traced step: `novahiz_task action="insert"`.
- The plan, the criteria, and the existing steps stay as they are.
- No step gets renamed, renumbered, reordered, or deleted.
- Acceptance of open remainders goes through the `question` tool: accept them, handle them now, or trace them for later. A remainder without explicit acceptance keeps the closure open.
- Application code stays untouched.

When everything is satisfied, you write nothing and report a clean result. An empty report is not a clean result.

## Severity

A violation of a MUST principle in `AGENTS.md` sits at the top level and produces a remediation step. When principles are absent, say so and continue.

## Closure

Report three lists: what is satisfied and proven, what remains open, what could not be evaluated and why. The work ends when the open list is empty or when the user explicitly accepts the remainders.

## Categories involved

The convergence step appears in `code`, `flutter`, `expo`, `debug`, `test`, `audit`, `browser`, `design-ui`, `database-supabase`, `docs-writing`, `planning`, `devops`, and `data`.

## Pitfalls

- Calling satisfied what was never executed.
- Reading "the step is checked" as "the behavior exists".
- Rewriting the plan so it matches the result you got.
