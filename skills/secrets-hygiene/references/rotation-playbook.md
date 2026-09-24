# Rotation playbook

## Trigger

Secret found in commit, PR, log, ticket, or provider alert.

## Steps

1. Classify: provider, scope (read/write, prod/dev), age, who has clone access.
2. Rotate at provider immediately. Confirm old value rejected.
3. Push new value to secret store / deploy config. Redeploy if cached.
4. Purge git history (`git filter-repo --replace-text`), force-push, ask collaborators to re-clone, delete stale forks.
5. Rescan full history; confirm zero findings for that secret fingerprint.
6. Review provider audit log for unexpected use of the old key.
7. File incident note: detection source, time-to-rotate, gaps (missing gate, shared key, no inventory).

## Owners

| Credential class | Rotate by | Console / runbook |
|---|---|---|
| Cloud access keys | | |
| Deploy tokens | | |
| DB passwords | | |
| API third-party | | |
| TLS / signing | | |

Fill before the first real incident, not during it.
