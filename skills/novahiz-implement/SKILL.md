---
name: novahiz-implement
description: |
  novahiz-implement, step 5 of the Novahiz pipeline: write code in increments
  that leave the system usable. The cycle runs implement, test, verify, commit, then the
  next slice, under rules of simplicity, scope discipline, safe defaults, and reversibility.
  Use when writing or changing code for an approved task.
  Triggers on: implement, code, write the code, add the endpoint, build the component,
  apply the change, make the test pass.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-implement: write in clean increments

**Step 5 of 6** in the pipeline. You write what the task asks. Scope creep has no place here.

Previous: `novahiz-analyse`. Next: `novahiz-converge`.

## Increment cycle

```
implement -> test -> verify -> commit -> next slice
```

Each slice starts from the previous one. When it lands, the system compiles and the tests pass.

## Open and close the step

```
novahiz_task action="start" id="<todo>"
... work ...
novahiz_task action="done"  id="<todo>" proof="<command and result>"
```

`done` on a step of kind `verify` needs proof. Missing proof keeps the step open.

## Choose the first slice

- Vertical by default: it crosses layers and shows up working end to end.
- Contract-first: freeze types and interfaces, then both sides advance together.
- Risk-first: prove the least certain piece.

## The gate will trigger

Writing code fires rules. On frontend design work, R13 requires `novahiz-humanizer`, `ui-slop-remover` and `ui-craft-rules`, and R14 requires `impeccable` (critique/audit/polish playbooks). Outside design, those skills are not required by the gate. Load design skills before writing, ahead of the refusal.

## Writing rules

**Simplicity.** Ask what the simplest thing that could work looks like. Fewer lines. An abstraction must earn its complexity. Three similar lines beat a premature abstraction. Write the naive and obviously correct version, then optimize once tests prove the behavior.

**Scope.** Touch only what the task requires. No cleanup of adjacent code, no import refactoring in other files, no deletion of a comment you misunderstood, no out-of-scope feature. What you notice without touching it gets logged "seen but untouched" and turns into a proposal: `novahiz_task action="insert"`, never a surprise modification.

**One thing at a time.** No component refactor and build config change in the same step.

**Keep compilable.** Build and existing tests pass after each increment.

**Safe defaults.** New behavior is opt-in with a conservative value. An absent option defaults to false.

**Reversible.** Prefer additive changes and minimal modifications. Migrations must roll back. Never delete and replace in the same commit.

## Confirm before irreversible

Any action that destroys data, breaks compatibility, or cannot be undone goes through the `question` tool first. Options stay concrete: proceed, back up first, abort. A migration with no rollback and a data deletion both live here. The green light gets asked for, and it is never assumed.

## Never invent

Do not write an API, function, or import whose existence you have not verified. Two real sources: the code itself, and the installed version's documentation via `context7`. A presumed symbol turns into debt on the spot.

## When proof is red

Fix it, or block the step with `novahiz_task action="block"` and a reason. Do not mask a test by disabling it, and do not slip past a failure with a silent error block.

## Categories involved

The implementation step appears in `code`, `flutter`, `debug`, `test`, `design-ui`, `database-supabase`, `devops`, and `data`.

## Exit

Each increment produces the modified files, the executed proof, and its result. Move to `novahiz-converge` once the slices are complete.
