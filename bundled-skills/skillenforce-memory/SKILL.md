---
name: skillenforce-memory
description: |
  Skillenforce project memory: dual write, to the project's MEMORY.md and to an
  Obsidian vault page. The destination is deduced only from the routing table
  `_meta/routing.md`. Mandatory frontmatter, wikilinks, merge rather than duplicate.
  Use when a complex task ends, when the user says "update memory" or "save this",
  or when a decision, bug cause, or next step must survive the session.
  Triggers on: "memory", "MEMORY.md", obsidian, vault, save, "remember this", routing.
license: MIT
compatibility: opencode
---

# skillenforce-memory: dual memory

A session ends with a trace. Two writes, never just one.

## Where

| Target | Path |
|---|---|
| Project | `MEMORY.md` at the root of the current project |
| Vault | `C:\Users\hiz\Documents\skillenforce`, folder derived from `_meta\routing.md` |

`_meta/routing.md` is the single source of truth for the target folder. No guessing: if routing is ambiguous, ask.

The detailed procedure lives in the `memory-save` skill. Load it and follow it rather than writing freehand.

## Forbidden

- Write to `index.md`, `log.md`, `hot.md`, `.manifest.json`, `_meta/`, or `.obsidian/`. These files belong to maintenance skills.
- Create a root folder on your own initiative.
- Guess the destination.

## Expected content

1. What works.
2. What changed, with the key files.
3. What's left open: next step, technical debt, blockages.

## Mandatory frontmatter

```
title, category, tags, sources, created, updated, summary
```

Tags come from `_meta/taxonomy.md`. The page links with `[[wikilinks]]`. When the topic already exists, enrich the existing page rather than creating a second one.

## Before writing

Show the chosen path. A stated write is a verifiable write.

## Pitfalls

- Writing the same thing in two pages instead of enriching the first.
- Copying the session transcript instead of distilling decisions.
- Updating the vault and forgetting the project's `MEMORY.md`.
- Touching maintenance files from this skill.
