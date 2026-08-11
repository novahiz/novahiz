---
name: obsidian-organizer
description: 'Obsidian vault organization, file naming, and knowledge graph management. Use when: renaming files for clarity, creating wikilinks between notes, building MOCs (Maps of Content), reorganizing folder structures, improving discoverability, creating neural-network-like connections between notes, fixing vague filenames, setting up frontmatter, or managing the Obsidian vault at C:\Users\tawhi\Documents\novahiz. Also triggers on: ''rename file'', ''link notes'', ''organize vault'', ''fix filename'', ''MOC'', ''knowledge graph'', ''wikilink'', ''frontmatter'', ''vault cleanup'', ''file naming'', ''note organization''. ALWAYS use for any Obsidian vault operation.'
---

# Obsidian Organizer

A comprehensive skill for managing Obsidian vaults: intelligent file naming, neural-network-like linking, knowledge graph construction, and vault hygiene.

## Core Philosophy

A well-organized vault is a **thinking tool**, not a filing cabinet. Every filename should answer: "What is this about?" Every link should answer: "How does this connect?" The goal is a knowledge graph where finding anything takes ≤3 clicks.

---

## 1. FILE NAMING SYSTEM

### The Problem with Bad Names

Bad filenames: `notes.md`, `todo.md`, `idea2.md`, `meeting stuff.md`, `Untitled.md`
Good filenames: `2024-01-15-meeting-product-roadmap.md`, `recipe-sourdough-bread.md`, `bug-login-crash-analysis.md`

### Naming Rules (Enforced)

1. **Descriptive**: The filename MUST describe the content. A stranger should guess what's inside.
2. **Kebab-case**: All lowercase, words separated by hyphens. `my-note.md` not `My Note.md`.
3. **Date prefix for temporal notes**: `YYYY-MM-DD-descriptor.md` for daily notes, meeting notes, logs.
4. **Prefix for type** (optional but recommended):
   - `dec-` for decisions: `dec-use-postgres-over-mysql.md`
   - `bug-` for bugs: `bug-login-crash-analysis.md`
   - `feat-` for features: `feat-user-authentication.md`
   - `pat-` for patterns: `pat-repository-pattern.md`
   - `ref-` for references: `ref-owasp-top-10.md`
5. **No abbreviations** unless universally understood (JS, CSS, API, SQL).
6. **No special characters**: Only `[a-z0-9-]`. No spaces, underscores, accents, emojis.
7. **Max 60 characters**: Keep it scannable. If longer, use a subtitle in frontmatter.
8. **No duplicates**: Search vault before creating. Similar topics → same note or clear prefix distinction.

### Naming Templates

| Content Type | Template | Example |
|-------------|----------|---------|
| Daily note | `YYYY-MM-DD` | `2024-01-15.md` |
| Meeting note | `YYYY-MM-DD-meeting-{topic}` | `2024-01-15-meeting-sprint-planning.md` |
| Decision | `dec-{decision-slug}` | `dec-use-trpc-over-rest.md` |
| Bug report | `bug-{bug-slug}` | `bug-null-pointer-auth-service.md` |
| Feature spec | `feat-{feature-slug}` | `feat-dark-mode-toggle.md` |
| Architecture | `arch-{system}` | `arch-microservices-auth.md` |
| Reference | `ref-{topic}` | `ref-postgres-indexing.md` |
| Pattern | `pat-{pattern-name}` | `pat-circuit-breaker.md` |
| Project memory | `00-README`, `01-Architecture`, etc. | Standard Karpathy Protocol |
| Zettelkasten | `{descriptive-slug}` | `emergence-in-complex-systems.md` |
| MOC | `MOC-{topic}` | `MOC-Development.md` |

### Renaming Workflow

When a file has a bad name:
1. Read the file content to understand what it's actually about
2. Generate 3 name candidates following the rules above
3. Present candidates to user with rationale for each
4. On approval: use `obsidian_move_note` to rename
5. Update ALL wikilinks pointing to the old name (search `[old-name]` in vault)
6. Update frontmatter if it references the filename
7. Log the rename in the changelog if it's a project file

---

## 2. NEURAL-NETWORK LINKING SYSTEM

### Philosophy

