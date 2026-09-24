---
name: "secrets-hygiene"
description: "Secret hygiene for repos and environments: detection gates (pre-commit, CI, history), rotate-first incident response, secret manager patterns, env var rules, inventory and rotation policy. Use when auditing .env and git history for leaked credentials, planning a rotation, responding to a leak, or standing up scanning."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# secrets-hygiene

Credentials that reach git are compromised. Deletion and force-push clean history; only rotation kills the credential. This skill covers detection, response order, and the steady-state setup that keeps new leaks from shipping.

## Detection gates

| Gate | Where | Tool shape | Limits |
|---|---|---|---|
| Pre-commit | Developer machine | gitleaks / git-secrets hook on the diff | `--no-verify` bypass; hook must be installed |
| CI | PR and default branch | gitleaks detect, TruffleHog, platform secret scanning | Misses secrets only in old history |
| History | Full repo, periodic | `gitleaks git`, TruffleHog history mode | Slow on large repos; needs triage |

Enable all three. Tune false positives weekly until the team stops disabling hooks; a noisy scanner gets switched off.

## When a secret lands in git

Order is fixed. Do not start with history surgery.

1. **Identify** the credential type, scope, and where it is used.
2. **Rotate or revoke** at the provider. The old value must stop working before anything else.
3. **Update** every consumer (deploy env, secret store, local `.env` that is not committed).
4. **Purge history** with `git filter-repo` (or BFG), force-push, coordinate re-clones and fork deletion.
5. **Verify**: full-history scan clean; only the new credential authenticates; provider audit log reviewed for use of the old key.

Public remote or CI logs: assume the scrapers already have it. Rotate first, always.

## Steady state

- Never commit `.env`, key files, or PEM blocks. `.env.example` holds names only.
- Load secrets at runtime from the platform secret manager or injected env; never hardcode in source or tests.
- Short TTL where the provider supports it; prefer workload identity over long-lived static keys.
- Inventory: every credential has type, owner, rotation policy, and where it lives. You cannot rotate what you do not know.
- Metric: time from detect to confirmed rotation (target under a few hours for production).

## Redaction in logs

Log auth events without the secret itself. Truncate tokens in error pages. Scrub request/response bodies in support tooling.

## Checklist

- [ ] Pre-commit scanner installed and required (or CI enforces equivalent).
- [ ] CI scan on every PR and on schedule against default branch.
- [ ] Full-history scan run once at adoption; baseline file for old accepted findings if needed.
- [ ] `.env` gitignored; example file has placeholders.
- [ ] No live credentials in fixtures or snapshots.
- [ ] Rotation runbook names the person and the console for each credential class.
- [ ] Post-incident: revoke confirmed, history purged, scan green.

## Sources

Gitleaks and TruffleHog project docs; AWS git-secrets patterns; OWASP and industry guidance that history rewrite is cleanup while rotation is containment. Original Novahiz synthesis; no upstream skill text.
