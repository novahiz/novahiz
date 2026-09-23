# MITRE ATLAS coverage map

How the `ai-security` scanner rule families line up with MITRE ATLAS (Adversarial Threat Landscape for Artificial Intelligence Systems). ATLAS is the AI-focused companion to MITRE ATT&CK: same idea, technique IDs under tactic headings.

Canonical list of techniques: <https://atlas.mitre.org/>. IDs get added and retired; treat the table below as the skill's coverage claim for version 2.0.0, not as a mirror of the live matrix.

## Coverage by tactic

### ML attack staging

Techniques used to prepare an assault on a model or its serving stack.

| Technique | Name | Covered by | How the scanner sees it |
|---|---|---|---|
| AML.T0051 | LLM prompt injection | `ROLE_OVERRIDE`, `RETRIEVAL_INJECT` | Regex signatures over prompts, templates, retrieved docs |
| AML.T0051.001 | Indirect prompt injection | `RETRIEVAL_INJECT` | Instruction-shaped payloads and template tokens in stored content |

### Execution

Techniques where injected instructions turn into actions.

| Technique | Name | Covered by | How the scanner sees it |
|---|---|---|---|
| AML.T0051.002 style abuse | Agent tool misuse after injection | `TOOL_STEER` | Tool-call steering phrases (bulk send, silent delete, bypass confirm) in prompts and tool descriptions |

### Exfiltration

Pulling secret material out through the model interface.

| Technique | Name | Covered by | How the scanner sees it |
|---|---|---|---|
| AML.T0056 | LLM data extraction | `PROMPT_LEAK` | Requests that echo system prompts, hidden instructions, or prior context |
| AML.T0024 | Exfiltration via ML inference API | `INVERSION_PROBE` | Query packs aimed at reconstructing inputs or bulk-harvesting outputs; volume heuristics in active mode |

### Persistence

Changes that survive into the next training cycle.

| Technique | Name | Covered by | How the scanner sees it |
|---|---|---|---|
| AML.T0020 | Poison training data | `POISON_MARKER` | Planted triggers, label-flip annotations, admin canaries inside datasets |

### Defense evasion and adversarial construction

Crafting inputs that slip past filters or degrade the model.

| Technique | Name | Covered by | How the scanner sees it |
|---|---|---|---|
| AML.T0043 | Craft adversarial data | `ADVERSARIAL_SHAPE` | Glitch tokens, degenerate repeats, perturbation templates |
| AML.T0054 | LLM jailbreak | `PERSONA_ESCAPE` | Persona framing and role-play unlocks in probe packs and logs |

## What the scanner does not claim

- Live querying of hosted model endpoints. Bring your own harness.
- Gradient inversion or membership-inference execution. Those show up as risk scores from access level and target type, and need a dedicated test plan to confirm.
- Infrastructure compromise paths (server-side request forgery, CI tampering). Those belong to `novahiz-security`.

## Mapping a finding in a report

Every finding row carries three identifiers: the scanner rule ID (stable inside this skill), the ATLAS technique ID (shared with the outside world), and a severity. If a technique is only partially covered, say so in the impact line instead of implying full detection.
