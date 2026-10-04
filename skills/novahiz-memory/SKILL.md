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

The procedure is this skill: read the routing table, show the chosen path, then write the page with the mandatory frontmatter. There is no separate save skill to load.

## project-memory is a different layer

`project-memory/` (slots) is the machine-facing memory of the same project: dated entries with a bounded Résumé and Détails, searched with `memory_search`, written with `memory_write` (or `memory_update` / `memory_archive`). The opencode plugin also writes there automatically (todo done, review, task end, compaction). Pass `root` as the project root or as the memory dir itself — it is resolved the same way (a legacy `index.json` + `slots/` layout is accepted; outside the workspace the call degrades to the workspace memory with `degraded: true`, it is never refused and never writes outside the workspace) and every response echoes the resolved root. If the lock is still held the write is queued in `.pending/` and replayed on the next call (`pending: true`); unreadable slot files are skipped with `warnings`. A compaction always copies the complete body to `slots/archive/` first (`archivedTo`) and demotes the folded `## ` headings, so a reparse never swallows content. Slots feed the next session; they are not a page.

This skill writes the human-facing narrative: `MEMORY.md` and the vault page. When both apply, distill the slot into the page — never copy it verbatim, and never store prose pages inside a slot.

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
