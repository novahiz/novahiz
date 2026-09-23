# Validate, detect, rotate

The three ongoing activities that keep credentials from becoming incidents. Validation stops bad configuration before boot, detection catches leaks while the window is still small, rotation limits how long any single secret stays useful to an attacker.

## Validation

Validation answers one question: will this process start, and can it reach what it needs?

What to check at startup:

- Required keys are present (fail the boot with the list of missing names, never with a partial start that dies later on the first request).
- Values are not placeholders. Compare against a blocklist of documentation filler and against the `.env.example` values themselves; shipping the example value to production is a classic failure.
- Shape checks per key type: URL parses, port is an integer in range, duration strings match the expected grammar, enum-like flags are in the allowed set, secret values meet a minimum length.
- Optional reachability probes only in staging. Production boots should not depend on a third party answering during startup or a provider outage becomes your outage.

Where the checks live: one module that loads and validates configuration once, at process start, and hands typed settings to the rest of the app. Scattered `getenv` calls with local defaults recreate the problem this module exists to prevent.

Example contract for a required secret:

```text
name:        STRIPE_SECRET_KEY
required in: production
shape:       sk_live_ prefix, minimum 20 chars after prefix
reject:      values present in .env.example, values shorter than floor
on failure:  abort boot with "STRIPE_SECRET_KEY missing or placeholder"
```

## Detection

Detection has three layers. Run them at different times so each one catches what the others miss.

| Layer | When | Tooling | Catches |
|---|---|---|---|
| Pre-commit | Every commit | `env_auditor.py` or a git hook wrapper around it | Fresh credentials about to enter history |
| CI gate | Every push and pull request | `env_auditor.py --json`, plus a history scanner (gitleaks, detect-secrets) | Working-tree leaks and history that was force-added, plus regression when someone disables the hook |
| Continuous | Scheduled, and on demand after incidents | History scan of the full repo, image scan of built artifacts, log sample review | Old secrets still live in history, secrets baked into images, secrets printed by the app |

Tune for signal: silence the placeholder rules only for known test fixtures, keep critical provider-prefix rules always on, and treat any newly introduced high finding as a build failure rather than a warning. A warning that appears every week is a warning nobody reads.

Secrets that already reached a log aggregation system count as leaked. Scrubbing the log store is part of detection response, not an afterthought.

## Rotation

Rotation replaces a live credential and retires the old one. Renaming the variable without revoking the old value does nothing for an attacker who already copied it.

### Planned rotation (no known exposure)

1. Inventory consumers. Search code, CI variables, secret manager entries, vendor dashboards, and scheduled jobs for the key name. Write the list down; it is the work plan.
2. Create the replacement next to the original. Providers that allow two live keys make this trivial; where only one key can exist, use the provider's grace window or deploy code that accepts either value for one release.
3. Distribute the new value through the secret manager. Never paste it in chat, tickets, or commits.
4. Redeploy or refresh each consumer. Confirm each one with a synthetic call that touches the provider.
5. Watch provider logs until the old credential goes quiet.
6. Revoke the old credential. This step has its own ticket and its own owner.
7. Record the rotation date, operator, and consumer list in the audit note.

Aim for a rotation interval that fits the credential's blast radius: long-lived root-style keys get short intervals and automation; per-service scoped tokens can live longer. Pick intervals the team can actually hit and put them on a calendar.

### Emergency rotation (exposure suspected or confirmed)

Order changes under pressure:

1. Revoke first. An attacker holding a live key gains nothing by your being methodical.
2. Issue the replacement and roll consumers.
3. Pull provider activity logs across the exposure window and write down what was accessed.
4. Fix the leak path (the file, the log line, the chat paste) and re-run detection across history.
5. Only then write the incident note.

### Zero-downtime patterns

- Dual-accept: code reads `KEY` and `KEY_PREVIOUS`, prefers `KEY`, and falls back during the rollout window.
- Lease-based delivery: short-lived tokens (cloud IAM sessions, OIDC-exchanged credentials) that renew on their own, so rotation is a non-event.
- Per-consumer keys: revoke one consumer's key without touching the others, which also shrinks the blast radius of any single leak.

## Ownership

Every credential has an owner (a team, not a person who might leave), a revoke path documented next to it, and a review date. When a service is decommissioned, its keys get revoked in the same checklist item that deletes the service; orphaned credentials are how dormant systems come back to life in an attacker's inventory.
