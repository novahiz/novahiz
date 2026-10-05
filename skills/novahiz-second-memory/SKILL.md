---
name: novahiz-second-memory
description: |
  novahiz-second-memory: manage a dynamic Obsidian vault at ~/Documents/second-memory.
  The vault uses PARA + MOC (Maps of Content) for structure, with emergent categories
  that evolve with content. The skill creates the best tree before writing, auto-corrects
  structure and naming, and stays synchronized with novahiz project-memory.
  Use when the user asks to write to, organize, or sync the second-memory vault.
  Triggers on: second-memory, vault, obsidian, second brain, write to vault,
  organize vault, sync memory, vault structure, vault lint, second-memory CLI.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.1.0"
---

# novahiz-second-memory: dynamic Obsidian vault

A skill that creates and maintains a personal knowledge vault at `~/Documents/second-memory`.
The vault is plain Markdown — readable in Obsidian, any editor, or by any AI agent.

## Core principles

1. **PARA + MOC hybrid** — top-level folders follow PARA (Projects, Areas, Resources, Archives).
   Navigation uses MOCs (Maps of Content): each category has a `_MOC.md` that links to
   everything related, across folder boundaries.
2. **Links over folders** — a note can be linked from multiple MOCs. Don't over-nest.
3. **Emergent structure** — categories appear when content demands them. Never create
   empty "cathedral" folders. The skill proposes the best tree before writing.
4. **Archive ≠ trash** — completed projects move to `Archive/`, never deleted.
5. **Client language** — folder names in English, note content in the language the
   client uses in their prompts.
6. **Log everything** — every structural change is appended to `log.md` with a timestamp.

## Vault location

```
~/Documents/second-memory/
```

On Windows: `C:\Users\<user>\Documents\second-memory\`

## Initial structure

```
second-memory/
├── INDEX.md              ← Home MOC: single entry point, links to all category MOCs
├── log.md                ← append-only operation log (never delete, only append)
├── Inbox/                ← unsorted capture, triaged in weekly review
├── Archive/              ← completed/inactive items, never deleted
└── Templates/            ← note templates (project, course, resource, wiki)
```

Categories (Code, Trading, Wiki, Cours, Projet, etc.) are **emergent** — created when
content first demands them. Each category folder contains a `_MOC.md`.

## Workflow

The mechanical half of this workflow ships in the CLI
(`novahiz second-memory <init|lint|fix|sync|status>`). Dry-run is the default on every
mutating subcommand; `--apply` executes, `--json` prints a machine-readable report.
Environment overrides (tests, CI, hermetic runs): `NOVAHIZ_SM_VAULT` redirects the vault
root, `NOVAHIZ_SM_MEMORY` redirects the memory root.

| Subcommand | Role |
|---|---|
| `init` | create the skeleton (INDEX.md, log.md, Inbox/, Archive/, Templates/) |
| `lint` | report structure, naming and link issues — exit 0 means clean |
| `fix` | plan renames, moves, canonical link rewrites, backups, Inbox triage |
| `sync` | memory ↔ vault: LWW sync, note/slot creation |
| `status` | note counts, categories, open issues, resolved memory root |

### 1. Create (write new content)

When the user asks to write something to the vault:

1. **Analyze** — read `INDEX.md` and existing MOCs to understand current structure.
2. **Propose** — determine the best category/subcategory for the content. If no
   category fits, propose a new one. Show the proposed path to the user.
3. **Create structure** — if a new category is needed, create the folder and its
   `_MOC.md` first. Update parent MOCs and `INDEX.md`.
4. **Write content** — create the note with proper frontmatter, in the client's
   language. Use the appropriate template.
5. **Link** — add the note to the relevant `_MOC.md` and to any other MOCs that
   reference it. Update `INDEX.md` if it's a new category.
6. **Log** — append the operation to `log.md`.

> `second-memory sync` performs steps 1–3 and 5 mechanically for memory slots: keyword
> rules pick the category (Code, Trading, Cours, Wiki, Projet, …), then `ensureCategory`
> creates the folder, its `_MOC.md`, and the `INDEX.md` link — structure always exists
> **before** content is written. Slots with no category signal land in `Inbox/` for triage.

### 2. Correct (lint and fix)

When the user asks to fix, clean, or reorganize the vault:

1. **Scan** — run `second-memory lint` (read-only) and check for:
   - Files with bad names (spaces, special chars, inconsistent casing)
   - Notes in the wrong category
   - Orphan notes (not linked from any MOC)
   - Broken or non-canonical `[[wikilinks]]`
   - Folders without a `_MOC.md`
   - Stale content in `Inbox/`
2. **Propose fixes** — run `second-memory fix` (still dry-run) and show the user what
   will be renamed, moved, rewritten or triaged.
3. **Backup** — automatic: before any rename or move, the original is copied to
   `Archive/.backup/` (slashes flattened to `__`, extension `.bak`).
4. **Execute** — `second-memory fix --apply`: renames and moves first, then link
   rewrites with a re-lint pass; `Inbox/` notes carrying a category signal are triaged
   into their category and linked from its `_MOC.md`.
5. **Log** — append all changes to `log.md`.

### 3. Sync (memory ↔ vault)

Bidirectional, last-writer-wins, driven by the `novahiz_synced_at` frontmatter field:

1. **Dry-run first** — `novahiz second-memory sync` prints the plan (`would create note`,
   `would rebuild`, `would pull`, `would push`) without writing anything.
2. **create note** — an active slot without a note becomes one (emergent category,
   frontmatter stamped with `novahiz_slot_id` and `novahiz_synced_at`).
3. **create slot** — a note marked `novahiz_slot_sync: true` (opt-in) that has no
   `novahiz_slot_id` becomes a memory slot; the note is then stamped with the new id.
4. **pull / push** — pull (slot → note) when the slot changed after the last sync; push
   (note → slot) when the note changed. Writes less than 1500 ms apart count as
   synchronized (stability, no ping-pong).
5. **rebuild** — a note missing `novahiz_synced_at` (written by an older version) is
   rebuilt **from** the slot: the memory side is never written on this path.
6. **Apply** — `sync --apply` executes the plan; a re-run must report `nothing to sync`.
   Never `--apply` without reading the dry-run: a push overwrites the slot with the
   note's content.
7. **Log** — append sync results to `log.md`.

### 4. Maintain (weekly review)

1. **Triage Inbox** — move unsorted notes to their correct category.
2. **Check MOCs** — ensure every category has a `_MOC.md` and it's up to date.
3. **Archive** — move completed projects to `Archive/`.
4. **Log** — append review summary to `log.md`.

## Frontmatter convention

Every note starts with YAML frontmatter:

```yaml
---
type: project | course | resource | wiki | area
title: Note title
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active | archived | draft
tags: [tag1, tag2]
novahiz_slot_id: slot-XXX        # optional, set by sync for linked notes
novahiz_synced_at: ISO-8601      # optional, written by sync; drives LWW
novahiz_slot_sync: true          # optional, opt-in: make this note a memory slot
---
```

## Canonical link forms (lint enforces these)

- Home: `[[INDEX|Home]]` — never a bare `[[Home]]`.
- MOCs: `[[Code/_MOC|Code MOC]]` — never the `[[Code MOC]]` shortcut.
- Notes: full path `[[Code/some-note]]` or plain basename `[[some-note]]`.
- System entries stay short: `[[Inbox]]`, `[[Archive]]`, `[[Templates]]`.

`second-memory lint` flags any non-canonical form; `second-memory fix` rewrites it
(backup first, Obsidian resolves the canonical target the same way).

## MOC format

Each `_MOC.md` follows this structure:

```markdown
---
type: moc
title: Category Name MOC
---

