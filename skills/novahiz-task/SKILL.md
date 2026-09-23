---
name: novahiz-task
description: |
  novahiz-task, step 3 of the Novahiz pipeline: cut a plan into atomic, ordered,
  verifiable tasks. Every task carries an objective, testable acceptance criteria, proof,
  dependencies, the files it owns, and a size from XS to XL.
  Use when a plan has to become an ordered list, or when the work spans several sessions
  or several agents.
  Triggers on: "break down", task list, todo, subtasks, acceptance criteria,
  prioritization, "what do I start with".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-task: split into verifiable tasks

**Step 3 of 6** in the pipeline. The plan sets the destination. This step sets the stages, their order, and the way each one shuts.

Previous: `novahiz-clarify`. Next: `novahiz-analyse`.

## Task contract

Every task takes the same frame. Without acceptance criteria and proof, it remains a wish.

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

## The ledger refuses a `verify` step that carries no proof

`novahiz_task` holds the line: a step of kind `verify` cannot close without `proof`. You fix the proof when you write the plan, not when doubt shows up.

| Action | Usage |
|---|---|
| `plan` | deposit the full list at once |
| `todo` | add a step (`kind`: read, edit, verify, delegate) |
| `start` / `done` | open and close (`done` needs `proof` on a verify step) |
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

Split again when the work runs past one focused sitting, when the criteria overflow three bullets, when two independent subsystems are in play, or when the title contains "and". That word usually means two tasks glued together.

## Order

- Dependencies come first.
- Every task leaves the system in a working state.
- Dangerous tasks go early: failing sooner costs less.
- One checkpoint every two or three steps. Its job is to prove progress, then to decide between continuing, fixing, or stopping.

## Categories that require this step

`code`, `browser`, `design-ui`, and `planning`.

## Discipline

- One `in_progress` step at a time.
- Update as things change; no batch closings at the end.
- `completed` follows verification and nothing else.
- A blocked step stays `in_progress`, and a follow-up task records the blockage.
- Keep the user's own words: commands, options, arguments, order.

## Plan conflict

Before you write, check for an open plan. Same work: revise it where it stands. Different work: stop, then offer the choice through the `question` tool (resume, replace, or open alongside), in the interface and never in prose. An open plan never gets deleted, overwritten, or renamed on your own initiative.

## Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll see as I go" | you get tangled work and rework |
| "the tasks are obvious" | writing them exposes dependencies and forgotten edge cases |
| "planning is wasted time" | planning is part of the work |
| "I'll keep it all in context" | context windows are finite; a written plan outlives the session |
| "the old plan is stale" | unchecked tasks hold state that exists nowhere else |

## Red flags

- Implementation started before a task list exists
- A task like "implement the feature" with no acceptance criteria
- A plan without a verification step
- Every task sitting at XL
- No checkpoints
- Dependency order ignored
- Plan overwritten without confirmation
