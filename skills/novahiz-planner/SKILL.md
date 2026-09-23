---
name: novahiz-planner
description: |
  novahiz-planner, the Novahiz pipeline orchestrator. CATEGORY-AWARE and
  BLOCKING: no non-trivial work starts without a written plan.
  The pipeline runs six steps in order: plan, clarification, tasks, analysis,
  implementation, convergence, each one behind its own skill.
  Use at the START of any request with 3+ steps, several files, or an unclear scope.
  Triggers on: multi-step tasks, feature implementation, refactoring, debugging sessions,
  migrations, architecture work, "plan this", "break this down", "where do I start".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-planner: pipeline orchestrator

You open the work. Every non-trivial task follows the same sequence.

## Entry law

```
IF the category is neither research nor general AND no task is open:
  -> STOP. No edits, no commands.
  -> Open the pipeline, then execute.
```

## The pipeline

| # | Step | Skill | Produces | Closes when | Writes? |
|---|---|---|---|---|---|
| 1 | Plan | `novahiz-plan` | direction, scope, dependency order, splitting strategy, risks | the plan holds and the user has seen it | no |
| 2 | Clarification | `novahiz-clarify` | ambiguity families, question batches, locked decisions | open items no longer change architecture, data, tasks, tests, UX, or operations | no |
| 3 | Tasks | `novahiz-task` | atomic tasks with acceptance criteria and proof | every task has criteria and proof, and the order holds | ledger only |
| 4 | Analysis | `novahiz-analyse` | files, symbols, data paths, unknowns | the useful scope is understood and unknowns are named | no |
| 5 | Implementation | `novahiz-implement` | increments that keep the system usable | slices are complete and green | yes |
| 6 | Convergence | `novahiz-converge` | intent inventory, classified gap, traced remainders | the open list is empty or explicitly accepted | ledger only |

Two back-loops exist: clarification returns to plan when an answer changes architecture; convergence returns to tasks when a remainder shows up.

## What the gate actually enforces

The gate (see `novahiz-gate`) blocks only on steps of kind `skill`. In the `code` roadmap, those steps are `novahiz-plan`, `novahiz-clarify`, `novahiz-task`, `novahiz-analyse`, and `novahiz-code-review`. Steps `implement` and `converge` appear in `requiredSkills` yet refuse no edits.

Practical consequence: if implementation or convergence never happens, nothing mechanically stops you. The pipeline holds when agents follow it; steps 5 and 6 are not gate-blocked.

## Read-only

Steps 1, 2, and 4 modify no files. Step 3 writes only to the execution ledger. Code writing begins at step 5.

## The 15 categories

code, debug, review, audit, test, research, browser, design-ui, database-supabase, docs-writing, planning, devops, data, assessment, general.

The full pipeline applies to `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`. `review`, `audit`, and `test` keep their business steps and end with convergence. `assessment` keeps its own domain steps and ends with a go/no-go decision. `research` and `general` enforce no steps.

## Additional steps by category

| Category | Pipeline 1 to 6 | Code review | Memory | Audit | Next steps |
|---|---|---|---|---|---|
| `code` | yes | yes | yes | yes | yes |
| `debug` | yes | yes | yes | yes | yes |
| `database-supabase` | yes | yes | yes | yes | yes |
| `browser` | yes | no | yes | yes | yes |
| `design-ui` | yes | no | yes | yes | yes |
| `planning` | yes | no | yes | yes | yes |
| `devops` | yes | no | yes | yes | yes |
| `data` | yes | no | yes | yes | yes |
| `assessment` | domain steps | no | yes | yes | yes |
| `review` | business steps | yes | yes | yes | yes |
| `audit` | business steps | no | yes | yes | yes |
| `test` | business steps | no | yes | yes | yes |
| `docs-writing` | no | no | yes | yes | yes |
| `research` | no | no | no | no | yes |
| `general` | no | no | yes | yes | yes |

## Cross-cutting rules

- **Choices through the interface**: every user-facing decision runs through the `question` tool. Interactive table, options described by consequence, recommended option first. No prose questions or confirmation requests in chat. Chat carries context and content; the interface carries choices.
- **humanizer** on all prose: text, documentation, interface messages, comments.
- **anti-AI-design** / catalog design skills on everything that touches visual style.
- **Supabase skills** (`supabase`, `supabase-postgres-best-practices`) on the `database-supabase` category.
- **Honesty**: no claimed execution without real output. Uncertainty gets stated.
- **Critique**: an inconsistent, ambiguous, risky, or weak request gets challenged, with an alternative on the table.
- **Next steps**: at the end, a useful next step is proposed, even when the useful step is to do nothing.
- **Memory**: the end of a complex task goes through `novahiz-memory`.

## Blocking behavior

When no task is open and the category is neither `research` nor `general`:

1. STOP: no edits, no commands.
2. ANALYZE: `novahiz_classify` then `novahiz_roadmap` provide the category and steps.
3. PIPELINE: open the steps in order, starting with the plan.
4. WRITE: `novahiz_task action="new"` then `action="plan"`, and `todowrite` for visible tracking.
5. PRESENT: for complex tasks, show the plan before executing.
6. EXECUTE: one `in_progress` step at a time, real-time updates, `done` only with proof.
7. CLOSE: `novahiz-converge`, then `novahiz-audit`.

## User override

If the user says "do it without a plan" or "no plan needed":

1. create a minimal one-step task;
2. warn: "Minimal plan created. Future tasks will receive a full plan.";
3. keep the override visible for audit.
