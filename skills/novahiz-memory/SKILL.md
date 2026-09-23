---
name: novahiz-memory
description: |
  novahiz-memory is the dual-write context save: the project's MEMORY.md plus an
  Obsidian vault page. Destination comes only from the routing table _meta/routing.md.
  Mandatory frontmatter, wikilinks, merge rather than duplicate.
  Use when a complex task ends, when the user says "update memory" or "save",
  or when a decision, bug root cause, or next step must survive the session.
  Triggers on: "memory", "MEMORY.md", obsidian, vault, save, "note that", routing.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-memory

A finished session leaves a trace in two places. One write is never enough.

## Destinations

| Medium | Path |
|---|---|
| Project | `MEMORY.md` at the current project root |
| Vault | `C:\Users\hiz\Documents\Novahiz`, folder taken from `_meta\routing.md` |

`_meta\routing.md` is the only source of truth for the target folder. When routing is ambiguous, ask instead of guessing.

The full procedure lives in the `memory-save` skill. Load it and follow it rather than writing freehand.

## Forbidden

- Writing to `index.md`, `log.md`, `hot.md`, `.manifest.json`, `_meta\`, or `.obsidian\`. Those belong to maintenance skills.
- Creating a root folder on your own initiative.
- Picking a destination without consulting routing.

## What to write

1. What works now.
2. What changed, with the key files.
3. What stays open: next step, debt, blockers.

## Frontmatter

Every vault page carries: `title`, `category`, `tags`, `sources`, `created`, `updated`, `summary`.

Tags come from `_meta\taxonomy.md`. Pages link with `[[wikilinks]]`. When the subject already exists, enrich that page instead of creating a second one.

## Before writing

Show the chosen path. A declared write is a write you can verify later.

## Pitfalls

- Duplicating content across two pages instead of enriching the first.
- Copying the session transcript instead of distilling decisions.
- Updating the vault while forgetting the project's `MEMORY.md`.
- Touching maintenance files from this skill.
