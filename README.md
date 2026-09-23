# Novahiz: Agent Governance Toolkit

> **Zero-dependency enforcement layer for AI coding agents** — classifies prompts, assigns execution roadmaps, blocks unsafe edits, and injects session-level skills, all deterministically without model calls.

15 categories, 185 skills, 11 gate rules, 12 MCP providers — all deterministic, all local, all JSON.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│    USER PROMPT  ──▶  CLASSIFIER  ──▶  GATE  ──▶  SAFE OUTPUT      │
│                                                                     │
│    "Fix the      3 categories    2 missing     Edit blocked        │
│     auth bug"    detected         skills        until skills       │
│                                   required      loaded             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What it does

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        HOW Novahiz WORKS                            │
│                                                                          │
│  ┌──────────┐    ┌────────────┐    ┌──────────┐    ┌──────────────┐     │
│  │  USER    │───▶│  CLASSIFY  │───▶│  INJECT  │───▶│    MODEL     │     │
│  │  PROMPT  │    │            │    │ ENFORCE  │    │   RESPONSE   │     │
│  └──────────┘    │ keywords   │    │ block +  │    └──────┬───────┘     │
│                  │ priority   │    │ roadmap  │           │             │
│                  │ roadmap    │    │ ledger   │           ▼             │
│                  └────────────┘    └──────────┘    ┌──────────────┐     │
│                       │                            │  TOOL CALL   │     │
│                       │                            │ (edit/write) │     │
│                       │                            └──────┬───────┘     │
│                       │                                   │             │
│                       │         ┌────────────┐            │             │
│                       └────────▶│    GATE    │◀───────────┘             │
│                                 │            │                          │
│                                 │  file path │                          │
│                                 │  skills    │                          │
│                                 │  content   │                          │
│                                 └─────┬──────┘                          │
│                                       │                                 │
│                                       ▼                                 │
│                                 ┌──────────┐                           │
│                                 │ allow /  │                           │
│                                 │ BLOCK    │                           │
│                                 └──────────┘                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**15 categories**, **185 skills**, **11 gate rules**, **12 MCP providers** — all deterministic, all local, all JSON.

---

## Quick start

### Option 1 — One-liner (recommended)

```bash
npm install -g Novahiz
```

This installs Novahiz globally and auto-configures opencode (skills, plugin, MCP servers, config). Then verify:

```bash
npx Novahiz doctor   # 10 health checks
npx Novahiz classify "fix the auth bug"
```

### Option 2 — From source

```bash
git clone https://github.com/novahiz/novahiz.git
cd novahiz
npm install && npm run build
node ./install/install.mjs

# Verify
npx Novahiz doctor
```

> Requires **Node.js >= 22.18**. The installer auto-installs opencode if it's missing.

---

## The Classifier

Every user prompt passes through the classifier. It scores keywords against 15 categories and picks the top matches.

```mermaid
flowchart LR
    A[User Prompt] --> B[Text Folding<br/>lowercase + strip accents]
    B --> C{Keyword Scoring<br/>+1.0 per hit<br/>+1.5 multi-word bonus}
    C --> D[Rank by Score + Priority]
    D --> E[Top 3 Categories]
    E --> F[Primary Category<br/>determines roadmap]
    F --> G[Required Skills<br/>union of all categories]
    F --> H[Enforced Skills<br/>primary only — gate blocks if missing]
```

**Example:**

| Prompt | Top Category | Confidence | Skills Required |
|--------|-------------|------------|-----------------|
| "fix the auth bug" | `debug` | 0.60 | novahiz-plan, novahiz-analyse, novahiz-implement, novahiz-converge |
| "add a landing page" | `design-ui` | 0.50 | novahiz-humanizer, anti-AI-design |
| "create supabase migration" | `database-supabase` | 0.60 | novahiz-supabase, novahiz-postgres, novahiz-plan, novahiz-implement |

---

## The Gate

The gate is the enforcement mechanism. It inspects every file edit and decides: **allow** or **block**.

