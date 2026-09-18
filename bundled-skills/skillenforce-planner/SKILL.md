---
name: skillenforce-planner
description: |
  Skillenforce pipeline orchestrator. CATEGORY-AWARE and BLOCKING: no non-trivial
  work starts without a written plan. The pipeline follows six steps in order:
  plan, clarification, tasks, analysis, implementation, convergence. Each step has
  its dedicated skill.
  Use at the START of any request with 3+ steps, several files, or an unclear scope.
  Triggers on: multi-step tasks, feature implementation, refactoring, debugging sessions,
  migrations, architecture work, "plan this", "break this down", "where do I start".
license: MIT
compatibility: opencode
---

# skillenforce-planner: pipeline orchestrator

You open the work. Every non-trivial task follows the same sequence.

## Entry rule

```
IF the category is neither research nor general AND no task is open:
  -> STOP. No edits, no commands.
  -> Open the pipeline, then execute.
```

## The pipeline

| # | Step | Skill | Produces | Closes when | Writes? |
|---|---|---|---|---|---|
| 1 | Plan | `skillenforce-plan` | direction, scope, dependency order, splitting strategy, risks | the plan holds and the user has seen it | no |
| 2 | Clarification | `skillenforce-clarify` | ambiguity families, question batches, settled decisions | open items no longer change architecture, data, tasks, tests, UX, or operations | no |
| 3 | Tasks | `skillenforce-task` | atomic tasks with acceptance criteria and proof | each task has a criterion and proof, and the order holds | ledger only |
| 4 | Analysis | `skillenforce-analyse` | files, symbols, data paths, unknowns | useful scope is understood and unknowns are named | no |
| 5 | Implementation | `skillenforce-implement` | increments that keep the system usable | slices are finished and green | yes |
| 6 | Convergence | `skillenforce-converge` | intention inventory, classified gap, tracked remains | open list is empty or explicitly accepted | ledger only |

Two planned backtracks: clarification sends back to the plan when an answer changes the architecture; convergence sends back to tasks when a remainder appears.

## What the gate really applies

The gate (see `skillenforce-gate`) only blocks on `skill` kind steps. In the `code` roadmap, those are `skillenforce-plan`, `skillenforce-clarify`, `skillenforce-task`, `skillenforce-analyse`, and `code-reviewer`. `implement` and `converge` are in `requiredSkills` but do not refuse any edit.

Practical consequence: if implementation or convergence does not happen, nothing mechanically prevents it. The pipeline holds also because it is followed, not only because it is programmed.

## Read-only

Steps 1, 2, and 4 modify no files. Step 3 writes only to the execution ledger. Code writing starts at step 5.

## The 14 categories

code, debug, review, audit, test, research, browser, design-ui, database-supabase, docs-writing, planning, devops, data, general.

The full pipeline applies to `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`. `review`, `audit`, and `test` keep their domain steps and end with a convergence. `research` and `general` impose no steps.

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
| `review` | domain steps | yes | yes | yes | yes |
| `audit` | domain steps | no | yes | yes | yes |
| `test` | domain steps | no | yes | yes | yes |
| `docs-writing` | no | no | yes | yes | yes |
| `research` | no | no | no | no | yes |
| `general` | no | no | yes | yes | yes |

## Cross-cutting rules

- **Choice by interface**: every decision presented to the user goes through the harness `question` tool. Interactive table, options described by consequence, recommended option first. No questions or confirmation requests in prose in chat. The chat carries context and content; the interface carries choices.
- **humanizer** on all prose: texts, documentation, interface messages, comments.
- **impeccable** on anything touching visual style.
- **Supabase skills** (`supabase`, `supabase-postgres-best-practices`) on the `database-supabase` category.
- **Honesty**: no execution claimed without real output. Uncertainty is stated.
- **Criticism**: an incoherent, ambiguous, risky, or suboptimal request is challenged, with an alternative.
- **Next step**: at the end, a useful next step is proposed, even if it's to do nothing.
- **Memory**: the end of a complex task goes through `skillenforce-memory`.

## Blocking behavior

When no task is open and the category is neither `research` nor `general`:

1. STOP: no edits, no commands.
2. ANALYZE: `skillenforce_classify` then `skillenforce_roadmap` give the category and steps.
3. PIPELINE: open the steps in order, starting with the plan.
4. WRITE: `skillenforce_task action="new"` then `action="plan"`, and `todowrite` for visible tracking.
5. PRESENT: for a complex task, show the plan before executing.
6. EXECUTE: one `in_progress` step at a time, real-time updates, `done` only with proof.
7. CLOSE: `skillenforce-converge`, then `skillenforce-audit`.

## User override

If the user says "do it without a plan" or "no plan needed":

1. create a minimal single-step task;
2. warn: "Minimal plan created. Next tasks will receive a full plan.";
3. keep the override visible for audit.