Every note should be a **node** in a knowledge graph. Links are **synapses**. The more connections a note has, the more discoverable it becomes. Target: every non-isolated note has ≥3 incoming or outgoing links.

### Link Types

| Type | Syntax | When to Use |
|------|--------|-------------|
| **Wikilink** | `[[note-name]]` | Direct connection to another note |
| **Wikilink + alias** | `[[note-name\|display text]]` | When the natural label differs from filename |
| **Section link** | `[[note-name#section]]` | Link to specific heading within a note |
| **Embed** | `![[note-name]]` | Show content inline (images, quotes, code blocks) |
| **Tag** | `#tag-name` | Categorical grouping (not hierarchical) |
| **Frontmatter link** | `related: [note1, note2]` | Structured metadata connections |
| **Block link** | `[[note-name#^block-id]]` | Link to specific block (paragraph, list item) |

### Linking Strategy

#### Hub-and-Spoke Pattern
```
MOC-Development.md (HUB)
├── [[react-patterns]]
├── [[nextjs-best-practices]]
├── [[typescript-tips]]
└── [[css-architecture]]
```
Hubs (MOCs) connect to many spokes (topic notes). Spokes connect to other spokes when relevant.

#### Bidirectional Linking
When Note A links to Note B, check if Note B should link back to Note A. Backlinks are automatic in Obsidian, but explicit links in the body are stronger signals.

#### Temporal Linking
Daily notes link to:
- Previous day: `[[2024-01-14]]`
- Next day: `[[2024-01-16]]`
- Related project notes discussed that day

#### Conceptual Clustering
Group related concepts by linking them densely:
```
[[authentication]]
  ├── [[jwt-tokens]]
  ├── [[oauth2-flow]]
  ├── [[session-management]]
  └── [[password-hashing]]
```

### Auto-Linking Workflow

When creating or editing a note:
1. Extract key concepts from the content (nouns, technical terms, proper names)
2. Search vault for existing notes matching these concepts
3. For each match: add a wikilink in the relevant context
4. For concepts without existing notes: add a `#TODO-create-note` tag
5. Update the relevant MOC(s) to include this note
6. Ensure the note appears in at least one MOC

---

## 3. MOC (MAP OF CONTENT) MANAGEMENT

### MOC Structure Template

```markdown
---
project: "{project-name}"
updated: YYYY-MM-DD
type: moc
---

# MOC: {Topic Name}

> Central hub for all notes related to {topic}. Updated {date}.

## Core Concepts
- [[concept-1]] — Brief description
- [[concept-2]] — Brief description

## Related MOCs
- [[MOC-Related-Topic]]

## Open Questions
- [ ] What about X?
- [ ] Need to explore Y

## References
- [[ref-source-1]]
- [[ref-source-2]]
```

### MOC Maintenance Rules

1. Every project folder gets a `MOC-{ProjectName}.md` at the root level
2. Every topic area gets a MOC in `/05-MOCs/`
3. MOCs are **living documents** — update them when adding/removing notes
4. Each MOC entry has a one-line description of what the linked note contains
5. Dead links in MOCs are cleaned up weekly
6. MOCs link to each other when topics overlap

---

## 4. FRONTMATTER SCHEMA

### Standard Frontmatter (Karpathy Protocol)

Every file MUST have at minimum:

```yaml
---
project: "{project-name-or-vault}"
updated: YYYY-MM-DD
---
```

### Extended Frontmatter (Recommended)

```yaml
---
project: "{project-name}"
updated: YYYY-MM-DD
type: note | decision | changelog | issue | snippet | moc | daily | meeting
tags: [tag1, tag2]
related: [other-note-1, other-note-2]
status: draft | active | archived
source: "URL or source description"
---
```

### Frontmatter Rules

1. `updated` date MUST be current date on every edit
2. `tags` use kebab-case: `react-patterns` not `React Patterns`
3. `related` is an array of note names (without .md extension)
4. `type` helps Obsidian's Dataview plugin query notes
5. Never put content in frontmatter — it's metadata only

---

## 5. VAULT HYGIENE

### Daily Maintenance (Automated)

- Check for orphan notes (no incoming or outgoing links)
- Check for broken wikilinks
- Check for files without frontmatter
- Check for duplicate content

