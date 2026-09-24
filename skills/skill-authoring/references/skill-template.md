# SKILL.md template

Copy into `skills/<name>/SKILL.md`. Fill every bracket. Delete optional blocks you do not need.

```markdown
---
name: "<folder-name>"
description: "<What it does>. Use when <situations and trigger phrases>. <Differentiator vs sibling skill>."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# <folder-name>

<One or two lines: goal of the skill and when it ends.>

## Workflow

1. <State check before action.>
2. <Action.>
3. <Verify what you did.>
4. <Fix and re-verify if needed.>

## Checklist

- [ ] <Acceptance item>
- [ ] <Acceptance item>

## References

- For <deep topic>, read `references/<file>.md`.
- For <repeatable task>, run `scripts/<tool>.mjs`.

## Sources

<Primary sources used. Original synthesis note.>
```

## Description formula

`<What>. Use when <trigger>. <Differentiator>.`

Keep under 1024 characters. Quote the whole string in YAML if it contains a colon.

## Folder

```text
skills/<name>/
  SKILL.md
  scripts/     # optional
  references/  # optional, one level deep
  assets/      # optional templates
```

Name must match folder. After writing, run `scripts/skill_frontmatter_lint.mjs`.