# Category Name MOC

## Subcategories
- [[Subcategory A]]
- [[Subcategory B]]

## Notes
- [[Note 1]] — brief description
- [[Note 2]] — brief description

## Related MOCs
- [[INDEX|Home]]
- [[OtherCategory/_MOC|Other Category MOC]]
```

## Naming conventions

- **Folders**: `PascalCase` or `kebab-case`, English. Examples: `Code/`, `Trading/`, `Inbox/`.
- **Notes**: `kebab-case`, English or client language. Examples: `react-hooks-guide.md`, `projet-novahiz.md`.
- **MOCs**: `_MOC.md` in each category folder.
- **No spaces** in file or folder names. Use hyphens or underscores.

## Templates

### Project note
```markdown
---
type: project
title: Project Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [project]
---

# Project Name

## Goal
What is this project trying to achieve?

## Progress
- [ ] Task 1
- [ ] Task 2

## Notes
- [[Related Note]]

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

### Course note
```markdown
---
type: course
title: Course Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [course]
---

# Course Name

## Key concepts
- Concept 1
- Concept 2

## Resources
- [[Related Resource]]

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

### Resource note
```markdown
---
type: resource
title: Resource Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [resource]
---

# Resource Name

## Summary
Brief description of the resource.

## Key takeaways
- Takeaway 1
- Takeaway 2

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

### Wiki note
```markdown
---
type: wiki
title: Wiki Article Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [wiki]
---

# Wiki Article Name

## Overview
Brief overview.

## Details
Detailed content.

## See also
- [[Related Note]]

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

## INDEX.md format

```markdown
---
type: index
title: Second Memory
---

# Second Memory

Personal knowledge vault. Start here.

## Categories
- [[Code/_MOC|Code MOC]]
- [[Trading/_MOC|Trading MOC]]
- [[Wiki/_MOC|Wiki MOC]]
- [[Cours/_MOC|Cours MOC]]
- [[Projet/_MOC|Projet MOC]]

## System
- [[Inbox]]
- [[Archive]]
- [[Templates]]
```

## log.md format

```markdown
# Second Memory Log

Append-only. Never delete entries.

## 2026-10-04
- 15:30 — vault initialized
- 15:35 — created Code/ category with _MOC.md
- 15:40 — wrote note: react-hooks-guide.md
```

## Integration with novahiz

- **CLI**: `novahiz second-memory <init|lint|fix|sync|status> [--apply] [--json]` —
  dry-run by default; `NOVAHIZ_SM_VAULT` / `NOVAHIZ_SM_MEMORY` redirect the roots
  (hermetic test environments).
- **Memory sync**: vault notes link to `project-memory` slots via `novahiz_slot_id`
  frontmatter, with `novahiz_synced_at` driving the last-writer-wins direction. Use
  `memory_search` to find slots, `memory_get` to read them; `sync` handles the rest
  (including rebuild of legacy notes stamped by an older version).
- **Docs**: vault notes can reference novahiz-docs citations using the
  `novahiz-docs/<library>@<version>` format (see novahiz-implement skill).
- **Ledger**: structural changes to the vault are logged in the novahiz ledger
  (task todos) for traceability.
