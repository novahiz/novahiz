---
name: ai-security
description: "Use when assessing AI/ML systems for prompt injection, jailbreak vulnerabilities, model inversion risk, data poisoning exposure, or agent tool abuse. Covers MITRE ATLAS technique mapping, injection signature detection, and adversarial robustness scoring."
license: Apache-2.0
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Assessing AI systems for abuse

This skill gives you a repeatable way to examine LLM apps, classifiers, embedding pipelines, and tool-using agents for the abuse cases that show up most often in the field: instruction overrides, persona escapes, training-data tampering, model output extraction, and runaway tool use. Every finding you record carries a MITRE ATLAS technique ID so the report speaks the same language as red-team writeups and vendor advisories.

General web and API hardening stays in `novahiz-security`. Runtime anomaly detection on servers and networks is out of scope here. Use this skill when the target under test is a model, a prompt chain, or an agent.

## Where abuse enters

Treat the system as four channels. Each channel has its own entry points and its own detection ideas.

1. Prompt channel. Direct text sent by a user or by a downstream service. Classic instruction overrides ("ignore your rules"), role-play escapes that try to unlock unrestricted behavior, and requests aimed at dumping the system prompt.
2. Retrieval and tool channel. Content that the system pulls in from the web, a vector store, tickets, or email, plus whatever an agent can call. Injected instructions hide inside retrieved documents; tool calls get steered toward destructive or exfiltrating actions.
3. Training and fine-tuning channel. Datasets, uploaded labeled samples, and replay buffers. Watch for planted markers, label flips, and trigger phrases designed to activate after retraining.
4. Inference interface. Repeated queries against a hosted model. Volume and pattern of queries can signal extraction attempts (harvesting system prompts or training rows) or inversion-style probing (reconstructing inputs or membership answers from outputs).

## Scanner

`scripts/ai_threat_scanner.py` is a stdlib-only Python 3 probe. It never calls a model API. It matches signatures against files you point it at, optionally scores a pack of probe prompts, maps hits to ATLAS IDs, and computes a robustness score.

```bash
# Passive pass over an app's prompt templates, configs, and docs
python3 scripts/ai_threat_scanner.py --path ./app --surface llm --mode passive

# Same, machine-readable for CI
python3 scripts/ai_threat_scanner.py --path ./app --surface agent --mode passive --json -o findings.json

# Score a probe pack against an agent surface (authorization required)
python3 scripts/ai_threat_scanner.py --surface agent --mode active \
  --pack probes.json --i-am-authorized --json

# Show the built-in rule catalog
python3 scripts/ai_threat_scanner.py --show-rules
```

Exit codes: `0` nothing above medium, `1` medium or high findings present, `2` critical findings or an active run without `--i-am-authorized`.

Passive mode reads only what you give it. Active mode (gray-box and above) replays probe prompts through your own harness; run it only against systems you have written authorization to test.

## Signature families

The scanner ships with these rule families. Rule IDs are stable; use them in tickets and in the report.

| Rule ID | Channel | What a hit means | ATLAS anchor |
|---|---|---|---|
| `ROLE_OVERRIDE` | prompt | Text instructs the model to drop or rewrite its standing rules | AML.T0051 |
| `PERSONA_ESCAPE` | prompt | Framing tries to unlock an unrestricted or fictional operator persona | AML.T0054 |
| `PROMPT_LEAK` | prompt | Explicit attempt to echo the system prompt or hidden instructions | AML.T0056 |
| `RETRIEVAL_INJECT` | retrieval | Retrieved content carries instruction-like payloads or template tokens | AML.T0051.001 |
| `TOOL_STEER` | tool | Payload steers tool calls toward bulk send, delete, or silent exfiltration | AML.T0051.002 style abuse |
| `POISON_MARKER` | training | Dataset rows contain planted triggers, label-flip notes, or admin tokens | AML.T0020 |
| `INVERSION_PROBE` | inference | Query pattern aims to reconstruct inputs, memberships, or training rows | AML.T0024 / inversion risk |
| `ADVERSARIAL_SHAPE` | inference | Glitch tokens, degenerate repeats, or crafted perturbation templates | AML.T0043 |

A hit in application source usually means the payload made it past review, or a prompt template invites the abuse. A hit in a dataset means the sample itself is hostile. A hit in a probe pack means you are holding a weaponized input: keep it, do not ship it.

Full ID mapping and tactic grouping: `references/atlas-coverage.md`. ATLAS IDs move over time; confirm against <https://atlas.mitre.org/> before publishing a report.

## Access levels

| Level | What you get | Authorization |
|---|---|---|
| Passive (black-box file review) | Signatures over code, prompts, configs, datasets you already hold | None beyond repo access |
| Active probe replay (gray-box) | Your harness sends pack entries to a staging or local endpoint | Written approval, `--i-am-authorized` |
| Weight-level review (white-box) | Training data inspection, gradient or embedding analysis | Written approval, separate engagement scope |

The scanner enforces the gate: without the flag, an active run exits `2` and prints nothing sensitive.

## Scoring

Each finding has a severity (`low`, `medium`, `high`, `critical`) derived from rule base weight, channel reach (who can send input there), and blast radius (can the hit trigger tools or touch training data).

Robustness score starts at 100 and drops by severity weight:

| Severity | Deduction |
|---|---|
| low | 2 |
| medium | 8 |
| high | 20 |
| critical | 40 |

Bands: `90-100` hardened, `70-89` serviceable, `40-69` exposed, `0-39` wide open. Report the band next to the raw number. A system that accepts untrusted retrieval and exposes tools loses more per finding than a closed chat wrapper; reflect that by raising severity one step when the prompt channel is reachable by anonymous users.

## Guardrails worth recommending

- Separate instruction layers. Put operator rules somewhere the model treats as non-user text, and reject user turns that try to restate them.
- Constrain tools with an allowlist, argument schemas, and a confirmation step for anything that sends, deletes, or spends.
- Treat retrieved documents as hostile input. Strip instruction-looking lines before they reach the prompt builder, and mark provenance in the context window.
- Log every model call with input hash, tool calls, and output classifier verdicts, so a probe campaign leaves a trail.
- Rate-limit and fingerprint the inference endpoint; extraction and inversion both need volume.
- Canary strings in the system prompt and in training rows turn silent leaks into alerts.
- For fine-tunes, scan incoming datasets with the same rule catalog you use on prompts; `POISON_MARKER` exists for that pass.

## Assessment workflow

1. Inventory. List model endpoints, prompt templates, retrieval sources, tool definitions, and training/fine-tune inputs. Note which are reachable by untrusted users.
2. Passive scan. Run the scanner over the repository and any exported datasets, then triage hits by channel.
3. Authorized probing (optional). Assemble a probe pack for the channels that matter, get sign-off, run active mode against staging.
4. Score. Apply the deduction table, adjust for reach, write down the band.
5. Map. Attach ATLAS IDs from `references/atlas-coverage.md` to every finding.
6. Report and retest. Ship findings with the report shape below; after fixes, rerun passive mode and assert `0` critical and `0` high.

## Report shape

```markdown
# AI system assessment: <name>

## Scope
Models, channels, access levels exercised, date.

## Score
Robustness: <score> (<band>). Findings: critical N, high N, medium N, low N.

## Findings
### AI-001 <title>
- Rule: <RULE_ID> | ATLAS: <AML.T....> | Severity: <sev>
- Channel: prompt | retrieval | training | inference
- Evidence: file:line or probe pack entry
- Impact: what the attacker gains
- Fix: concrete control (see guardrails list)
- Retest: command to confirm the fix
```
