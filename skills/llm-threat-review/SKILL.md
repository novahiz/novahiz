---
name: "llm-threat-review"
description: "Security review for LLM and agent features: OWASP LLM Top 10 2025, MITRE ATLAS technique mapping, prompt injection and excessive agency checks, tool least privilege, output handling, logging. Use when designing or reviewing chat, RAG, or agentic code paths, before ship or during threat modeling."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# llm-threat-review

Review checklist for systems that call a model, retrieve context, or let a model call tools. Findings carry severity and a control. Score against OWASP LLM Top 10 (2025) and map to MITRE ATLAS where a technique id helps.

## Scope

Chat UIs, RAG pipelines, agent loops, tool/function calling, fine-tunes that ingest user data. Classic web vulns in the host app stay with `novahiz-security` / ASVS work; this skill covers the model surface.

## 1. Threat model first

Answer before listing controls:

1. What private data can the model read?
2. What untrusted content enters the prompt (user text, web, email, tickets, files)?
3. What can the model do (call tools, write, spend, message)?
4. Where does output go (user, HTML, SQL, shell, another model)?

If one path combines private data, untrusted content, and an external action, treat it as critical. That combination is the lethal trifecta agents often assemble by default.

## 2. OWASP LLM 2025 map (review each)

| ID | Risk | Review question | Typical control |
|---|---|---|---|
| LLM01 | Prompt injection | Can user or retrieved text override system rules? | Separate instruction from data; ignore embedded orders; HITL on high-impact tools |
| LLM02 | Sensitive info disclosure | Can the model echo secrets, PII, or system prompt? | Redact before send; restrict what the system prompt may contain; output filters |
| LLM03 | Supply chain | Where do models, plugins, and datasets come from? | Pin versions; verify hashes/signatures; vendor review; SBOM/ML-BOM |
| LLM04 | Data and model poisoning | Can training, fine-tune, or RAG data be poisoned? | Provenance on data; sandbox imports; monitor eval regressions |
| LLM05 | Improper output handling | Is model output fed to interpreter, SQL, or browser without checks? | Parameterized queries; HTML sanitize; no raw shell from model text |
| LLM06 | Excessive agency | Do tools run with more privilege than the task needs? | Least-privilege tokens; allowlists; confirm destructive calls |
| LLM07 | System prompt leakage | Is the system prompt secret that matters? | Keep secrets out of the prompt; accept that prompts leak if treated as public |
| LLM08 | Vector and embedding weaknesses | Who can poison or read the vector store? | Tenant isolation; authz on retrieval; tamper checks on indexes |
| LLM09 | Misinformation | Where does unverified model text become a decision? | Grounding; citations; human review for high-stakes answers |
| LLM10 | Unbounded consumption | Can an attacker burn tokens or loop tools? | Rate limits; budgets; max steps; circuit breakers |

## 3. Injection and jailbreak defenses

No single filter stops all injection. Layer:

- Constrain role and allowed topics in the system prompt; instruct the model to treat retrieved content as data.
- Structure prompts so instructions and untrusted content are visually and logically separate (tags, fields).
- Deterministic validation of output shape (JSON schema, enums) before side effects.
- Input screening (pattern + optional classifier) on user text and on every external chunk (web, email, tickets).
- Output screening before render or tool call; block exfil patterns and unexpected tool names.
- Human approval for money, deletes, production deploys, mass messages.
- Rate limit and anomaly-log multi-turn and encoded payloads (base64, zero-width, homoglyphs).

Treat regex alone as weak against creative obfuscation. Best-of-N style attacks eventually slip past static filters; budget and monitoring matter as much as the filter.

## 4. Agency and tools

- Each tool gets the minimum scope (read vs write, record-level limits).
- Prefer app-held credentials over passing API keys into the prompt.
- Dual pattern when stakes are high: one process reads untrusted content, another holds tools and only receives structured summaries.
- Max iteration count and wall-clock budget per user session.
- Log every tool call with actor, arguments hash, and outcome.

## 5. Output handling

Model text is untrusted input to the next system:

- HTML: sanitize allowlists before DOM insert.
- SQL: parameterize; never interpolate model identifiers into DDL.
- Shell: do not execute model-authored commands without an allowlist and sandbox.
- URLs: validate scheme and host before fetch (SSRF discipline).

## 6. Logging and redaction

Log prompts and outputs for incident work, but redact secrets and unnecessary PII. Alert on: tool calls outside the user’s role, repeated injection-shaped inputs, sudden token spend.

## Report format

```
## LLM threat review
Verdict: PASS | PASS_WITH_FIXES | FAIL

### Findings
- [HIGH|MED|LOW] area : finding (OWASP LLMxx / ATLAS AML.Txxxx if known)
  Control: ...

### Accepted risk
- ...
```

Every finding names a concrete path (route, tool, retrieval source).

## Sources

OWASP Top 10 for LLM Applications 2025 (genai.owasp.org); OWASP LLM Prompt Injection Prevention Cheat Sheet; MITRE ATLAS technique data (AML.T0051 family, agent tool techniques); BSI guidance on evasion attacks. Original Novahiz checklist synthesis.