### Weekly Maintenance

- Review MOCs — add new notes, remove dead links
- Check naming conventions compliance
- Archive completed project notes
- Consolidate similar notes

### Monthly Maintenance

- Full vault audit: folder structure, naming, linking density
- Update MOCs with new sections
- Archive old daily notes (>3 months)
- Generate vault health report

### Orphan Resolution

When an orphan note is found:
1. Read its content
2. Determine which MOC(s) it belongs to
3. Add it to the relevant MOC(s)
4. Find 2-3 other notes it should link to
5. Add wikilinks in both directions
6. If it doesn't fit anywhere: create a new MOC or archive it

---

## 6. FOLDER STRUCTURE

### Recommended Layout

```
vault/
├── 00-Inbox/          # New, unprocessed notes
├── 01-Projects/       # Project-specific folders
│   └── {project}/
│       ├── 00-README.md
│       ├── 01-Architecture.md
│       ├── 02-Decisions.md
│       ├── 03-Changelog.md
│       ├── 04-Issues.md
│       └── 05-Snippets.md
├── 02-Areas/          # Ongoing areas of responsibility
│   └── {area}/
├── 03-Resources/      # Reference material
├── 04-Zettelkasten/   # Atomic notes (one idea each)
├── 05-MOCs/           # Maps of Content
├── 06-Daily/          # Daily notes
├── 07-Archive/        # Completed/inactive
├── 08-System/         # Vault configuration, logs
└── 99-Attachments/    # Images, PDFs, media
```

### Folder Rules

1. Max 3 levels deep. If deeper, reorganize.
2. Every folder gets a `README.md` or `_index.md` explaining its purpose.
3. Empty folders are deleted (no "just in case" placeholders).
4. Files in wrong folders are moved, not left with a note.

---

## 7. SEARCH AND DISCOVERABILITY

### Finding Notes

Before creating a new note, ALWAYS search:
1. Exact name match (might already exist)
2. Partial name match (might be similar)
3. Tag search (might be categorized already)
4. Content search (might be covered in another note)

### Obsidian Search Operators

- `file:name` — search by filename
- `tag:#tagname` — search by tag
- `path:folder/` — search within folder
- `content:"search term"` — full-text search
- `section:heading` — search by heading

---

## 8. BATCH OPERATIONS

### When to Use

- Renaming 5+ files with a pattern
- Adding frontmatter to files missing it
- Updating links across the vault
- Creating MOCs for existing notes

### Workflow

1. Plan the batch operation (what, why, expected result)
2. Show the user a preview of changes
3. Execute one file at a time (not bulk — safer)
4. Verify each change before moving to the next
5. Report summary at the end

---

## 9. INTEGRATION WITH OTHER SKILLS

### novahiz-memory

When `novahiz-memory` triggers, use this skill to:
- Ensure proper naming of new memory files
- Add wikilinks between memory files
- Update relevant MOCs
- Maintain frontmatter consistency

### humanizer

When writing note content, apply humanizer principles:
- Clear, natural language
- No AI patterns in prose
- Concise descriptions in MOCs

### code-review-excellence

When reviewing code-related notes:
- Ensure code snippets have proper context
- Link to relevant architecture decisions
- Tag appropriately for discoverability

---

## 10. COMMANDS AND SHORTCUTS

### Quick Actions

| Task | Command |
|------|---------|
| Create note with proper naming | `obsidian-write` with generated name |
| Rename note | `obsidian_move_note` + update links |
| Add to MOC | `obsidian_patch_note` to append entry |
| Link notes | `obsidian_patch_note` with wikilinks |
| Check orphans | `obsidian_search_notes` for unlinked notes |
| Add frontmatter | `obsidian_update_frontmatter` |

---

## 11. QUALITY CHECKLIST

Before considering a vault operation complete:

- [ ] Filename follows naming rules (kebab-case, descriptive, ≤60 chars)
- [ ] Frontmatter has `project` and `updated` fields
- [ ] Note has ≥2 wikilinks (outgoing)
- [ ] Note appears in at least one MOC
- [ ] No broken links introduced
- [ ] Tags are kebab-case and meaningful
- [ ] Related notes link back (or are in MOC)
