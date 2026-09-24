---
name: "code-standards"
description: "Pragmatic engineering standards for production code: deep modules over micro-functions, review bar that improves code health, ASVS-aligned security checks, naming and error handling, test strategy. Use when writing or reviewing application code, setting a team style, or checking a PR against a shared bar. Prefer trade-offs over Clean Code dogma."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# code-standards

A shared bar for code that other people will read and change. Optimize for change cost and debuggability. Line counts and rule purity are secondary.

## Review standard (Google eng-practices shape)

Approve a change when it improves overall code health, even if it is imperfect. Do not block for weeks chasing polish. Technical facts and the style guide beat personal taste.

Blocking:

- Makes the system worse (unclear ownership of a bug fix, silent behavior change without tests).
- Security or data-loss risk with no mitigation in the PR.
- Breaks the agreed style guide where the guide already speaks.

Non-blocking (mark as nit):

- Naming and formatting the guide does not cover.
- “Could be nicer” refactors that belong in a follow-up.
- Educational comments that do not change the decision.

Escalate when author and reviewer disagree after one round. Do not let a PR idle.

## Design: depth over micro-cuts

A module earns its place when a simple interface hides real work (deep module). Splitting every helper into three lines usually creates entanglement: the reader flips between files to understand one path.

- Prefer one clear function that does the job over a constellation of one-liners.
- Extract when the interface is simpler than the body. A length rule alone is a weak reason.
- Duplication that is still evolving may stay until a stable abstraction appears.
- Comments explain contracts and non-obvious why. Restating the function name in a comment is noise.

## Naming and structure

- Names use the problem domain (`postPayment`, not `handleThing3`).
- Command or query: a function does something or answers something. A method that both mutates and returns a “status” confuses every caller.
- Module boundaries match change ownership. Cross-module edits without a contract change are a smell.
- Error handling returns enough context to act. Swallowed exceptions and bare `null` returns hide production incidents.

## Security floor (ASVS-shaped)

Pick an ASVS level per app (L1 minimum, L2 for sensitive data). At every level:

- Validate untrusted input on a trusted server path; encode output for the interpreter that will run it.
- Auth and session checks on every non-public resource; deny by default.
- Secrets never in source; load from a secret store or env injected by the platform.
- Log security-relevant events without writing passwords, tokens, or full PII into logs.
- HTTPS and pinned or well-known trust for outbound calls.

Architecture checks (threat model, trust boundaries) belong in design review as well as in CI.

## Testing bar

- Behavior-changing code ships with tests that fail if the behavior regresses.
- Unit tests are fast, independent, repeatable, self-validating.
- Integration tests cover the seams that unit tests fake (DB, auth, queues).
- Flaky tests are bugs. Quarantine with a ticket or fix; do not re-run until green and forget.

## When style fights the codebase

The style guide wins on covered points. On uncovered points, match existing code unless the change makes health worse. Automate what reviewers keep repeating (linters, formatters); a PR that only argues whitespace is a tooling gap.

## Checklist (PR)

- [ ] Intent clear from title and first screen of the diff.
- [ ] Correctness: edge cases, empty inputs, concurrent use if relevant.
- [ ] Tests for behavior change; assertions match user-visible outcomes.
- [ ] No secret, token, or PII in code or logs.
- [ ] Names and structure match the domain; no dead branches.
- [ ] Error paths return actionable information.
- [ ] Docs or migration notes when public interfaces move.

## Sources

Google Engineering Practices (code review standard); OWASP ASVS 4.0 levels and control chapters; A Philosophy of Software Design (deep modules); Pragmatic Programmer patterns. Original Novahiz synthesis; no upstream skill text.
