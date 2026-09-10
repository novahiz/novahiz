# Architecture

Novahiz has one core and thin adapters. The core holds every decision. An adapter only translates between a harness and the core.

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

`src/cli.ts` exposes the core as commands that return JSON. This is the only integration surface an adapter needs.

### opencode adapter

`adapters/opencode/novahiz.ts` is a plugin. It runs the CLI for classification and gating, tracks loaded skills per session in memory, and injects enforcement text through `experimental.chat.system.transform`. The gate call runs in `tool.execute.before`, which can throw and cancel the tool call.

## Data flow

1. The user sends a message. `chat.message` classifies it and stores the categories and required skills for the session.
2. `experimental.chat.system.transform` adds a short enforcement block to the system prompt.
3. The model calls `skill` to load a skill. The adapter records it for the session.
4. The model calls `edit`, `write`, or `patch`. The adapter runs `novahiz gate` with the file path, the session categories, and the loaded skills.
5. If the gate blocks, the adapter throws and the model sees the list of missing skills.

## Determinism

The only inputs to a gate decision are the spec files, the file path, the prompt categories, and the loaded skills. The classifier reads the same spec. There is no network call and no model in the decision path. The adapter keeps state per session in memory.

## Portability

The core runs on Node with no dependencies. A new harness adapter needs two things: a way to run `novahiz classify` and `novahiz gate`, and a pre-tool hook that can abort a call. When the harness has no such hook, the classifier and the system-prompt injection still work, but the gate cannot block.

## Next

- MCP server exposing `classify`, `skills`, and `gate` as tools.
- Claude Code and Codex hook adapters.
- A curated scoring pass that fills `power` and `stars` beyond the defaults.
