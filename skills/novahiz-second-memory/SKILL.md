---
name: novahiz-second-memory
description: |
  novahiz-second-memory: manage the Obsidian vault at ~/Documents/second-memory against a
  FIXED, predefined arborescence — one root INDEX.md as the single entry point, a _MOC.md
  in every folder, 11 domains (Code, Trading, AI, Design, DevOps, Security, Business,
  Learning, Wiki, Journal, Projects) each with predefined branches and memory/docs leaves.
  Writes are routed to a predefined spot, missing folders are auto-created, a domain
  activates whole on first write. `second-memory doctor` audits and repairs the vault and
  installs the 10 mandatory community plugins.
  Use when the user asks to write to, organize, audit, repair or sync the second-memory vault,
  or when an answer needs past context: search the vault first
  (`novahiz second-memory search "<terms>"`) before answering questions about earlier
  decisions, past work, preferences, or anything the user refers to as "my memory".
  Triggers on: second-memory, vault, obsidian, second brain, write to vault,
  organize vault, sync memory, vault structure, vault lint, doctor, second-memory CLI,
  search the vault, what did we decide, earlier notes, past context, comme on avait décidé,
  dans ma mémoire, second memory.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-second-memory: fixed-arborescence Obsidian vault

A personal knowledge vault at `~/Documents/second-memory`, plain Markdown — readable in
Obsidian, any editor, or by any AI agent. Its shape is **not emergent**: the arborescence
is predefined, and every write lands in a predefined spot.

## The contract (non-negotiable)

1. **Fixed arborescence** — content lives only inside the tree below. Nothing is ever
   written at the vault root, and no top-level folder is invented.
2. **`INDEX.md` is the single entry point** — categories → index, subcategories →
   category, subfolders → parent. It links exactly the active domains, nothing else.
3. **Every folder owns a `_MOC.md`** — it indexes its children; children link back to it.
4. **Auto-create** — a write never fails on a missing folder: the whole path is created
   (folder → `_MOC.md` → parent link → `INDEX.md` link) before the note is written.
5. **A domain activates whole** — the first write that routes to a domain materializes its
   complete arborescence, never a partial one.
6. **Folder names in English** — note content stays in the language the user writes in.
7. **Archive ≠ trash** — nothing is deleted; moved or rewritten files are backed up to
   `Archive/.backup/`.
8. **Log everything** — structural changes are appended to `log.md`.

## Machine source of truth

`<novahiz-home>/catalog/vault-structure.json` is authoritative: domains, branches, leaves,
keywords, system folders, plugins. The tree embedded here is the readable contract; when a
keyword or a folder name matters, **read the JSON rather than guessing** — the CLI throws if
the JSON drifts from its own constants.

Overrides for hermetic runs and tests: `NOVAHIZ_SM_VAULT` redirects the vault root,
`NOVAHIZ_SM_MEMORY` redirects the memory root.

## The fixed tree

```
second-memory/
├── INDEX.md            ← single entry point (## Categories = active domains)
├── STRUCTURE.md        ← generated map of this tree, with its rules
├── log.md              ← append-only operation log
├── Inbox/              ← capture with no domain signal, triaged by the user
├── Archive/            ← completed/inactive items + .backup/ (never deleted)
├── Templates/          ← project, course, resource, wiki
├── Excalidraw/         ← plugin data (drawings), declared system folder — never audited, never routed
├── Code/               ├── Mobile/ ├── Web/ └── Desktop/      each → memory/ docs/
├── Trading/            ├── Markets/ └── Strategies/           each → memory/ docs/
├── AI/                 ├── Models/   └── Datasets/            each → memory/ docs/
├── Design/             ├── Systems/  └── Interface/           each → memory/ docs/
├── DevOps/             ├── Infra/    └── Pipelines/            each → memory/ docs/
├── Security/           ├── Audits/   └── Threats/              each → memory/ docs/
├── Business/           ├── Offers/   └── Growth/               each → memory/ docs/
├── Learning/           ├── Courses/  └── Study-Notes/          each → memory/ docs/
├── Wiki/               ├── Guides/   └── Reference/            each → memory/ docs/
├── Journal/            ├── Daily/    └── Weekly/               (notes leaves)
└── Projects/           ├── Active/   └── Archived/             (notes leaves)
```

