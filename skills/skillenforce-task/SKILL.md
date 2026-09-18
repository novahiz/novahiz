---
name: skillenforce-task
description: |
  Step 3 of the skillenforce pipeline: convert a plan into atomic, ordered, verifiable tasks.
  Each task carries an objective, testable acceptance criteria, proof, dependencies,
  owned files, and size (XS to XL).
  Use when a plan must become an ordered task list, or when work must be split across
  sessions or agents.
  Triggers on: "break down", task list, todo, subtasks, acceptance criteria,
  prioritization, "what do I start with".
license: MIT
compatibility: opencode
---

# skillenforce-task: split into verifiable tasks

**Step 3 of 6** in the pipeline. The plan says where we go; this step says by what steps, in what order, and how each step closes.

Previous step: `skillenforce-clarify`. Next step: `skillenforce-analyse`.

## Task contract

All tasks take the same shape. A task without acceptance criteria and proof remains an intention.

```markdown
## Task N: <short title, imperative mood>

Objective: one sentence.
Acceptance criteria:
- [ ] testable condition
- [ ] testable condition
Proof: the command, test, or observation that closes the task
Depends on: #A, #B (or None)
Files involved: path/a, path/b
Size: XS | S | M | L | XL
```

## The ledger rejects a `verify` step without proof

`skillenforce_task` enforces this rule: a step of kind `verify` cannot close without `proof`. Proof is decided at plan time, not at doubt time.

| Action | Usage |
|---|---|
| `plan` | deposit the full list at once |
| `todo` | add a step (`kind`: read, edit, verify, delegate) |
| `start` / `done` | open, close (`done` requires `proof` on a verify step) |
| `block` | block, with `reason` |
| `review` | revise the plan between steps |
| `amend` / `insert` / `drop` / `reorder` | fix the list without rewriting it |
| `signals` / `status` / `resume` | read state |

## Size

| Size | Files | Example |
|---|---|---|
| XS | 1 | add a validation rule |
| S | 1 to 2 | one endpoint |
| M | 3 to 5 | one complete flow |
| L | 5 to 8 | feature touching multiple components |
| XL | 8 and above | must be split, no exception |

Split again if the work exceeds one focused session, if criteria do not fit in three bullets, if two independent subsystems are touched, or if the title contains "and". That "and" signals two tasks glued together.

## Order

- Dependencies first.
- Each task leaves the system functional.
- Risky tasks go early: failing fast costs less.
- One checkpoint every two or three steps. It serves to prove, then to decide whether to continue, fix, or abort.

## Categories that require this step

`code`, `browser`, `design-ui`, and `planning`.

## Discipline

- One `in_progress` step at a time.
- Real-time updates, no batch completion.
- `completed` only after verification, never based on intention.
- A blocked step stays `in_progress` and a follow-up task describes the blockage.
- Reuse the user's vocabulary exactly: commands, options, arguments, order.

## Plan conflict

Before writing, check whether an open plan exists. Same work: update in place. Different work: stop, and present the decision through the `question` tool (resume, replace, create alongside), never in prose. Never delete, overwrite, or rename an open plan on your own initiative.

## Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll see as I go" | that is how you get entanglement and rework |
| "the tasks are obvious" | write them: writing reveals dependencies and forgotten edge cases |
| "planning is wasted time" | planning is part of the work |
| "I'll keep it all in context" | the context window is finite; a written plan survives sessions |
| "the old plan is stale" | unchecked tasks carry state that exists nowhere else |

## Red flags

- Implementation started without a task list
- Task "implement the feature" without acceptance criteria
- Plan without a verification step
- All tasks in XL
- No checkpoints
- Dependency order ignored
- Plan overwritten without confirmation