```mermaid
flowchart TD
    A[Tool Call: edit / write / patch] --> B[File Class Detection]
    B --> C{Rule Matching}
    
    C --> D[R1: Content contains prose?<br/>require novahiz-humanizer]
    C --> F[R3: Prompt was Supabase?<br/>require novahiz-supabase + postgres]
    C --> G[R4: Prompt was browser?<br/>require novahiz-browser]
    C --> H[R6: Workflow prompt?<br/>require plan/clarify/analyse/implement/converge]
    
    D --> I{Roadmap Enforcement}
    F --> I
    G --> I
    H --> I
    
    I --> J{Placeholder Detection<br/>TODO / FIXME / placeholder tokens}
    
    J --> K["Check installed skills<br/>(missing → reported, not blocked)"]
    J --> L["Check loaded skills<br/>(missing → BLOCKED)"]
    
    K --> M{All loaded?}
    L --> M
    
    M -->|Yes| N[✅ Allow edit]
    M -->|No| O[❌ Block edit<br/>list missing skills]
```

### File classes

| Class | Extensions |
|-------|-----------|
| `code` | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.php`, `.dart`, `.rb` |
| `design` | `.css`, `.scss`, `.html`, `.vue`, `.svelte`, `.astro` |
| `text` | `.md`, `.txt`, `.rst` |
| `config` | `.json`, `.yaml`, `.yml`, `.toml` |
| `data` | `.csv`, `.sql`, `.db` |

### Gate rules

| Rule | Triggers on | Requires |
|------|-------------|----------|
| R1-code-prose | Code or design file whose change contains prose | novahiz-humanizer |
| R1-docs | Text, data or config file, or a docs-writing prompt | novahiz-humanizer |
| R3-supabase | A Supabase path or a Supabase prompt | novahiz-supabase, novahiz-postgres |
| R4-playwright | A browser prompt category | novahiz-browser |
| R6-Novahiz | A prompt in a workflow category | novahiz-plan, -clarify, -analyse, -implement, -converge |
| R7-assessment | An assessment prompt | novahiz-assess-intake, -research, -define, -shape, -decide |
| R8-docs | Edits under `novahiz-docs/**/*.md` | novahiz-docs |
| R9-code-review | A review prompt or a code file under review | novahiz-code-review |
| R10-security | An audit or security prompt | novahiz-security |
| R11-accessibility | A design-ui or audit prompt | novahiz-wcag-audit |
| R12-web-extract | A research prompt | novahiz-web-extract |

---

## Roadmaps

Each category has an ordered execution roadmap. The gate enforces non-optional `skill` steps.

```mermaid
flowchart LR
    subgraph "Feature (code)"
        A1[advisory: Understand] --> A2[skill: Plan]
        A2 --> A3[skill: Analyse]
        A3 --> A4[skill: Implement]
        A4 --> A5[skill: Converge]
        A5 --> A6[verify: Verify]
    end
    
    subgraph "Bugfix (debug)"
        B1[advisory: Reproduce] --> B2[advisory: Isolate]
        B2 --> B3[skill: Plan]
        B3 --> B4[skill: Analyse]
        B4 --> B5[skill: Implement]
        B5 --> B6[skill: Converge]
        B6 --> B7[advisory: Prevent]
    end
    
    subgraph "Schema (database-supabase)"
        C1[skill: Plan] --> C2[skill: Clarify]
        C2 --> C3[skill: Inspect]
        C3 --> C4[skill: Load supabase]
        C4 --> C5[skill: Implement]
        C5 --> C6[skill: Security]
        C6 --> C7[skill: Converge]
    end
```

| Step Kind | What it means | Gate behavior |
|-----------|---------------|---------------|
| `skill` | Load a skill before proceeding | **Blocks** if skill not loaded |
| `edit` | Make code changes | Allowed |
| `verify` | Check the work is correct | Advisory |
| `advisory` | Informational | Never blocks |

---

## Task Ledger

For work that spans more than a few steps, the ledger keeps the plan in SQLite instead of in the conversation.

```mermaid
flowchart TD
    A["task new 'Add CSV export'"] --> B[Create task + todos from roadmap]
    B --> C[Dispatch work packets]
    C --> D[Each packet = one todo<br/>exclusive file ownership]
    D --> E[Agent works on todos]
    E --> F{Review cadence<br/>every N edits}
    F -->|N reached| G[Force review step<br/>reconcile plan]
    F -->|N not reached| E
    G --> E
    E --> H[All todos done]
    H --> I[Task complete]
