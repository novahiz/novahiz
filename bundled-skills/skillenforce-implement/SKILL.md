---
name: skillenforce-implement
description: |
  Step 5 of the skillenforce pipeline: write code in increments that leave the system
  usable. Increment cycle: implement, test, verify, commit, next slice. Rules for
  simplicity, scope discipline, safe defaults, and reversibility.
  Use when writing or changing code for an approved task.
  Triggers on: implement, code, write code, add endpoint, build component,
  apply change, pass test.
license: MIT
compatibility: opencode
---

# skillenforce-implement: write in clean increments

**Step 5 of 6** in the pipeline. You write what the task asks for, nothing more, nothing less.

Previous step: `skillenforce-analyse`. Next step: `skillenforce-converge`.

## Increment cycle

```
implement -> test -> verify -> commit -> next slice
```

You do not start from scratch with each slice. Each slice leaves a system that compiles and whose tests pass.

## Open and close the step

```
skillenforce_task action="start" id="<todo>"
... work ...
skillenforce_task action="done"  id="<todo>" proof="<command and result>"
```

`done` on a `verify` step requires proof. Without proof, the step stays open.

## Choose the first slice

- Vertical by default: it crosses layers to be observable end-to-end.
- Contract-first: freeze types and interfaces, then both sides advance in parallel.
- Risk-first: prove the piece whose success is least certain.

## The gate will trigger

Writing code triggers rules: R1 (code + prose) requires `humanizer` as soon as content carries prose (comments, messages, labels), R2 requires `impeccable` as soon as a style file is touched. Load them before writing, not after the refusal.

## Writing rules

**Simplicity.** What's the simplest thing that could work? Fewer lines. An abstraction must earn its complexity. Three similar lines beat premature abstraction. Write the naive, obviously correct version, then optimize after proof from tests.

**Scope.** Only touch what the task requires. No cleanup of adjacent code, no import refactoring in other files, no deletion of an ununderstood comment, no out-of-scope feature. What you see without touching it is noted "seen but untouched" and becomes a proposal: `skillenforce_task action="insert"`, never a surprise change.

**One thing at a time.** No component plus refactor plus build config change in the same step.

**Keep compilable.** The build and existing tests pass after every increment.

**Safe defaults.** New behavior is opt-in, conservative value. A missing option means false.

**Reversible.** Additive changes, minimal modifications, migration with rollback, and never delete-then-replace in the same commit.

## Confirm before irreversible

An action that destroys data, breaks compatibility, or cannot be undone goes through the harness `question` tool before being launched. Options are concrete: run, back up first, abort. A migration without rollback and a data deletion fall under this. Approval is asked for, not assumed.

## Invent nothing

Do not write an API, function, or import whose existence you have not verified. Three real sources: the code itself, the installed version's documentation via `context7`, and the `zero-hallucination-coder` skill. A guessed symbol becomes immediate debt.

## When proof is red

Fix, or block the step with `skillenforce_task action="block"` and a reason. You do not mask a test by deactivating it, and you do not bypass a failure with a silent error block.

## Categories involved

The implementation step appears in `code`, `debug`, `test`, `design-ui`, `database-supabase`, `devops`, and `data`.

## Output

Each increment produces the modified files, the executed proof, and its result. You move to `skillenforce-converge` when the slices are finished.