Full per-domain detail (MOC titles, leaves, what belongs where): `references/arborescence.md`.

Leaves mean:

- **`memory/`** — evergreen personal notes. Split into one subfolder per project
  (`memory/<project>/`, default `general/`); the folder's `_MOC.md` is the index that ties
  those sub-files together, mirroring the Novahiz slot system.
- **`docs/`** — reference documentation, same per-project split. Driven by `docsKeywords`
  (guide, spec, api, readme, convention, architecture, faq, …).
- **`Journal/` and `Projects/`** carry `notes` leaves — notes go straight into
  `Daily/`, `Weekly/`, `Active/`, `Archived/`, with no memory/docs or project level.

## Routing: where a note goes

1. **Domain** — match the title/body/tags against the domain keywords.
2. **Branch** — match within the domain; no match falls back to its first branch.
3. **`memory` vs `docs`** — `docs` when a `docsKeywords` hit or the user says so, else `memory`.
4. **Project folder** — the frontmatter `project`, slugged; `general` when absent.
5. **No domain signal** — the note waits in `Inbox/` for triage, never a guessed folder.

Example: *"Revue de sécurité d'une API, checklist OWASP"* → `Security/Audits/docs/general/`.

## Activation

`ensureTarget()` runs on every write: it activates the domain (creating its whole
arborescence), then creates each missing segment with its `_MOC.md` and parent link, then
links the domain from `INDEX.md → ## Categories`. The note is written only once its folder
exists.

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
- [[Security/_MOC|Security MOC]]

## System
- [[Inbox]]
- [[Archive]]
- [[Templates]]
```

`## Categories` is machine-managed: exactly the active domains, in catalog order.
`second-memory doctor --apply` rewrites it when it drifts (stray or missing links).

## MOC format

```markdown
---
type: moc
title: Mobile MOC
---

# Mobile MOC

## Subcategories
- [[Code/Mobile/memory/_MOC|Memory MOC]]
- [[Code/Mobile/docs/_MOC|Docs MOC]]

## Notes
- [[Code/Mobile/memory/general/react-hooks]]

## Related MOCs
- [[INDEX|Home]]
- [[Code/_MOC|Code MOC]]
```

## Canonical link forms (lint enforces these)

- Home: `[[INDEX|Home]]` — never a bare `[[Home]]`.
- MOCs: full path with alias `[[Code/_MOC|Code MOC]]` — never the `[[Code MOC]]` shortcut.
  The path form is what resolves nested MOCs.
- Notes: full path `[[Code/Mobile/memory/general/react-hooks]]` or plain basename.
- System entries stay short: `[[Inbox]]`, `[[Archive]]`, `[[Templates]]`, `[[Excalidraw]]`.

## Naming

- **Folders**: English, PascalCase for domains/branches, lowercase for leaves
  (`memory`, `docs`, `general`). No spaces — hyphens or underscores (`Study-Notes`).
- **Notes**: `kebab-case`, in the user's language. Example: `audit-owasp.md`.
- **MOCs**: `_MOC.md`, one per folder.

## CLI

`node src/cli.ts second-memory <subcommand> [--apply] [--json] [--no-plugins]` from the
Novahiz home. Dry-run is the default on every mutating subcommand.

| Subcommand | Role |
|---|---|
| `init` | create the skeleton (system folders, `INDEX.md`, `log.md`, `STRUCTURE.md`, templates) **and install the 10 mandatory plugins** |
| `doctor` | audit the whole vault against this tree; `--apply` repairs, with backups |
| `lint` | report structure, naming and link issues — exit 0 means clean |
| `fix` | plan renames, moves, canonical link rewrites, backups, Inbox triage |
| `sync` | memory ↔ vault: last-writer-wins sync, note/slot creation |
| `status` | note counts, categories, open issues, resolved memory root |

