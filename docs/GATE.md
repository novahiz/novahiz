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
│  src/components/Hero.tsx → "design"                         │
│                                                             │
│  Rules:                                                     │
│  • *.ts, *.js, *.py, *.go, *.sql, *.sh, ... → "code"       │
│  • *.css, *.scss, *.html, *.vue, *.svelte, *.tsx → "design" │
│  • *.md, *.txt, *.rst → "text"                             │
│  • *.json, *.yaml, *.toml, *.csv → "data"                  │
│  • *.env, *.ini, *.cfg, dotfiles → "config"                │
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
│  R14-impeccable:                                            │
│    match: any                                               │
│    promptCategories: ["design-ui"] OR pathGlobs: css/html   │
│    → require impeccable (critique/audit/polish playbooks)   │
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
│  Non-optional skill steps (kind: "skill" only):            │
│  • plan → novahiz-plan                                 │
│  • clarify → novahiz-clarify                           │
│  • inspect → novahiz-analyse                           │
│  • load → novahiz-supabase                             │
│  • security → novahiz-postgres                         │
│                                                             │
│  Skipped (kind is not "skill"):                            │
│  • migration (edit), test (verify), converge (verify),     │
│    document (advisory) — listed in the roadmap, never      │
│    added to requiredSkills                                │
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
│  missingSkills: ["novahiz-supabase", "novahiz-postgres"]    │
│  reasons: ["missing skill: novahiz-supabase"]               │
│                                                             │
│  Exit code: 2 → ADAPTER THROWS → MODEL SEES ERROR          │
└─────────────────────────────────────────────────────────────┘
```

## File classes

The gate classifies files by extension:

| Class | Extensions |
|-------|------------|
| `code` | `.ts`, `.js`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.php`, `.dart`, `.rb`, `.c`, `.cpp`, `.h`, `.sh`, `.ps1`, `.sql` |
| `design` | `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.html`, `.htm`, `.vue`, `.svelte`, `.astro`, `.jsx`, `.tsx` |
| `text` | `.md`, `.mdx`, `.txt`, `.rst`, `.adoc` |
| `data` | `.json`, `.jsonc`, `.yaml`, `.yml`, `.toml`, `.csv`, `.tsv`, `.xml` |
| `config` | `.env`, `.ini`, `.cfg`, `.conf`, dotfiles (`.gitignore`, `.eslintrc.json`, …) |
| `other` | anything else (including `.db` and `.sqlite`, which have no mapping) |

Note the deliberate differences from intuition: `.tsx`/`.jsx` are `design` (component styling surfaces), `.json`/`.yaml` are `data`, and `.sql` is `code`.

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
