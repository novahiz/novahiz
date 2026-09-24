---
name: novahiz-audit
description: novahiz-audit performs the end-of-session compliance audit. Category-aware, verifiable state only, no invented compliance logs. Triggers on "audit", "verify", end of session, compliance check, what we forgot.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-audit

End-of-session audit for Novahiz. It only checks the rules for the categories actually encountered during the session. It relies on verifiable state (execution ledger, gate journal, loaded skills, session diff) and never on agent memory.

## When to run

Run at the END of a session, or when the user says "audit", "verify", "compliance check", "what we forgot".

Do not run mid-implementation as a substitute for convergence. `novahiz-converge` measures the gap between request and code; this skill measures session compliance with the Novahiz rules.

## What counts as evidence

| Evidence | Source |
|----------|--------|
| Execution ledger | `novahiz_task action="status"` and `action="signals"` |
| Gate journal | rules that fired during the session (matchedRules) |
| Loaded skills | skills present in the session context |
| Session diff | files actually modified |

Agent memory is never evidence. If a claim cannot be traced to one of the four sources above, it is marked unverifiable, not satisfied.

## Procedure

1. **Detect categories.** Collect every category flagged during the session (gate reports, primary category, secondary ones). Add `general` as a fallback when nothing else applies.
2. **Load the rule set.** Read the rules for each detected category from `catalog/rules.json` and the non-optional roadmap steps from `catalog/categories.json`.
3. **Check each rule** against the four evidence sources. Status is one of:
   - `satisfied`: evidence exists and matches the rule.
   - `missing`: no evidence found.
   - `unverifiable`: evidence source unavailable; say why.
   - `not_applicable`: the category never required this rule.
4. **Report** three lists: satisfied and proven, still open, not evaluable and why.

## Categories

Fourteen categories are checked when encountered: `code`, `debug`, `review`, `audit`, `browser`, `design-ui`, `database-supabase`, `docs-writing`, `planning`, `devops`, `data`, `test`, `security`, `general`.

`general` carries the rules that apply everywhere (honesty, todo discipline). Design skills (`novahiz-humanizer`, `ui-slop-remover`) are checked only under `design-ui`. A category not in the list falls back to `general` only.

## Rules of the audit

- Never invent a compliance log, a pass, or a proof that was not executed.
- A ledger step closed without proof is not satisfied, even if marked done.
- Missing evidence is reported as missing, not glossed over.
- The audit changes no application code and writes no new ledger steps. Remainders belong to `novahiz-converge`.
- Report findings as they are. A clean result with open items is not a clean result.

## Output

```
## Audit report
Categories: ...
### Satisfied (with evidence)
- ...
### Open
- ...
### Not evaluable
- ... (reason)
```

## Next step

Open items go to the user. Do not auto-fix. Propose which remainders to close now and which to defer.
