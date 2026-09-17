---
name: novahiz-implement
description: |
  Step 5 of the Novahiz pipeline: write code in increments that leave the system usable.
  Cycle: implement, test, verify, commit, next slice.
  Rules of simplicity, scope discipline, safe defaults, and reversibility.
  Use when writing or changing code for an approved task.
  Triggers on: implement, code, write the code, add the endpoint, build the
  component, apply the change, make the test pass.
license: MIT
compatibility: opencode
---

# novahiz-implement: write in clean increments

**Step 5 of 6** in the pipeline. You write what the task asks, no more, no less.

Previous step: `novahiz-analyse`. Next step: `novahiz-converge`.

## Increment cycle

```
implement -> test -> verify -> commit -> next slice
```

Do not start from scratch at each slice. Each slice leaves a system that compiles and whose tests pass.

## Open and close the step

```
novahiz_task action="start" id="<todo>"
... work ...
novahiz_task action="done"  id="<todo>" proof="<command and result>"
```

`done` on a step of kind `verify` requires proof. Without proof, the step stays open.

## Choose the first slice

- Vertical by default: it crosses layers to be observable end-to-end.
- Contract-first: freeze types and interfaces, then both sides advance in parallel.
- Risk-first: prove the least certain piece.

## The gate will trigger

Writing code fires rules: R1-code-prose requires `humanizer` when the content carries prose (comments, messages, labels); R2 requires `impeccable` when a style file is touched. Load them before writing, not after the refusal.

## Writing rules

**Simplicity.** What is the simplest thing that could work? Fewer lines. An abstraction must earn its complexity. Three similar lines are better than a premature abstraction. Write the naive and obviously correct version, then optimize after proof by tests.

**Scope.** Touch only what the task requires. No adjacent code cleanup, no import refactoring of other files, no deletion of an misunderstood comment, no out-of-scope feature. What you see without touching it is noted "seen but untouched" and becomes a proposal: `novahiz_task action="insert"`, never a surprise modification.

**One thing at a time.** No component refactor plus build config in the same step.

**Keep compilable.** The build and existing tests pass after each increment.

**Safe defaults.** New behavior is opt-in, conservative value. An absent option defaults to false.

**Reversible.** Additive changes, minimal modifications, rollback-capable migration, and never delete-then-replace in the same commit.

## Confirm before irreversible

An action that destroys data, breaks compatibility, or cannot be undone goes through the `question` tool before being launched. Options are concrete: proceed, back up first, abort. A no-rollback migration and a data deletion are in this category. The green light is asked, never assumed.

## Never invent

Do not write an API, function, or import whose existence you have not verified. Three real sources: the code itself, the installed version's documentation via `context7`, and the `zero-hallucination-coder` skill. A presumed symbol becomes immediate debt.

## When proof is red

Fix it, or block the step with `novahiz_task action="block"` and a reason. Do not mask a test by disabling it, and do not bypass a failure with a silent error block.

## Categories involved

The implementation step appears in `code`, `debug`, `test`, `design-ui`, `database-supabase`, `devops`, and `data`.

## Exit

Each increment produces the modified files, the executed proof, and its result. Move to `novahiz-converge` when the slices are complete.
