---
name: novahiz-memory
description: |
  novahiz-memory is the local context save: the project's MEMORY.md plus the
  project-memory slots. Project memory never leaves the project - no vault write.
  Mandatory frontmatter, wikilinks, merge rather than duplicate.
  Use when a complex task ends, when the user says "update memory" or "save",
  or when a decision, bug root cause, or next step must survive the session.
  Triggers on: "memory", "MEMORY.md", save, "note that".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "3.0.0"
---

# novahiz-memory

A finished session leaves a trace inside the project. It never goes to the Obsidian vault: project memory is read while working on the project, not while browsing the vault.

## Destinations (both local)

| Medium | Path |
|---|---|
| Project | `MEMORY.md` at the current project root |
| Machine | `project-memory/` slots (dated entries with a bounded Résumé and Détails) |

The Obsidian vault belongs to the `novahiz-second-memory` skill: docs, notes, journals and decisions — never project memory. Do not write MEMORY.md content or slots as vault pages, and do not expect `second-memory sync` to mirror anything: sync only archives notes the old mirror left behind.

## project-memory is the machine layer

`project-memory/` (slots) is the machine-facing memory of the same project: dated entries with a bounded Résumé and Détails, searched with `memory_search`, written with `memory_write` (or `memory_update` / `memory_archive`). The opencode plugin also writes there automatically (todo done, review, task end, compaction). Pass `root` as the project root or as the memory dir itself — it is resolved the same way (a legacy `index.json` + `slots/` layout is accepted; outside the workspace the call degrades to the workspace memory with `degraded: true`, it is never refused and never writes outside the workspace) and every response echoes the resolved root. If the lock is still held the write is queued in `.pending/` and replayed on the next call (`pending: true`); unreadable slot files are skipped with `warnings`. A compaction always copies the complete body to `slots/archive/` first (`archivedTo`) and demotes the folded `## ` headings, so a reparse never swallows content. Slots feed the next session; they are not a page.

This skill writes the human-facing narrative: `MEMORY.md` and, when a fact must survive beyond the narrative, a slot. When both apply, distill the slot into the entry — never copy it verbatim, and never store prose pages inside a slot.

## Forbidden

- Writing anything into the Obsidian vault from this skill: memory stays in the project (`MEMORY.md` + `project-memory/`). For vault notes, load `novahiz-second-memory`.
- Editing `index.json` or `slots/archive/` by hand: use the `memory_*` tools.
- Creating a memory folder on your own initiative outside the project.

## What to write

1. What works now.
2. What changed, with the key files.
3. What stays open: next step, debt, blockers.

## Merging

MEMORY.md and slots both carry `title`, dates and `tags`. Pages and entries link with `[[wikilinks]]`. When the subject already exists, enrich it instead of creating a second entry.

## Before writing

Show the chosen local destination (MEMORY.md section or slot title). A declared write is a write you can verify later.

## Pitfalls

- Writing memory into the vault "so it is visible there" — forbidden; it duplicates state that goes stale.
- Duplicating content across two entries instead of enriching the first.
- Copying the session transcript instead of distilling decisions.
- Touching vault maintenance files from this skill.
