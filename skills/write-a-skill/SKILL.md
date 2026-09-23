---
name: write-a-skill
description: Create new agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, build, or author a new skill.
license: Apache-2.0
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Writing skills

## Process

1. **Clarify the need.** Ask about the domain, the concrete cases the skill must handle, whether scripts are required, and what reference material should ship with it.
2. **Draft the files.** Write SKILL.md first. Push anything past 100 lines into a reference file. Add scripts only for deterministic work the model should not re-derive each time.
3. **Review with the author.** Present the draft. Ask what is missing, what is unclear, and which sections are too heavy or too thin.

## Layout

```
skill-name/
├── SKILL.md           # required entry point
├── REFERENCE.md       # optional long-form detail
├── EXAMPLES.md        # optional worked cases
└── scripts/           # optional helpers
    └── helper.js
```

## SKILL.md skeleton

```md
---
name: skill-name
description: What the skill does. Use when [specific triggers].
---

# Skill name

## Quick start

[Minimal working example]

## Workflows

[Step-by-step processes for complex tasks]

## Advanced features

[See REFERENCE.md](REFERENCE.md)
```

## Description rules

The description is the only text the agent sees when it decides whether to load the skill. It sits in the system prompt next to every other installed skill, and the agent picks from it alone.

Two facts must land:

1. What the skill does.
2. When to fire: keywords, contexts, file types.

Constraints:

- Hard cap at 1024 characters.
- Third person throughout.
- Sentence one: the action.
- Sentence two: `Use when [specific triggers]`.

Good:

```
Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when user mentions PDFs, forms, or document extraction.
```

Bad:

```
Helps with documents.
```

The weak version gives the agent nothing to match against. Every document skill in the list looks the same from it.

## When scripts belong in the skill

Ship a script when the work is deterministic (validation, formatting), when the same code would otherwise be generated over and over, or when failure needs explicit handling. Scripts cut token use and remove the chance of two runs inventing two different implementations.

## When to split the file

Split when SKILL.md crosses 100 lines, when the content covers distinct domains (finance schemas next to sales schemas), or when advanced paths are rarely needed. The agent should read SKILL.md in full and stop there unless a pointer sends it deeper.

## Review checklist

- [ ] Description carries triggers (`Use when ...`)
- [ ] SKILL.md stays under 100 lines
- [ ] No dates, versions, or `as of YYYY` claims
- [ ] One word per concept throughout
- [ ] At least one concrete example
- [ ] References sit one level deep

## Tooling

Three stdlib validators sit next to this skill:

```
python scripts/skill_description_validator.py path/to/SKILL.md
python scripts/skill_structure_validator.py path/to/skill-folder
python scripts/skill_review_checklist_runner.py path/to/skill-folder
```

Catalogue and companions: [references/companion_tooling.md](references/companion_tooling.md).
