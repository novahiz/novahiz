# PR review worksheet

Copy into the review or keep beside the checklist in SKILL.md.

## Change

- Title / ticket:
- Surface touched (api, ui, data, infra):
- ASVS level targeted (1 / 2 / 3):

## Blocking

| Finding | Evidence (file:line) | Fix direction |
|---|---|---|
| | | |

## Non-blocking (nit)

- 

## Security spot-check

- [ ] Input validated where untrusted data enters
- [ ] Output encoded for the right sink
- [ ] Authz on every new route or mutation
- [ ] No secrets or raw PII in code, tests, or logs
- [ ] Dependencies pinned; lockfile updated if deps changed

## Decision

- [ ] Approve
- [ ] Request changes (list blockers only)
- [ ] Comment (questions, follow-up ticket)

Escalation if disagreement remains after one clarifying round: tech lead or codeowner, same day.
