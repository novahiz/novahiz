# Architecture

skillenforce has one core and thin adapters. The core holds every decision. An adapter only translates between a harness and the core.

## Components

### Spec (source of truth)

Three versioned JSON files under `catalog/`:

- `categories.json` lists categories with keywords and required skills.
- `rules.json` lists pre-edit rules with conditions and required skills.
- `overrides.json` carries manual skill curation.

`src/spec.ts` loads them. Nothing secret or machine-specific lives here.

### Catalog

`src/catalog.ts` walks the skill roots, parses each `SKILL.md` frontmatter, merges the overrides, and writes:

- `build/installed-skills.json`, a flat list of installed skill ids. The adapter reads this to avoid requiring a skill that is not present.
- rows in SQLite for querying and reporting.

### Classifier

`src/classify.ts` folds the prompt (lowercase, accents removed), counts keyword matches per category, sorts by score and priority, keeps the top categories, and returns their required skills. The function is pure. Same input, same output.

### Gate

`src/gate.ts` maps a file path to a class (code, text, design, data, config). It applies each rule whose conditions match the file class, a path glob, or a detected prompt category. Required skills that are not installed are reported separately and do not block. Required skills that are installed but not loaded in the session block the call.

### CLI

`src/cli.ts` is the entry point: it parses `argv`, resolves the `--home` override, and dispatches. The commands themselves live in `src/commands/`, one module for the large ones (`clean`, `doctor`, `gate`, `hook`, `report`, `task`, `tokens`) and `inspect.ts` for the read-only ones. The primitives they all share (`Parsed`, `parse`, `print`, `emit`, `flagOn`, `humanMode`, `confirm`, `dbPathFor`) live in `src/commands/context.ts`, a leaf module that imports nothing from the command modules. Commands return JSON, which is the only integration surface an adapter needs.

### opencode adapter

`adapters/opencode/skillenforce.ts` is a plugin. It runs the CLI for classification and gating, tracks loaded skills per session in memory, and injects enforcement text through `experimental.chat.system.transform`. The gate call runs in `tool.execute.before`, which can throw and cancel the tool call.

### content rules and roadmaps

`src/content.ts` provides `changeText`, `hasProse`, and `hasStyle`. Rules in `catalog/rules.json` use them through `when.contentMatches` and `when.contentExcludes`, so `humanizer` and `impeccable` are required only for prose and style changes. `when.match` combines class, path, and category selectors.

Each category carries a `roadmap`. The classifier returns the category order, the primary category, the union of required skills, and the roadmaps. The gate adds the primary roadmap `skill` steps to its requirements. `src/db.ts` stores step progress in `roadmap_progress`.

### Execution ledger

`src/ledger.ts` stores a task and its todos in SQLite (`tasks`, `todos`). Each todo has a kind, a status, an acceptance criterion, an iteration budget, an owner glob, and a proof. `startTodo` enforces dependencies and the budget; `completeTodo` requires a proof on a `verify` step. The plan is mutable: `amendTodo`, `insertTodo`, `dropTodo`, and `reorderTodos` adjust it, and `reviewTask` applies a whole diff in one transaction and bumps `revision`. `reviewDue` reports when the cadence (`edits` or `todos`) is reached, and `revisionSignals` derives concrete reasons to revise from the ledger. `buildWorkPackets` turns the open todos into sub-agent work packets with file ownership, and `traceCheck` verifies that an edit targets an in-progress todo that owns the file. `commandGate` records each edit and blocks edits while a review is due, so the plan is reconciled before work continues.

## Data flow

1. The user sends a message. `chat.message` classifies it, stores the categories and required skills for the session, and reads the active ledger task.
2. `experimental.chat.system.transform` adds a short enforcement block to the system prompt, including the ledger summary and any review signal.
3. The model calls `skill` to load a skill. The adapter records it for the session.
4. The model calls `edit`, `write`, or `patch`. The adapter runs `skillenforce gate` with the file path, the session categories, and the loaded skills.
5. If the gate blocks, the adapter throws and the model sees the list of missing skills or the review reason.

## Determinism

The only inputs to a gate decision are the spec files, the file path, the prompt categories, and the loaded skills. The classifier reads the same spec. There is no network call and no model in the decision path. The adapter keeps state per session in memory.

## Portability

The core runs on Node with no dependencies. A new harness adapter needs two things: a way to run `skillenforce classify` and `skillenforce gate`, and a pre-tool hook that can abort a call. When the harness has no such hook, the classifier and the system-prompt injection still work, but the gate cannot block.

## Installer

`install/install.mjs` copies the core, the bundled skills, and the plugin into place. It backs up any user file it overwrites (`*.skillenforce-bak`) and records what it created in `.skillenforce-install.json`, so `install/uninstall.mjs` can restore and reverse.

## MCP server

`mcp/skillenforce-tools/index.mjs` exposes `skillenforce_classify`, `skillenforce_catalog`, `skillenforce_roadmap`, `skillenforce_providers`, `skillenforce_deps`, `skillenforce_step`, `skillenforce_list_skills`, `skillenforce_gate`, `skillenforce_task`, and `skillenforce_dispatch` over stdio using newline-delimited JSON-RPC. It has no dependencies and reuses the core modules directly. The opencode plugin registers it through the plugin `config` hook.

## Providers

`catalog/providers.json` lists external MCP servers with their purpose and the categories they serve. `src/providers.ts` maps categories to providers and builds MCP entries. The classifier returns the relevant providers, the enforcer injects them, and the plugin registers the missing ones on startup. See [PROVIDERS.md](PROVIDERS.md).

## Next

- Optional embedding tie-break for the classifier.
- A catalog enrichment pass that fills `stars` from a source.
- More content matchers beyond prose and style.
