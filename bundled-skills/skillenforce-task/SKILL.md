---
name: skillenforce-task
description: |
  Step 3 of the skillenforce pipeline: turn a plan into atomic, ordered, verifiable
  tasks. Each task carries an objective, testable acceptance criteria, proof, its
  dependencies, the files it owns, and its size (XS to XL).
  Use when a plan must become an ordered task list, or when work must be split across
  sessions or agents.
  Triggers on: "break down", task list, todo, sub-tasks, acceptance criteria,
  prioritization, "where do I start".
license: MIT
compatibility: opencode
---

# skillenforce-task: break into verifiable tasks

**Step 3 of 6** in the pipeline. The plan says where we're going; this step says by which steps, in what order, and how each step closes.

Previous step: `skillenforce-clarify`. Next step: `skillenforce-analyse`.

## Task contract

Every task takes the same form. A task without an acceptance criterion and without proof remains an intention.

```markdown
## Task N: <short title, imperative>

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

`skillenforce_task` applies this rule: a step of kind `verify` does not close without `proof`. The proof is therefore decided at planning time, not at the moment of doubt.

| Action | Usage |
|---|---|
| `plan` | deposit the full list at once |
| `todo` | add a step (`kind`: read, edit, verify, delegate) |
| `start` / `done` | open, close (`done` requires `proof` on a verify step) |
| `block` | block, with `reason` |
| `review` | revise the plan between two steps |
| `amend` / `insert` / `drop` / `reorder` | correct the list without rewriting it |
| `signals` / `status` / `resume` | read the state |

## Size

| Size | Files | Example |
|---|---|---|
| XS | 1 | add a validation rule |
| S | 1 to 2 | an endpoint |
| M | 3 to 5 | a complete flow |
| L | 5 to 8 | feature touching multiple components |
| XL | 8 and above | must be split, no exception |

Split further if the work exceeds a tracked session, if the criteria don't fit in three bullets, if two independent subsystems are affected, or if the title contains "and". That "and" signals two tasks stuck together.

## Order

- Dependencies first.
- Each task leaves the system working.
- Risky tasks go early: failing quickly costs less.
- A checkpoint every two or three steps. It proves, then decides whether to continue, correct, or abandon.

## Categories that require this step

`code`, `browser`, `design-ui`, and `planning`.

## Discipline

- Only one `in_progress` step at a time.
- Real-time updates, not batch completion.
- `completed` only after verification, never on intention.
- A blocked step stays `in_progress` and a follow-up task describes the block.
- The user's vocabulary is reused exactly: commands, options, arguments, order.

## Plan conflict

Before writing, check whether an open plan exists. Same work: update in place. Different work: stop, and present the decision in the harness `question` tool (continue, replace, create alongside), never in prose. You never delete, overwrite, or rename an open plan on your own initiative.

## Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll see as I go" | that's how you get tangles and rework |
| "the tasks are obvious" | write them: writing reveals forgotten dependencies and edge cases |
| "planning is lost time" | planning is part of the work |
| "I keep it all in my head" | the context window is finite; a written plan crosses sessions |
| "the old plan is outdated" | unchecked tasks carry a state that exists nowhere else |

## Red flags

- implementation launched without a task list
- task "implement the feature" without acceptance criteria
- plan without a verification step
- all tasks in XL
- no checkpoint
- dependency order ignored
- plan overwritten without confirmation
