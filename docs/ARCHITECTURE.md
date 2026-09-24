# Architecture

Novahiz has one core and thin adapters. The core holds every decision. An adapter only translates between a harness and the core.

```
┌─────────────────────────────────────────────────────────┐
│                    USER PROMPT                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              OPENCODE PLUGIN ADAPTER                    │
│  chat.message hook → classify → inject enforcement      │
│  tool.execute.before hook → gate → block/allow          │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│                   Novahiz CORE                     │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  CLASSIFIER  │  │     GATE     │  │    LEDGER     │  │
│  │              │  │              │  │               │  │
│  │ prompt →     │  │ file path +  │  │ tasks, todos  │  │
│  │ categories + │  │ categories + │  │ work packets  │  │
│  │ skills +     │  │ loaded skills│  │ review cadence│  │
│  │ roadmaps     │  │ → allow/deny │  │               │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│         ▼                 ▼                   ▼          │
│  ┌─────────────────────────────────────────────────────┐│
│  │                    SPEC (catalog/)                   ││
│  │  categories.json  rules.json  providers.json        ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## Components

### Spec (source of truth)

Three versioned JSON files under `catalog/`:

- `categories.json` — lists 15 categories with keywords, required skills, and execution roadmaps.
- `rules.json` — lists 6 pre-edit rules with conditions (file class, path glob, prompt category, content match) and required skills.
- `providers.json` — lists external MCP servers with their purpose and the categories they serve.
- `overrides.json` — carries manual skill curation (power, stars, tags, categories).

`src/spec.ts` loads them. Nothing secret or machine-specific lives here.

### Catalog

`src/catalog.ts` walks the skill roots, parses each `SKILL.md` frontmatter, merges the overrides, and writes:

- `build/installed-skills.json` — a flat list of installed skill IDs. The adapter reads this to avoid requiring a skill that is not present.
- Rows in SQLite for querying and reporting.

### Classifier

`src/classify.ts` folds the prompt (lowercase, accents removed), counts keyword matches per category, sorts by score and priority, keeps the top categories, and returns their required skills. The function is pure. Same input, same output.

### Gate

`src/gate.ts` maps a file path to a class (code, text, design, data, config). It applies each rule whose conditions match the file class, a path glob, or a detected prompt category. Required skills that are not installed are reported separately and do not block. Required skills that are installed but not loaded in the session block the call.

### CLI

`src/cli.ts` is the entry point: it parses `argv`, resolves the `--home` override, and dispatches. The commands themselves live in `src/commands/`, one module for the large ones (`clean`, `doctor`, `gate`, `hook`, `report`, `task`, `tokens`) and `inspect.ts` for the read-only ones.

### opencode adapter

`adapters/opencode/novahiz.ts` is a plugin. It runs the CLI for classification and gating, tracks loaded skills per session in memory, and injects enforcement text through `experimental.chat.system.transform`. The gate call runs in `tool.execute.before`, which can throw and cancel the tool call.

### Content rules and roadmaps

`src/content.ts` provides `changeText`, `hasProse`, and `hasStyle`. Rules in `catalog/rules.json` use them through `when.contentMatches` and `when.contentExcludes`. `novahiz-humanizer` and `ui-slop-remover` are required only by R13 on frontend design tasks. `when.match` combines class, path, and category selectors.

Each category carries a `roadmap`. The classifier returns the category order, the primary category, the union of required skills, and the roadmaps. The gate adds the primary roadmap `skill` steps to its requirements.

### Execution ledger

`src/ledger.ts` stores a task and its todos in SQLite (`tasks`, `todos`). Each todo has a kind, a status, an acceptance criterion, an iteration budget, an owner glob, and a proof. `startTodo` enforces dependencies and the budget; `completeTodo` requires a proof on a `verify` step.

## Data flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  USER    │────▶│ CLASSIFY │────▶│  INJECT  │────▶│  MODEL   │
│  PROMPT  │     │          │     │ ENFORCE  │     │ RESPONSE │
└──────────┘     └────┬─────┘     └──────────┘     └────┬─────┘
                      │                                  │
                      ▼                                  ▼
               ┌──────────┐                      ┌──────────┐
               │ CATEGORIES│                      │  TOOL    │
               │ + SKILLS  │                      │  CALL    │
               │ + ROADMAP │                      │(edit/write)│
               └──────────┘                      └────┬─────┘
                                                      │
                                                      ▼
                                               ┌──────────┐
                                               │   GATE   │
                                               │          │
                                               │ allow /  │
                                               │ block    │
                                               └──────────┘
```

1. The user sends a message. `chat.message` classifies it, stores the categories and required skills for the session, and reads the active ledger task.
2. `experimental.chat.system.transform` adds a short enforcement block to the system prompt, including the ledger summary and any review signal.
3. The model calls `skill` to load a skill. The adapter records it for the session.
4. The model calls `edit`, `write`, or `patch`. The adapter runs `Novahiz gate` with the file path, the session categories, and the loaded skills.
5. If the gate blocks, the adapter throws and the model sees the list of missing skills or the review reason.

## Determinism

The only inputs to a gate decision are the spec files, the file path, the prompt categories, and the loaded skills. The classifier reads the same spec. There is no network call and no model in the decision path. The adapter keeps state per session in memory.

## Portability

The core runs on Node with no dependencies. A new harness adapter needs two things: a way to run `Novahiz classify` and `Novahiz gate`, and a pre-tool hook that can abort a call. When the harness has no such hook, the classifier and the system-prompt injection still work, but the gate cannot block.

## Installer

`install/install.mjs` detects whether opencode is installed (auto-installs it if missing), copies the core, the skills, and the plugin into place. It backs up any user file it overwrites (`*.novahiz-bak`) and records what it created in `.novahiz-install.json`, so `install/uninstall.mjs` can restore and reverse.

## MCP server

`mcp/novahiz-tools/index.mjs` exposes `novahiz_classify`, `novahiz_catalog`, `novahiz_roadmap`, `novahiz_providers`, `novahiz_deps`, `novahiz_step`, `novahiz_list_skills`, `novahiz_gate`, `novahiz_task`, and `novahiz_dispatch` over stdio using newline-delimited JSON-RPC. It has no dependencies and reuses the core modules directly. The opencode plugin registers it through the plugin `config` hook.

## Providers

`catalog/providers.json` lists external MCP servers with their purpose and the categories they serve. `src/providers.ts` maps categories to providers and builds MCP entries. The classifier returns the relevant providers, the enforcer injects them, and the plugin registers the missing ones on startup. See [PROVIDERS.md](PROVIDERS.md).
