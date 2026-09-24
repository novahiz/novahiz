# Classification Engine

The classifier is the brain of Novahiz. It maps a natural language prompt to categories, required skills, and execution roadmaps — deterministically, with no model calls.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                      USER PROMPT                            │
│            "ajoute une migration supabase avec rls"         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    TEXT FOLDING                             │
│  1. Lowercase all text                                      │
│  2. Remove accents (é→e, è→e, ç→c)                        │
│  3. Normalize whitespace                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 KEYWORD SCORING                             │
│                                                             │
│  For each category:                                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  category: "database-supabase"                      │    │
│  │  keywords: ["supabase", "postgres", "sql", "rls",  │    │
│  │             "migration", "edge function", ...]      │    │
│  │                                                     │    │
│  │  Matched: "supabase" ✓  score += 1.0               │    │
│  │  Matched: "migration" ✓ score += 1.0               │    │
│  │  Matched: "rls" ✓       score += 1.0               │    │
│  │                                                     │    │
│  │  negativeKeywords: ["mockup", "landing"]            │    │
│  │  Matched: none ✓        no penalty                  │    │
│  │                                                     │    │
│  │  FINAL SCORE: 3.0                                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Scoring rules:                                             │
│  • Single keyword match: +1.0                               │
│  • Multi-word keyword match: +1.5 (1.0 + 0.5 bonus)       │
│  • Negative keyword match: -1.0                             │
│  • Confidence = score / (score + 2)                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    RANKING                                  │
│                                                             │
│  Sort by:                                                   │
│  1. Score (descending)                                      │
│  2. Category priority (descending)                          │
│  3. Category ID (alphabetical, tiebreak)                    │
│                                                             │
│  Keep top N categories (default: 3)                         │
│  Compute margin = score - next score                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    OUTPUT                                   │
│                                                             │
│  categories: [                                              │
│    { id: "database-supabase", score: 3.0, confidence: 0.6 }│
│  ]                                                          │
│  primary: "database-supabase"                               │
│  requiredSkills: ["supabase", "supabase-postgres-best-..."] │
│  enforcedSkills: ["supabase"]                               │
│  roadmaps: [{ id: "schema", steps: [...] }]                │
│  providers: ["supabase"]                                    │
└─────────────────────────────────────────────────────────────┘
```

## Categories

Novahiz defines 17 categories, each with its own keywords, priority, and roadmap:

| Category | Priority | Keywords (examples) | Roadmap |
|----------|----------|---------------------|---------|
| `flutter` | 61 | flutter, dart, widget, pubspec, riverpod | `flutter-feature` (10 steps) |
| `expo` | 61 | expo, react native, expo router, eas build | `expo-feature` (11 steps) |
| `code` | 60 | code, function, class, typescript, react, api | `feature` (7 steps) |
| `debug` | 58 | bug, error, crash, fix, regression | `bugfix` (7 steps) |
| `database-supabase` | 57 | supabase, postgres, sql, rls, migration | `schema` (9 steps) |
| `review` | 55 | review, pull request, diff, feedback | `review` (4 steps) |
| `audit` | 54 | audit, security, owasp, vulnerability | `audit` (6 steps) |
| `test` | 53 | test, unit, integration, coverage, tdd | `testing` (6 steps) |
| `design-ui` | 52 | design, ui, css, tailwind, responsive | `design` (10 steps) |
| `research` | 50 | research, investigate, documentation | `research` (5 steps) |
| `docs-writing` | 49 | write, article, blog, copywriting | `writing` (6 steps) |
| `browser` | 48 | browser, playwright, screenshot, dom | `browse` (8 steps) |
| `planning` | 47 | plan, architecture, strategy, spec | `planning` (6 steps) |
| `devops` | 46 | docker, ci, cd, deploy, terraform | `devops` (7 steps) |
| `data` | 45 | csv, pandas, etl, analytics | `data` (7 steps) |
| `assessment` | 44 | idea, assess, evaluate, feasibility, market, go no-go | `assessment` (5 steps) |
| `general` | 0 | (fallback) | `general` (5 steps) |

## Negative keywords

Some categories define `negativeKeywords` that reduce the score. For example, `design-ui` has `["migration", "rls", "edge function"]` — if your prompt mentions "design" but also "migration", the Supabase category wins instead.

## Confidence and margin

- **Confidence** = `score / (score + 2)` — ranges from 0 to ~1. A score of 1 gives 0.33, a score of 3 gives 0.6.
- **Margin** = difference between a category's score and the next one. High margin = clear classification. Low margin = ambiguous prompt.

## Required vs enforced skills

- **Required skills** = all skills from all matched categories' roadmaps + default skills. These are *suggested* to the model.
- **Enforced skills** = only the non-optional `skill` steps from the *primary* category's roadmap. These are *required* by the gate — the edit is blocked if they are not loaded.

## Roadmaps

Each category has a roadmap — an ordered list of steps. Step kinds:

| Kind | Meaning | Gate behavior |
|------|---------|---------------|
| `skill` | Load a skill before proceeding | Blocks if skill not loaded |
| `edit` | Make code changes | Allowed after required skills loaded |
| `verify` | Check that the work is correct | Advisory |
| `advisory` | Informational step | Never blocks |

## Fallback

When no category scores above `minScore` (default: 1), the prompt is classified as `general`. The `general` category has a minimal roadmap with advisory steps.

## Determinism

The classifier is a pure function. Same prompt + same spec = same output. No randomness, no network calls, no model inference.
