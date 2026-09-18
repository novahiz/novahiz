# Skillenforce

[![ci](https://github.com/skillenforce/skillenforce/actions/workflows/ci.yml/badge.svg)](https://github.com/skillenforce/skillenforce/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](https://nodejs.org)

Enforce AI agent skills before every file edit. Skillenforce catalogs your skills, classifies prompts, attaches execution roadmaps, and blocks edits until required skills are loaded.

The decisions run in code. The same prompt and the same rule set always produce the same result. No model vote, no random sampling, no hidden state.

## What it does

- **Catalog** scans `SKILL.md` files, reads their frontmatter, stores them in SQLite with a curated score, and ranks them by deterministic lexical relevance.
- **Classifier** maps a prompt to categories (code, debug, review, audit, research, browser, design, Supabase, and more) with weighted keyword rules. It returns the primary category, the required skills, and the execution roadmaps.
- **Gate** inspects `edit`, `write`, `patch`, `apply_patch`, and shell writes. It is content-aware, so `humanizer` is required only for prose changes and `impeccable` only for style changes. The primary roadmap `skill` steps are enforced. When a required skill is not loaded, the call is blocked with an explanation.
- **Roadmaps** attach an ordered task list to each category. The primary category drives the roadmap the agent follows.
- **Enforcer** injects the detected categories, the roadmap checklist, and the expected skills into the system prompt.
- **Ledger** keeps a long task in SQLite: atomic todos with an acceptance criterion and a proof, a per-todo iteration budget, work packets with exclusive file ownership, and a living plan the gate forces you to revise every few edits. The current plan is injected into the system prompt each turn, so it survives context compaction.

## Pipeline

Non-trivial work follows six stages, in order, each with its own skill:

| # | Stage | Skill | Produces |
|---|-------|-------|----------|
| 1 | Plan | `skillenforce-plan` | direction, boundaries, dependency order, slicing strategy, risks |
| 2 | Clarify | `skillenforce-clarify` | ambiguity families, question rounds, settled decisions |
| 3 | Tasks | `skillenforce-task` | atomic tasks with acceptance criteria and a proof |
| 4 | Analyse | `skillenforce-analyse` | the files, symbols, and unknowns that matter for the task |
| 5 | Implement | `skillenforce-implement` | increments that keep the system working |
| 6 | Converge | `skillenforce-converge` | the gap between intent and code, closed or left explicit |

`skillenforce-planner` orchestrates them and carries the entry rule: no non-trivial edit before a written plan. Stages 1 to 4 write nothing to the application.

The clarification and planning stages ask their questions through the harness question interface, so the agent presents choices and waits for an answer instead of listing questions in prose.

## Status

Phase 1. The core (catalog, classifier, gate, CLI), the bundled skills, the installer, the MCP server, and the opencode adapter work and are covered by tests. Other harness adapters are next. The public interface may change before 1.0.

The package exposes no programmatic import surface. It ships a CLI and an MCP server, so `package.json` declares no `main` and no `exports`.

## Requirements

- Node.js 22.18 or later. Node runs the TypeScript sources directly through type stripping.
- No runtime dependencies. SQLite comes from `node:sqlite`.
- `defuddle`, for the web extraction in the `research` roadmap step. `skillenforce doctor` reports whether it is present.

## Install

```
npm install -g skillenforce
skillenforce init
```

Or from source:

```
git clone https://github.com/skillenforce/skillenforce ~/.config/skillenforce
node ~/.config/skillenforce/install/install.mjs
```

Restart opencode afterward. The plugin registers the MCP server on its own.

Full options and the uninstall steps are in [docs/INSTALL.md](docs/INSTALL.md).

## Configuration

Generic behavior lives in `catalog/` and is versioned:

- `catalog/categories.json` defines each category, its keywords, the skills it requires, and its execution roadmap.
- `catalog/rules.json` defines the pre-edit rules (file classes, path globs, prompt categories, content matches, required skills).
- `catalog/overrides.json` holds manual curation for skills (power, stars, tags, categories).

Machine-specific settings live in `skillenforce.config.json`, which is gitignored: the database path, the skill roots, and gate behavior. Copy the example file to create it.

## CLI

```
skillenforce init                    # one-shot setup (config, skills, catalog)
skillenforce doctor                  # health check
skillenforce status                  # classification and gate state
skillenforce task new "Add CSV"      # start a tracked task
skillenforce task status             # show task progress
skillenforce task done <id>          # mark a todo complete
skillenforce report                  # session report
skillenforce clean                   # remove old logs and sessions
skillenforce upgrade                 # pull latest and rebuild catalog
skillenforce version                 # show version
```

Advanced (for power users and adapters):

```
skillenforce classify "ajoute une migration supabase"
skillenforce gate --file src/hero.css --tool edit
skillenforce skills --category design-ui
skillenforce catalog "design frontend landing" --limit 5
skillenforce roadmap --category code
skillenforce dispatch --task <id>
skillenforce tokens --calibrate
skillenforce clean --days 30 --apply --vacuum
```

`gate` prints a JSON verdict and exits `0` when the edit is allowed, `2` when it is blocked. Adapters rely on that exit code.

Run `skillenforce` with no arguments for the full command list.

## opencode adapter

Copy `adapters/opencode/skillenforce.ts` into `~/.config/opencode/plugins/`, or run the installer, which copies it. It loads automatically at startup. The adapter classifies each user message, injects the roadmap checklist and expected skills, tracks loaded skills, and calls the CLI gate on `edit`, `write`, `patch`, `apply_patch`, `bash`, and `shell`.

The installer also drops four slash commands into the opencode command directory: `/skillenforce-plan`, `/skillenforce-clean`, `/skillenforce-doctor`, and `/skillenforce-status`. `/skillenforce-plan` runs the pipeline read-only and produces the plan without writing a file.

Set `NOVAHIZ_GATE=off` to disable gating for a session. Set `NOVAHIZ_HOME` when the repo is not at `~/.config/skillenforce`. Set `NOVAHIZ_DB` to override the database path, which keeps tests and scratch runs off your real ledger.

## Execution ledger

For work that spans more than a few steps, `skillenforce task` keeps the plan in SQLite instead of in the conversation. A todo carries its own acceptance criterion, an iteration budget, and, for a `verify` step, a proof that must be present before it can close. `skillenforce dispatch` turns the open todos into work packets with exclusive file ownership, so parallel sub-agents do not edit the same file. The gate forces a review every three edits or two finished todos, and the enriched summary is injected on every turn. See [docs/EXECUTION.md](docs/EXECUTION.md).

## Harnesses

The adapter is thin on purpose: the gate logic lives in the CLI. opencode is the supported harness, through the plugin in `adapters/opencode/`. Any harness with a stdio MCP client can use `skillenforce_classify`, `skillenforce_catalog`, `skillenforce_roadmap`, `skillenforce_providers`, `skillenforce_deps`, `skillenforce_step`, `skillenforce_list_skills`, `skillenforce_gate`, `skillenforce_task`, and `skillenforce_dispatch`, but the gate only blocks inside opencode. Novahiz also catalogues external components as providers: MCP servers (playwright, security, narsil, context7, sequential-thinking, cron), and skill packs (impeccable), and can run their official install commands. See [docs/HARNESSES.md](docs/HARNESSES.md), [adapters/README.md](adapters/README.md), and [docs/PROVIDERS.md](docs/PROVIDERS.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
