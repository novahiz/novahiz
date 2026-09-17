---
name: novahiz-memory
description: |
  Novahiz project memory: dual-write, into the project's MEMORY.md and into an
  Obsidian vault page. The destination is determined solely from the routing table
  _meta/routing.md. Mandatory frontmatter, wikilinks, merge rather than duplicate.
  Use when a complex task ends, when the user says "update memory" or "save",
  or when a decision, bug root cause, or next step must survive the session.
  Triggers on: "memory", "MEMORY.md", obsidian, vault, save, "note that", routing.
license: MIT
compatibility: opencode
---

# novahiz-memory: dual memory

A session ends with a trace. Two writes, never one.

## Where

| Medium | Path |
|---|---|
| Project | `MEMORY.md` at the current project root |
| Vault | `C:\Users\hiz\Documents\novahiz`, folder derived from `_meta\routing.md` |

`_meta\routing.md` is the sole source of truth for the target folder. No guessing: if routing is ambiguous, ask.

The detailed procedure lives in the `memory-save` skill. Load it and follow it rather than writing freehand.

## Forbidden

- Write to `index.md`, `log.md`, `hot.md`, `.manifest.json`, `_meta\`, or `.obsidian\`. These files belong to maintenance skills.
- Create a root folder on your own initiative.
- Guess the destination.

## Expected content

1. What works.
2. What changed, with key files.
3. What remains open: next step, technical debt, blockers.

## Mandatory frontmatter

```
title, category, tags, sources, created, updated, summary
```

Tags come from `_meta\taxonomy.md`. Link pages with `[[wikilinks]]`. When the subject already exists, enrich the existing page rather than creating a second one.

## Before writing

Display the chosen path. A declared write is a verifiable write.

## Pitfalls

- Write the same thing in two pages instead of enriching the first one.
- Copy the session transcript instead of distilling decisions.
- Update the vault and forget the project's `MEMORY.md`.
- Touch maintenance files from this skill.
