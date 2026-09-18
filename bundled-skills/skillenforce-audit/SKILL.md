---
name: skillenforce-audit
description: |
  End-of-session audit for skillenforce. CATEGORY-AWARE: only checks the rules of
  categories actually encountered. Based on verifiable state (execution ledger,
  gate log, loaded skills, session diff) and never on the agent's memory.
  Use at the END of a session, or when the user says "audit" or "check".
  Triggers on: "audit", "verify", end of session, compliance check, "what did I miss".
license: MIT
compatibility: opencode
---

# skillenforce-audit: end-of-session check

You audit from verifiable facts. A checked box from memory is worthless.

## The 14 real categories

code, debug, review, audit, test, research, browser, design-ui, database-supabase, docs-writing, planning, devops, data, general.

`general` is the fallback category. There is no `trivial` category in the catalog.

## What really gets verified

| Check | Proof source | Applies to |
|---|---|---|
| Open plan and ledger | `skillenforce_task status` or `todoread` | all except research |
| Category steps covered | `skillenforce_roadmap --category X` then `skillenforce_step` | all except research and general |
| Required skills loaded | gate log, `enforcement_log` table | all |
| humanizer applied to prose | R1 rules triggered, or skill loaded | docs-writing, code, audit, planning, design-ui |
| impeccable applied to style | R2 rules triggered, or skill loaded | design-ui |
| Code review done | `review` roadmap step, `code-reviewer` skill | code, review, debug |
| Security scan | `scan` step, `security-guidance` skill | audit |
| Proof on verification steps | `skillenforce_task` refuses `done` without `proof` | all |
| Memory updated | `MEMORY.md` plus vault page, via `skillenforce-memory` | all except research |
| No simulation | claims cross-checked with real outputs | all |

## Method

1. Get the primary category and the categories encountered.
2. For each applicable check, find the proof. No proof, no validation.
3. Mark `compliant`, `missing`, or `not applicable`.
4. Score: compliant over applicable, in percent. Below 70%, propose precise fixes. At 90% and above, conclude "compliant session".

## Output

A short report in the conversation:

```
## Session audit
Categories: code, test
| Check | Status | Proof |
|---|---|---|
| Ledger | compliant | 6 steps, 1 blocked |
| humanizer | compliant | loaded before writing |
| Code review | missing | review step not executed |
Score: 67%

## To fix
- Launch code-reviewer on modified files

## To keep
- ...
```

## Pitfalls

- Checking a rule without proof.
- Inventing a compliance log, session file, or validation script: they don't exist in this system.
- Auditing categories that were not encountered.
- Confusing missing proof with compliance.

## Next

What can be fixed gets fixed right away: reload humanizer, launch the review, write the memory. The rest is recorded for the next session.
