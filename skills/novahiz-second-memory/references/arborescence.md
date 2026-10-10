# Arborescence — domain reference

Authoritative copy: `<novahiz-home>/catalog/vault-structure.json`. This file is the readable
view of the same data: folder names, MOC titles, branches and what belongs in each leaf.
Keywords are **not** duplicated here on purpose — they change more often than the tree does.
Read them from the JSON before routing.

## Shape

```
<Domain>/<Branch>/<leaf>/<project>/<note>.md     # leaf = memory | docs | journal | decisions
<Domain>/<Branch>/<note>.md                      # leaf = notes (Journal, Projects)
```

- `<project>` is the frontmatter `project` slugged, default `general`.
- Every folder in the path owns a `_MOC.md`; the leaf's `_MOC.md` indexes its project
  sub-folders, which is what makes each leaf readable as several sub-files behind one index.
- `second-memory project-init` creates a project's `docs/ journal/ decisions/` sub-folders
  and binds the project to its branch (`vault.json` in the memory root). It never creates
  `memory/<project>/` for a project: project memory stays local to the project.

## Domains

| Domain (folder) | MOC title | Branches | Notes |
|---|---|---|---|
| `Code` | Code | `Mobile`, `Web`, `Desktop` | apps, libs, APIs — Flutter/Expo/Kotlin, Next/React, Electron/Tauri |
| `Trading` | Trading | `Markets`, `Strategies` | market analysis, setups, backtests, risk |
| `AI` | **AI & Data** | `Models`, `Datasets` | LLM/prompts/RAG, datasets, analytics |
| `Design` | Design | `Systems`, `Interface` | tokens, palette, typography / screens, layout, UX |
| `DevOps` | DevOps | `Infra`, `Pipelines` | cloud, k8s, nginx / CI/CD, releases, monitoring |
| `Security` | Security | `Audits`, `Threats` | audits, checklists, hardening / CVEs, incidents |
| `Business` | Business | `Offers`, `Growth` | pricing, positioning / SEO, acquisition, retention |
| `Learning` | Learning | `Courses`, `Study-Notes` | MOOCs, certifications / fiches, revisions, flashcards |
| `Wiki` | Wiki | `Guides`, `Reference` | how-tos, procedures / specs, conventions, glossary |
| `Journal` | Journal | `Daily`, `Weekly` | **notes leaves** — no memory/docs, no project level |
| `Projects` | Projects | `Active`, `Archived` | **notes leaves** — roadmaps, milestones, retros |

Three naming traps:

- the folder is `AI`, its MOC title is `AI & Data`;
- the folder is `Study-Notes`, its MOC title is `Study Notes`;
- every branch above carries `memory/`, `docs/`, `journal/` and `decisions/` except the four
  `notes` leaves (`Journal/Daily`, `Journal/Weekly`, `Projects/Active`, `Projects/Archived`).

## System folders (outside the graph)

`Inbox/`, `Archive/`, `Templates/` are not domains: they never get a `_MOC.md` and are never
listed under `INDEX.md → ## Categories`. `Archive/.backup/` holds the pre-change copies
(`/` flattened to `__`, extension `.bak`).

## Routing, step by step

1. **Domain** — lowercase the title + body + tags, score each domain by the number of
   distinct keywords it hits (`matchNode`). The highest score wins; a tie goes to the
   catalog order. Without a domain hit, the same scoring runs over **branch** keywords and
   the winner's parent domain is used — so `flutter` reaches `Code/Mobile` even though
   `flutter` is not a Code keyword. Zero hits on both passes → `Inbox/`.
2. **Branch** — the branch hinted by pass 2, else the best-scoring branch of the chosen
   domain; no hit → the domain's **first** branch (`Code → Mobile`, `Trading → Markets`, …).
3. **Leaf** — `decisions` if a `decisionsKeywords` hit (decision, choix, arbitrage, adr,
   option retenue), else `journal` if a `journalKeywords` hit (journal, quotidien, daily,
   debrief, carnet, …), else `docs` if a `docsKeywords` hit (guide, spec, api, readme,
   convention, architecture, tutorial, faq, glossary, …) or the user asked for
   documentation, else `memory`. With a kind forced by the caller, keywords are ignored.