`doctor` checks, in order: `vault`, `skeleton`, `arborescence`, `outside-tree folders`,
`links`, `plugins`, `memory`. It exits **1 while issues remain** and 0 when the vault is
clean — run it without `--apply` first, read the `planned:` block, then `--apply`.

## Mandatory plugins (10)

Installed by both `init` and `doctor --apply` into `.obsidian/plugins/` from their GitHub
releases and enabled in `community-plugins.json`; `--no-plugins` skips the download.

`dataview`, `templater-obsidian`, `obsidian-linter`, `omnisearch`, `recent-files-obsidian`,
`tag-wrangler`, `periodic-notes`, `calendar`, `obsidian-excalidraw-plugin`,
`obsidian-style-settings`.

One manual step remains: open Obsidian once and turn off **Settings → Community plugins →
restricted mode**. Core plugins are left to Obsidian's defaults (their config format is not
written by the CLI).

## Workflow

### 1. Create (write new content)

1. **Route** — apply the routing rules above (or let `sync` do it mechanically).
2. **Read the target MOC** — to name the note and avoid duplicating an existing one.
3. **Write** — with the frontmatter convention (see `references/templates.md`), in the
   user's language. `sync`/`create-note` already created the folder chain and links.
4. **Link** — the note is added to its `_MOC.md` under `## Notes`; a new domain is added to
   `INDEX.md`.
5. **Log** — append the operation to `log.md`.

Never invent a folder. If no domain fits, the note goes to `Inbox/` and you tell the user.

### 2. Audit and repair (`doctor`)

1. `second-memory doctor` — read-only. Show the `[fail]`/`[warn]` checks and the `planned:`
   actions to the user.
2. `second-memory doctor --apply` — executes: recreates a missing skeleton, completes a
   partially materialized domain, creates missing MOCs, links unlinked children, relocates
   root notes (after routing them), rewrites `INDEX.md ## Categories`, runs the `fix`
   repairs, installs missing plugins. Every moved file is copied to `Archive/.backup/`
   first (`/` flattened to `__`, extension `.bak`).
3. Re-run `doctor` to confirm `remaining issues: 0`.
4. `outside-tree folders` is a **warning only** — doctor does not move whole folders
   (it would break inbound links). Report them and migrate those notes by hand.

### 3. Sync (memory ↔ vault)

Bidirectional, last-writer-wins, driven by `novahiz_synced_at`:

1. **Dry-run first** — `second-memory sync` prints the plan (`would create note`,
   `would rebuild`, `would pull`, `would push`).
2. **create note** — an active slot without a note becomes one, routed into the fixed tree.
3. **create slot** — a note marked `novahiz_slot_sync: true` that has no `novahiz_slot_id`.
4. **pull / push** — pull when the slot changed later, push when the note did. Writes less
   than 1500 ms apart count as synchronized (no ping-pong).
5. **rebuild** — a note missing `novahiz_synced_at` is rebuilt *from* the slot; the memory
   side is never written on that path.
6. **Apply** — `sync --apply`, then a re-run must report `nothing to sync`. Never `--apply`
   without reading the dry-run: a push overwrites the slot.
7. **Log** — append results to `log.md`.

### 4. Maintain (weekly review)

1. Triage `Inbox/` → route each note to its domain.
2. Run `doctor` (it checks MOCs, links, INDEX, plugins in one pass).
3. Move completed work to `Archive/`.
4. Append the review summary to `log.md`.

## Frontmatter, templates and log format

See `references/templates.md` for the frontmatter convention, the four note templates and
the `log.md` format.

## Integration with novahiz

- **CLI**: `novahiz second-memory <init|doctor|lint|fix|sync|status> [--apply] [--json] [--no-plugins]`.
- **Memory sync**: vault notes link to `project-memory` slots via `novahiz_slot_id`, with
  `novahiz_synced_at` driving LWW. Use `memory_search` to find slots, `memory_get` to read
  them; `sync` handles the rest.
- **Docs**: vault notes can cite novahiz-docs as `novahiz-docs/<library>@<version>`.
- **Ledger**: structural changes to the vault are logged in the novahiz ledger (task todos).
