---
name: skillenforce-audit
description: |
  End-of-session audit for skillenforce. CATEGORY-AWARE: only checks rules for
  categories actually encountered. Relies on verifiable state (execution ledger,
  gate journal, loaded skills, session diff) and never on agent memory.
  Use at the END of a session, or when the user says "audit" or "verify".
  Triggers on: "audit", "verify", end of session, compliance check, what we forgot.
license: MIT
compatibility: opencode
---

# skillenforce-audit: end-of-session check

Audit from verifiable facts. A memory-check has no value.

## The 14 real categories

code, debug, review, audit, test, research, browser, design-ui, database-supabase, docs-writing, planning, devops, data, general.

`general` is the fallback category. There is no `trivial` category in the catalog.

## What is actually checked

| Check | Proof source | Applies to |
|---|---|---|
| Plan and ledger open | `skillenforce_task status` or `todoread` | all except research |
| Category steps traversed | `skillenforce_roadmap --category X` then `skillenforce_step` | all except research and general |
| Required skills loaded | gate journal, `enforcement_log` table | all |
| humanizer applied on prose | R1 rules triggered, or skill loaded | docs-writing, code, audit, planning, design-ui |
| impeccable applied to style | R2 rules triggered, or skill loaded | design-ui |
| Code review done | `review` step in roadmap, `code-reviewer` skill | code, review, debug |
| Security scan | `scan` step, `security-guidance` skill | audit |
| Proof on verification steps | `skillenforce_task` rejects `done` without `proof` | all |
| Memory up to date | `MEMORY.md` plus vault page, via `skillenforce-memory` | all except research |
| No simulation | claims cross-checked with real outputs | all |

## Method

1. Retrieve the primary category and encountered categories.
2. For each applicable check, look for proof. No proof, no pass.
3. Mark `compliant`, `missing`, or `not applicable`.
4. Score: compliant over applicable, as percentage. Below 70%, propose precise fixes. At 90% and above, conclude "session compliant".

## Exit

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
- Run code-reviewer on modified files

## To remember
- ...
```

## Pitfalls

- Check a rule without proof.
- Invent a compliance log, session file, or validation script: they do not exist in this system.
- Audit categories that were not encountered.
- Confuse absence of proof with compliance.

## Next

What can be fixed is fixed now: reload humanizer, run the review, write the memory. The rest is logged for the next session.