4. **Project** — frontmatter `project` slugged, default `general`. Skipped on `notes`
   leaves. When the project is bound (`project-init` → `vault.json`), steps 1–2 read the
   binding first: the note lands in the project's branch whatever the keywords say.

`ensureTarget()` then activates the domain and creates every missing segment, MOC and link
before the note is written.

## Doctor checks

| Check | Severity | Meaning | Repair |
|---|---|---|---|
| `vault` | fail | vault directory missing | `second-memory init` |
| `skeleton` | fail | `INDEX.md`, `STRUCTURE.md` or a system folder absent | recreate via `init` |
| `arborescence` | fail | note at vault root, folder without `_MOC.md`, child MOC not linked from its parent, domain partially materialized, `INDEX ## Categories` drifted | `doctor --apply` |
| `outside-tree folders` | warn | top-level folder not in the catalog | migrate those notes manually |
| `links` | fail / warn | broken wikilinks, non-canonical forms, orphans (errors / warnings) | `doctor --apply` (runs `fix`) |
| `plugins` | fail | a mandatory plugin missing or disabled | `doctor --apply` (or `--no-plugins` to skip) |
| `memory` | warn | project-memory notes still in the vault (old mirror) | `second-memory sync --apply` (archive), then `doctor --apply` |

Exit code is 1 while any `fail` remains, 0 when clean. `--apply` never deletes: it backs up
to `Archive/.backup/` before moving or rewriting anything.

## Adding a specialty domain (12th, 13th, …)

The 11 domains above are the standard set. A community member's specialty adds a 12th, and
it activates exactly like the others — whole arborescence on first write. There is no
`domain add` command: the JSON is the contract, so the edit stays deliberate and reviewed.

1. Open `<novahiz-home>/catalog/vault-structure.json` and append one object to `domains`:

   ```json
   {
     "id": "photo",
     "name": "Photo",
     "title": "Photo",
     "kind": "domain",
     "keywords": ["photo", "lightroom", "iso", "raw", "objectif"],
     "children": [
       {
         "id": "technique",
         "name": "Technique",
         "title": "Technique",
         "kind": "branch",
         "keywords": ["bokeh", "tripod", "ouverture", "diafragme"],
         "children": [
           { "id": "memory", "name": "memory", "title": "Memory", "kind": "memory" },
           { "id": "docs", "name": "docs", "title": "Docs", "kind": "docs" },
           { "id": "journal", "name": "journal", "title": "Journal", "kind": "journal" },
           { "id": "decisions", "name": "decisions", "title": "Decisions", "kind": "decisions" }
         ]
       }
     ]
   }
   ```

2. Rules that cannot be bent:
   - `name` is the folder name — **English, PascalCase, no spaces** (`Study-Notes` style).
   - `title` is the MOC title and may differ from `name` (`AI` → `AI & Data`).
   - `kind` is `domain` at the root, `branch` in between; leaves are `memory` / `docs` /
     `journal` / `decisions`, or `notes` when the branch holds notes directly (no project
     level, like `Journal/Daily`).
   - `keywords` are the routing signal: domain keywords pick the domain, branch keywords
     pick the branch *and* serve as a fallback domain signal. Scoring is by number of hits
     with catalog order breaking ties — prefer keywords that do not collide with an
     existing domain (`api` already belongs to `Code`, `guide` to `Wiki`).
3. Validate:

   ```
   node src/cli.ts second-memory doctor --json   # reads the new catalog end to end
   node src/cli.ts doctor                        # skills index and gate still clean
   ```

   The CLI throws at load time if the JSON drifts from its own constants (`INDEX.md`,
   `log.md`, `_MOC.md`), so a structural mistake fails loudly instead of silently.
4. Nothing is written to the vault until content routes to the new domain — then
   `ensureTarget()` builds it whole and links it from `INDEX.md → ## Categories`.
