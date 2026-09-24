---
name: "skill-authoring"
description: "Write or rewrite an agent SKILL.md: frontmatter contract, description as routing (what + when + differentiator), progressive disclosure, lean body, references and scripts layout, ship checklist. Use when creating a skill, fixing under/over-triggering, or restructuring a long SKILL.md."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# skill-authoring

A skill is a folder: `SKILL.md` plus optional `scripts/`, `references/`, `assets/`. Agents load metadata always, body on match, files and scripts only when needed. Write for that loading order.

## Frontmatter contract

```yaml
---
name: kebab-case-name          # ≤64, matches folder, [a-z0-9-]
description: What it does. Use when ... Trigger phrases. Differentiator vs sibling skills.  # ≤1024
license: Apache-2.0
metadata:
  author: ...
---
```

- Quote the description if it contains `: ` so strict YAML parsers do not see a nested map.
- Avoid `<` `>` in frontmatter; they can leak into prompts.
- Invalid YAML often fails silently (skill never loads).

## Description is the router

The model sees only name + description before deciding to open the file.

| Include | Avoid |
|---|---|
| What the skill does | Step-by-step “how” (model will follow the short version and skip the body) |
| When to use (triggers, file types, user phrasings) | Empty praise (“helps with projects”) |
| Differentiator from a sibling skill | Competing skills’ full menus |

Pattern: `X via Y. Use for [situations]. [When not / other skill instead if needed].`

If it does not trigger: fix description first (95% of the time). If it triggers wrong: narrow or add negatives. Fix the body only when explicit invocation produces wrong work.

## Progressive disclosure layout

```text
my-skill/
  SKILL.md          # workflow, checklists, pointers
  references/*.md   # deep detail, one level deep
  scripts/*         # deterministic work; output enters context, source need not
  assets/*          # templates
```

- Keep body scannable; when it grows past usefulness, move detail to `references/` and say **when** to open each file.
- No chains: `SKILL.md → a.md → b.md → c.md`.
- Long reference: table of contents at the top.
- Scripts for anything fragile or repeated; prose for judgment calls.

## Body shape

1. What this does / when it applies (one short block).
2. Ordered workflow with state checks before actions.
3. Verify → fix → re-verify loop stated explicitly.
4. Output format if the consumer expects structure.
5. Pointers: “For X, read `references/x.md`.”
6. Sources / constraints that must stay visible.

Match strictness to fragility: heuristics for open-ended work; exact steps and scripts for install, migrations, gates.

## Composition

- One skill, one concern.
- If skill A produces artifacts skill B reads, document the file shape in both.
- Shared config file beats hidden coupling.
- Document tool needs (`allowed-tools` only where the host supports it; not universal).

## Ship checklist

- [ ] `name` matches folder; kebab-case.
- [ ] description: what + when + differentiator; under limit; quoted if needed.
- [ ] body has workflow, verification loop, failure notes.
- [ ] references linked with explicit “when to read”.
- [ ] scripts runnable; errors actionable.
- [ ] no secrets, no absolute machine paths, no time bombs.
- [ ] humanizer pass if prose is user-facing.
- [ ] implicit trigger test + explicit execution test (`skill-eval-loop`).
- [ ] versioned with the repo.

## Sources

Anthropic Agent Skills engineering notes and platform docs (progressive disclosure, description guidance); agentskills.io description optimization; Microsoft Agent Skills structure fields; community skill-authoring guides distilled to routing and disclosure rules. Original Novahiz synthesis; no upstream skill text reused wholesale.