```

- **Exclusive file ownership** — no two work packets can edit the same file
- **Iteration budget** — each todo has a max (default: 12) before escalation
- **Review cadence** — forced review every 3 edits or 2 completed todos
- **Proof required** — verify steps require evidence before completion

---

## Installed skills

Novahiz ships with 172 skills across all categories:

| Category | Skills | Purpose |
|----------|--------|---------|
| `code` | novahiz-code-review, engineering-code-standards, mcp-server-builder, ... | Code quality, patterns, architecture |
| `debug` | debug-issue, novahiz-analyse, ... | Root cause analysis, code navigation |
| `review` | novahiz-code-review, review-pr, ... | Structured review, blast radius |
| `database-supabase` | supabase, supabase-postgres-best-practices, novahiz-postgres, ... | Schema, RLS, migrations, optimization |
| `design-ui` | anti-AI-design, frontend-design-taste, apple-hig-audit, ... | UI/UX, visual hierarchy, native feel |
| `docs-writing` | novahiz-humanizer, copywriting, copy-editing, humanizer, ... | Prose, marketing copy, AI de-tell |
| `browser` | novahiz-browser, playwright-agent, novahiz-web-extract, computer-use, ... | Web automation, screenshots, extraction |
| `audit` | novahiz-security, narsil-*, dependency-auditor, ai-security, ... | Security, compliance, vulnerability |

Run `npx Novahiz skills --all` to see the full list.

---

## Providers

Novahiz auto-registers external MCP servers based on the prompt category:

| Provider | Purpose | Categories |
|----------|---------|------------|
| context7 | Library documentation | all |
| narsil | Code intelligence, security scan | code, debug, review, audit |
| novahiz-web-extract | Clean markdown from URLs | research, docs-writing |
| playwright | Browser automation | browser, design |
| supabase | Database operations | database-supabase |
| supabase-postgres-best-practices | Postgres optimization | database-supabase |
| security | Security orchestration | audit |
| cron | Scheduled tasks | devops |
| dart | Dart/Flutter tools | code |

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for full details.

---

## Configuration

```bash
# Disable the gate (escape hatch)
NOVAHIZ_GATE=off npx opencode

# Override home directory
NOVAHIZ_HOME=/path/to/Novahiz npx Novahiz doctor

# Force node version
NOVAHIZ_NODE=/usr/local/bin/node npx Novahiz doctor
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options.

---

## Commands

| Command | Purpose |
|---------|---------|
| `Novahiz init` | One-shot setup |
| `Novahiz doctor` | 10-check health diagnostic |
| `Novahiz status` | Current classification + gate state |
| `Novahiz classify <text>` | Classify a prompt |
| `Novahiz gate` | Check if an edit is allowed |
| `Novahiz task new <title>` | Start a tracked task |
| `Novahiz task status` | Task progress |
| `Novahiz task done <id>` | Mark a todo complete |
| `Novahiz report` | Session report |
| `Novahiz skills` | List loaded or available skills |
| `Novahiz catalog <query>` | Search the skill catalog |
| `Novahiz roadmap` | Show execution roadmap |
| `Novahiz dispatch` | Generate work packets |
| `Novahiz sync` | Rebuild installed-skills index |
| `Novahiz clean` | Remove old logs |
| `Novahiz upgrade` | Pull latest + rebuild |
| `Novahiz version` | Print version |

See [docs/CLI.md](docs/CLI.md) for full reference.

---

## Documentation

| File | Topic |
|------|-------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, components, data flow |
| [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md) | How the classifier works |
| [docs/GATE.md](docs/GATE.md) | Gate rules, file classes, enforcement |
| [docs/CATALOG.md](docs/CATALOG.md) | Categories, rules, providers, overrides |
| [docs/PLUGIN.md](docs/PLUGIN.md) | opencode plugin lifecycle |
| [docs/CLI.md](docs/CLI.md) | CLI command reference |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Config files and env vars |
| [docs/EXECUTION.md](docs/EXECUTION.md) | Task ledger, todos, dispatch |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | MCP servers and skill packs |
| [docs/INSTALL.md](docs/INSTALL.md) | Installation and setup |
| [docs/ROADMAPS.md](docs/ROADMAPS.md) | Execution roadmaps |
| [docs/RULES.md](docs/RULES.md) | Gate rules reference |
| [docs/CONSTITUTION.md](docs/CONSTITUTION.md) | Project principles |
| [docs/HARNESSES.md](docs/HARNESSES.md) | Harness adapter guide |
| [docs/TOKENS.md](docs/TOKENS.md) | Token diagnostics |

---

## Philosophy

Novahiz treats skills like **locks** and the prompt like a **key**. The classifier determines which locks exist. The gate checks whether you have the right keys loaded. No key, no edit.

Everything is local, deterministic, and JSON. No cloud calls. No model inference in the decision path. Same prompt + same config = same result, every time.

---

## License

Apache-2.0
