---
name: env-secrets-manager
description: "Manage environment-variable hygiene and secrets safety across local development and production. Practical auditing, drift awareness, rotation readiness. Use when auditing .env files for committed secrets, planning a credential rotation, debugging missing-env-var production incidents, or hardening a new project against secrets leakage."
license: Apache-2.0
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Environment variables and secret handling

Configuration values fall into three buckets, and mixing them is where incidents start. Settings that shape behavior (log level, feature toggles, region) can live in plain config or defaults. Credentials that unlock something outside the process (API keys, database URLs, signing secrets) must never sit in the repository, in images, or in stack traces. Ephemeral values (request IDs, one-time tokens) should expire on their own and never be persisted as if they were settings.

This skill covers the second bucket end to end: how to keep secrets out of git, how to detect when one slips in, how to structure `.env` files for a team, and how to rotate a credential without downtime. Package CVEs belong to `dependency-auditor`. Secure coding defaults live in `engineering-code-standards`. The full audit procedure lives in `novahiz-security`.

## File layout that works

| File | Committed? | Holds |
|---|---|---|
| `.env` | No | Real values for one machine |
| `.env.example` | Yes | Key names with empty or obviously fake values |
| `.env.template` or `config/defaults.env` | Yes | Non-secret defaults (timeouts, ports, flags) |
| Secret manager export (Vault, AWS Secrets Manager, GCP Secret Manager, 1Password CLI) | N/A | Production credentials, injected at deploy time |

Rules that keep this from rotting: every key in `.env` must appear in `.env.example` so a new contributor knows what to set; every key in `.env.example` must be documented with one line saying what it is; `.env` goes in `.gitignore` on day one, before the first commit exists.

For apps that boot from env vars, fail fast at startup when a required key is missing or still holds a placeholder. A blank `DATABASE_URL` that only surfaces on the first login request costs an hour of debugging; a startup assertion costs a second.

## Scanning for leaks

`scripts/env_auditor.py` walks a working tree offline (stdlib only, no network) and reports likely credentials with severity and redacted evidence.

```bash
# Human-readable report, non-zero exit when high or critical hits appear
python3 scripts/env_auditor.py .

# JSON for CI
python3 scripts/env_auditor.py . --json -o secrets.json

# Only env-family files
python3 scripts/env_auditor.py . --env-only

# Custom ignore list
python3 scripts/env_auditor.py . --skip build --skip vendor
```

Exit codes: `0` clean or low findings only, `1` at least one high or critical finding, `2` bad invocation.

What counts as a hit:

- Provider-shaped tokens: AWS access key IDs, GitHub PATs and app tokens, Slack tokens, OpenAI-style keys, Google API keys, GitLab and npm tokens, Stripe secret keys, Twilio SIDs.
- PEM private key blocks anywhere in tracked files.
- Assignment lines (`password=`, `api_key:`, `SECRET=`, `token =`) whose right-hand side looks like a real value rather than a placeholder or an interpolation (`${VAR}`, `process.env.X`, `changeme`, `example`).
- High-entropy strings assigned to credential-sounding names.

Pattern catalog with severity rationale: `references/secret-patterns.md`.

For history, pair this with a history-aware tool (gitleaks, detect-secrets, TruffleHog). The auditor sees the working tree; a secret that was committed last week and deleted today still lives in git history and needs rotation regardless.

## Drift

Drift is the gap between what the example file promises, what deployment injects, and what the code actually reads. Check it on every environment change:

1. Diff `.env.example` against the keys the app reads at boot (grep `os.environ`, `process.env`, `os.Getenv`, and friends).
2. Diff `.env.example` against the secret manager entries for that environment.
3. Diff staging against production key lists. An extra key in production is either a leftover to revoke or a missing staging setup.
4. When a key disappears from the example but code still reads it, the onboarding path just broke.

Keep the three lists in one spreadsheet or one checked-in manifest if the team is small; the point is that someone can answer "what keys does staging need?" without SSHing anywhere.

## Rotation runbook

Full procedure: `references/validation-detection-rotation.md`. Short form:

1. Confirm scope. Which system issues the credential, who consumes it, where copies might live (CI variables, developer laptops, cron boxes, vendor dashboards).
2. Issue the replacement alongside the old one. Dual-write or dual-accept windows are what make zero-downtime rotation possible.
3. Roll the new value through the secret manager and redeploy consumers.
4. Verify traffic on the new credential in provider logs.
5. Revoke the old one. Set a calendar reminder for the revoke step; a rotation that skips revocation is a rename, not a rotation.
6. Write down the date and the operator in an audit note.

If a secret is already public (in a commit, a log, a paste), skip the calm sequence: revoke first, rotate second, investigate third.

## Incident triage for a leaked key

1. Revoke or disable the credential at the provider immediately. Speed beats elegance.
2. Check provider-side activity logs for the exposure window: what was called, from where, how much.
3. Locate every copy (repo history, CI logs, chat exports, laptop backups) and remove or rewrite as needed.
4. Rotate anything that shared the blast radius: if a signing key leaked, sessions signed with it must die too.
5. Add the pattern that let it slip to the scanner rules or to pre-commit hooks, then re-run `env_auditor.py` over the repo.

## Hardening checklist

- Pre-commit hook running the auditor (and a history scanner) on every push.
- `.env*` in `.gitignore` with an explicit exception for `.env.example`.
- CI job that fails the build on `high` or `critical` findings.
- No secrets in Docker build args, image layers, or client-side bundles; anything shipped to a browser is public by definition.
- Logs and error reports pass through a redaction layer before they leave the process.
- Production secrets come from the platform's secret store, not from a file on disk.
- Access to the secret manager follows least privilege and gets reviewed when people change teams.
