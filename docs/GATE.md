# Gate System

The gate is the enforcement mechanism. It inspects every file edit and decides whether to allow or block it based on loaded skills, file class, and content analysis.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                    TOOL CALL (edit/write/patch)             │
│                    file: src/components/Hero.tsx            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 FILE CLASSIFICATION                         │
│                                                             │
│  src/components/Hero.tsx → "code"                          │
│                                                             │
│  Rules:                                                     │
│  • *.ts, *.tsx, *.js, *.jsx, *.py, *.go, ... → "code"     │
│  • *.css, *.scss, *.html, *.vue, *.svelte → "design"      │
│  • *.md, *.txt, *.rst → "text"                             │
│  • *.json, *.yaml, *.toml → "config"                       │
│  • *.csv, *.sql, *.db → "data"                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 RULE MATCHING                               │
│                                                             │
│  For each rule in catalog/rules.json:                       │
│                                                             │
│  R13-design-craft:                                          │
│    match: any                                               │
│    promptCategories: ["design-ui"] OR pathGlobs: css/html   │
│    → Is this a frontend design task?                        │
│      If YES: require novahiz-humanizer                      │
│              + ui-slop-remover + ui-craft-rules             │
│    (Humanizer and ui-slop-remover are design-only.)         │
│                                                             │
│  R3-supabase:                                               │
│    promptCategories: ["database-supabase"]                  │
│    → Was the prompt classified as Supabase?                 │
│      require novahiz-supabase + novahiz-postgres  │
│                                                             │
│  R4-playwright:                                             │
│    promptCategories: ["browser"]                            │
│    → require novahiz-browser                           │
│                                                             │
│  R6-Novahiz:                                           │
│    promptCategories: workflow categories                    │
│    → require plan/clarify/analyse/implement/converge        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 ROADMAP ENFORCEMENT                         │
│                                                             │
│  Primary category: database-supabase                        │
│  Roadmap: schema                                            │
│                                                             │
│  Non-optional skill steps:                                  │
│  • plan → novahiz-plan                                 │
│  • clarify → novahiz-clarify                           │
│  • inspect → novahiz-analyse                           │
│  • load → novahiz-supabase                             │
│  • migration → novahiz-implement                       │
│  • security → novahiz-postgres                         │
│  • converge → novahiz-converge                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 SKILL VERIFICATION                          │
│                                                             │
│  Check installed skills index (build/installed-skills.json):│
│  • Is the skill installed? If not → unmatchedRequired       │
│    (reported but does NOT block — the skill doesn't exist)  │
│                                                             │
│  Check loaded skills in session:                            │
│  • Is the skill loaded? If not → missingSkills              │
│    (BLOCKS the edit)                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 CONTENT ANALYSIS                            │
│                                                             │
│  Placeholder detection:                                     │
│  • TODO, FIXME, XXX, HACK markers                           │
│  • "not implemented", "coming soon"                         │
│  • <placeholder>, <your_code>                               │
│  • lorem ipsum, ... rest of, implement me                   │
│                                                             │
│  If placeholders found in code/design → BLOCK               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 VERDICT                                     │
│                                                             │
│  allow: false                                               │
│  missingSkills: ["supabase", "supabase-postgres-best-..."]  │
│  reasons: ["missing skill: supabase"]                       │
│                                                             │
│  Exit code: 2 → ADAPTER THROWS → MODEL SEES ERROR          │
└─────────────────────────────────────────────────────────────┘
```

## File classes

The gate classifies files by extension:

| Class | Extensions |
|-------|------------|
| `code` | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.php`, `.dart`, `.rb`, `.c`, `.cpp`, `.h` |
| `design` | `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.html`, `.vue`, `.svelte`, `.astro` |
| `text` | `.md`, `.txt`, `.rst`, `.adoc` |
| `config` | `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env` |
| `data` | `.csv`, `.sql`, `.db`, `.sqlite` |

## Rule selectors

Each rule has a `when` block with optional selectors:

| Selector | Meaning |
|----------|---------|
| `fileClasses` | Match the file's class |
| `pathGlobs` | Match the file path against glob patterns |
| `promptCategories` | Match the prompt's classified categories |
| `contentMatches` | Check if the diff content contains prose/style/regex |
| `contentExcludes` | Check if the diff content does NOT contain patterns |

Selectors are combined with `when.match`:
- `"all"` (default) — ALL selectors must match
- `"any"` — ANY selector can match

## Content analysis

- **`hasProse`** — detects natural language in code changes (comments, strings, documentation)
- **`hasStyle`** — detects CSS/styling patterns (className, styled-components, tailwind classes)
- **`isTrivial`** — detects very small changes (below `minChange` threshold)
- **`hasPlaceholder`** — detects TODO/FIXME markers and placeholder content

## Ignored files

The gate ignores these patterns by default:
```
**/node_modules/**, **/dist/**, **/build/**, **/coverage/**
**/vendor/**, **/*.min.*, **/*.map, **/package-lock.json
**/pnpm-lock.yaml, **/yarn.lock, **/bun.lockb
**/__snapshots__/**, **/*.snap, **/*.generated.*
```

## Gate modes

| Mode | Behavior |
|------|----------|
| `block` | Missing skills → edit is blocked (exit 2) |
| `warn` | Missing skills → warning logged, edit allowed |
| `audit` | Missing skills → logged for review, edit allowed |

## Escape hatch

Set `NOVAHIZ_GATE=off` (or `NOVAHIZ_GATE=0`) to disable the gate entirely for a session.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Edit allowed |
| `1` | Gate error (install issue, bad config) |
| `2` | Edit blocked (missing skills or placeholder) |
