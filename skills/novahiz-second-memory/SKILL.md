---
name: novahiz-second-memory
description: |
  novahiz-second-memory: manage the Obsidian vault at ~/Documents/second-memory against a
  FIXED, predefined arborescence: root INDEX.md, a _MOC.md per folder, 11 domains with
  predefined branches and memory/docs/journal/decisions leaves. `second-memory project-init`
  gives a new project its docs/journal/decisions folders (never memory: it stays local) and
  binds it to a branch; other folders appear on first write, never speculatively.
  `second-memory doctor` audits and repairs the vault, installs the 10 mandatory plugins.
  Use when the user writes to, organizes, audits, repairs or syncs the second-memory vault,
  or needs past context: search the vault first (`novahiz second-memory search "<terms>"`)
  before answering about earlier decisions, work, preferences, or "my memory".
  Triggers on: second-memory, vault, obsidian, second brain, write to vault, project folder,
  organize vault, sync memory, vault structure, vault lint, doctor, second-memory CLI,
  past context, comme on avait décidé, dans ma mémoire, second memory.
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
├── Code/               ├── Mobile/ ├── Web/ └── Desktop/      each → memory/ docs/ journal/ decisions/
├── Trading/            ├── Markets/ └── Strategies/           each → memory/ docs/ journal/ decisions/
├── AI/                 ├── Models/   └── Datasets/            each → memory/ docs/ journal/ decisions/
├── Design/             ├── Systems/  └── Interface/           each → memory/ docs/ journal/ decisions/
├── DevOps/             ├── Infra/    └── Pipelines/            each → memory/ docs/ journal/ decisions/
├── Security/           ├── Audits/   └── Threats/              each → memory/ docs/ journal/ decisions/
├── Business/           ├── Offers/   └── Growth/               each → memory/ docs/ journal/ decisions/
├── Learning/           ├── Courses/  └── Study-Notes/          each → memory/ docs/ journal/ decisions/
├── Wiki/               ├── Guides/   └── Reference/            each → memory/ docs/ journal/ decisions/
├── Journal/            ├── Daily/    └── Weekly/               (notes leaves)
└── Projects/           ├── Active/   └── Archived/             (notes leaves)
```

Full per-domain detail (MOC titles, leaves, what belongs where): `references/arborescence.md`.

Leaves mean:

- **`memory/`** — evergreen personal notes, split into one subfolder per project
  (`memory/<project>/`, default `general/`). Project memory itself never comes here: it
  stays in the project (`MEMORY.md` + `project-memory/` slots), outside the vault.
- **`docs/`** — reference documentation, same per-project split. Driven by `docsKeywords`
  (guide, spec, api, readme, convention, architecture, faq, …).
- **`journal/`** — running notes, debriefs, field notes; per-project split. Driven by
  `journalKeywords` (journal, quotidien, daily, debrief, carnet, …).
- **`decisions/`** — decisions and their rationale, ADR-style; per-project split. Driven by
  `decisionsKeywords` (decision, choix, arbitrage, adr, option retenue, …). Decision hits
  win over journal, which wins over docs.
- **`Journal/` and `Projects/`** carry `notes` leaves — notes go straight into
  `Daily/`, `Weekly/`, `Active/`, `Archived/`, with no sub-leaves or project level.

## Routing: where a note goes

1. **Domain** — match the title/body/tags against the domain keywords.
2. **Branch** — match within the domain; no match falls back to its first branch.
3. **Leaf** — `decisions` on a `decisionsKeywords` hit, else `journal` on a `journalKeywords`
   hit, else `docs` on a `docsKeywords` hit or when the user says so, else `memory`. A kind
   forced by the caller ignores keywords.
4. **Project folder** — the frontmatter `project`, slugged; `general` when absent. A project
   bound by `project-init` (`vault.json` in the memory root) supplies its domain and branch
   first: every note that names it lands in its branch, whatever the keywords say.
5. **No domain signal** — the note waits in `Inbox/` for triage, never a guessed folder.

Example: *"Revue de sécurité d'une API, checklist OWASP"* → `Security/Audits/docs/general/`.

## Activation

`ensureTarget()` runs on every write: it activates the domain (creating its whole
arborescence), then creates each missing segment with its `_MOC.md` and parent link, then
links the domain from `INDEX.md → ## Categories`. The note is written only once its folder
exists.

`second-memory project-init --name <project> [--branch Domain/Branch] --apply` is the
explicit way to give a project its folders before any write: `docs/ journal/ decisions/<project>/`
with their `_MOC.md`s, plus the branch binding — and no `memory/` folder, because project
memory stays local. Dry-run is the default; `novahiz init` runs the same logic as its
`Obsidian project folder` step. Nothing else creates folders speculatively: without a
write, a folder does not exist.

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
| `project-init` | give a project its folders (`docs/journal/decisions/<project>/`) and bind it to a branch — dry-run default |
| `sync` | retire the old memory mirror: list/archive the vault notes that were slot copies (memory stays local) |
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

1. **Route** — apply the routing rules above.
2. **Read the target MOC** — to name the note and avoid duplicating an existing one.
3. **Write** — with the frontmatter convention (see `references/templates.md`), in the
   user's language. The routed write creates the folder chain and links first.
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

### 3. Retire the mirror (`sync`)

Project memory stays local — `MEMORY.md` and `project-memory/` slots are never written
into the vault. What `sync` still does is clean up what the old mirror produced, plus the
opt-in inverse import:

1. **Dry-run first** — `second-memory sync` prints `would archive project-memory note: <rel>`
   for every note carrying `novahiz_slot_id` (those were copies of slots), and
   `would create slot` for flagged notes.
2. **Archive** — `sync --apply` moves each mirrored note to `Archive/.backup/` (flattened
   `.bak`, same convention as `fix`), then `doctor --apply` drops the now-dangling links.
3. **Kept** — notes imported from the vault (`novahiz_slot_sync: true`) are user notes and
   stay; the inverse import (flagged note → slot in local memory) still runs.
4. **Re-run** must report `no project-memory notes in the vault (memory stays local)`.
5. **Log** — append the result to `log.md`.

### 4. Maintain (weekly review)

1. Triage `Inbox/` → route each note to its domain.
2. Run `doctor` (it checks MOCs, links, INDEX, plugins in one pass).
3. Move completed work to `Archive/`.
4. Append the review summary to `log.md`.

## Frontmatter, templates and log format

See `references/templates.md` for the frontmatter convention, the four note templates and
the `log.md` format.

## Integration with novahiz

- **CLI**: `novahiz second-memory <init|doctor|lint|fix|sync|project-init|status|search> [--apply] [--json] [--no-plugins]`.
- **Memory**: project memory stays local — `memory_search` / `memory_get` read the slots,
  `memory_write` appends them; nothing is mirrored into the vault. A legacy note carrying
  `novahiz_slot_id` is a mirror copy; `sync --apply` archives it (§3).
- **Docs**: vault notes can cite novahiz-docs as `novahiz-docs/<library>@<version>`.
- **Ledger**: structural changes to the vault are logged in the novahiz ledger (task todos).
