# Secret pattern catalog

Shapes the `env_auditor.py` scanner looks for, why each shape earns its severity, and the first move when it fires. Regexes are anchored on stable prefixes and assignment structure, not on full token bodies, so the scanner stays useful as vendors rotate key formats.

## Provider-prefixed tokens

| Family | Shape the scanner matches | Severity | First move |
|---|---|---|---|
| AWS access key ID | `AKIA` or `ASIA` followed by 16 alphanumeric chars | critical | Deactivate in IAM, rotate, review CloudTrail for the exposure window |
| GitHub PAT (classic) | `ghp_` prefix | critical | Revoke in developer settings, issue a fine-grained replacement |
| GitHub OAuth / user-to-server | `gho_`, `ghu_`, `ghs_`, `ghr_` prefixes | critical | Revoke the OAuth app grant, re-authorize |
| GitHub fine-grained PAT | `github_pat_` prefix | critical | Revoke, reissue with minimal repository scope |
| Slack token | `xoxb-`, `xoxp-`, `xoxa-`, `xoxs-` prefixes | high | Revoke app token in Slack admin, rotate bot credentials |
| OpenAI-style API key | `sk-` prefix (long, often with a second segment) | critical | Revoke in the provider dashboard, check usage for anomalous spend |
| Google API key | `AIza` followed by 35 base64url chars | high | Restrict and regenerate in Google Cloud console |
| GitLab token | `glpat-` prefix | critical | Revoke under Personal Access Tokens |
| npm token | `npm_` prefix | critical | Revoke in npm access tokens, enable 2FA if missing |
| Stripe secret key | `sk_live_` prefix | critical | Roll the key in Stripe dashboard, update all consumers |
| Twilio SID + secret | `AC` account SID pattern near an auth token assignment | high | Regenerate auth token in Twilio console |
| SendGrid key | `SG.` prefix with dot-separated segments | critical | Delete the key, create a least-privilege replacement |

Severity rationale: critical means the shape alone grants meaningful access on its own (account takeover, spend, data read). High means access that is real but usually scoped or rate-limited.

## Structural shapes

| Shape | Why it fires | Severity |
|---|---|---|
| `-----BEGIN ... PRIVATE KEY-----` block | Private keys are never legitimate in a repo | critical |
| Assignment to `password`, `passwd`, `secret`, `api_key`, `apikey`, `token`, `access_key`, `client_secret` where the value looks concrete | Catches hand-rolled credentials that lack a provider prefix | high when the value is long and non-placeholder; medium when short or partially masked |
| JWT-shaped triple base64url segments assigned to a credential name | Live session or API tokens | high (medium if payload decodes to an obviously expired test value) |
| Database URL with embedded credentials (`postgres://user:pass@`) | Connection strings carry passwords in the userinfo component | critical |
| High-entropy blob (Shannon entropy over threshold) assigned to a credential name | Catches keys from vendors with no stable prefix | medium, raised to high when the name is strongly credential-coded |

## Placeholder handling (why things do not fire)

Values are ignored when they are clearly not secrets:

- Interpolation and indirection: `${VAR}`, `$SECRET`, `{{vault_var}}`, `process.env.FOO`, `os.environ["FOO"]`, `System.getenv(...)`.
- Documentation filler: `changeme`, `example`, `placeholder`, `your-key-here`, `xxx`, `todo`, `dummy`, `test`, `redacted`, all-zero or all-star strings.
- Short values under the length floor for that rule (prefix rules use the vendor's known length; generic assignment rules use 8 characters minimum after trimming).

Getting placeholders wrong is the main source of noise. When a placeholder pattern is missing for your team's house style, add it to the scanner config rather than lowering severities.

## Where each family tends to leak

| Family | Frequent leak site |
|---|---|
| Provider tokens with prefixes | Hardcoded config, commit history, screenshots in tickets |
| Assignment-shaped secrets | `.env` committed by accident, docker-compose files, unit test fixtures |
| Private keys | Helm values, Kubernetes sealed-secret experiments, `~/.ssh` accidentally copied into a repo |
| Connection strings | Migration scripts, ORM debug logs, error pages that echo the DSN |
| High-entropy unknowns | Build logs, minified frontend bundles, telemetry payloads |

## Rule of thumb for a new pattern

Match on the most stable identifier the vendor publishes (prefix, structural header, or strict character class plus length). Pair the pattern with an owner who knows the revoke path. If you cannot write the first move for a pattern, the pattern is not ready to ship in the scanner.
