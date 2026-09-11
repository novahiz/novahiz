# Novahiz

[![ci](https://github.com/novahiz/novahiz/actions/workflows/ci.yml/badge.svg)](https://github.com/novahiz/novahiz/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](https://nodejs.org)

A deterministic layer for AI coding harnesses. It catalogs your skills, classifies a prompt into categories, attaches an execution roadmap, and blocks file edits until the required skills are loaded.

The decisions run in code. The same prompt and the same rule set always produce the same result. No model vote, no random sampling, no hidden state.

## What it does

- **Catalog** scans `SKILL.md` files, reads their frontmatter, stores them in SQLite with a curated score, and ranks them by deterministic lexical relevance.
- **Classifier** maps a prompt to categories (code, debug, review, audit, research, browser, design, Supabase, and more) with weighted keyword rules. It returns the primary category, the required skills, and the execution roadmaps.
- **Gate** inspects `edit`, `write`, `patch`, `apply_patch`, and shell writes. It is content-aware, so `humanizer` is required only for prose changes and `impeccable` only for style changes. The primary roadmap `skill` steps are enforced. When a required skill is not loaded, the call is blocked with an explanation.
- **Roadmaps** attach an ordered task list to each category. The primary category drives the roadmap the agent follows.
- **Enforcer** injects the detected categories, the roadmap checklist, and the expected skills into the system prompt.

## Status

Phase 1. The core (catalog, classifier, gate, CLI), the bundled skills, the installer, the MCP server, and the opencode adapter work and are covered by tests. Other harness adapters are next. The public interface may change before 1.0.

## Requirements

- Node.js 22.18 or later. Node runs the TypeScript sources directly through type stripping.
- No runtime dependencies. SQLite comes from `node:sqlite`.

## Install

Clone into the Novahiz home and run the installer:

```
git clone https://github.com/novahiz/novahiz ~/.config/novahiz
node ~/.config/novahiz/install/install.mjs
```

The installer copies the bundled skills, drops the opencode plugin, writes `novahiz.config.json` if missing, and builds the catalog. It never deletes your files. Restart opencode afterward. The plugin registers the MCP server on its own.

Full options and the uninstall steps are in [docs/INSTALL.md](docs/INSTALL.md).

## Configuration

Generic behavior lives in `catalog/` and is versioned:

- `catalog/categories.json` defines each category, its keywords, the skills it requires, and its execution roadmap.
- `catalog/rules.json` defines the pre-edit rules (file classes, path globs, prompt categories, content matches, required skills).
- `catalog/overrides.json` holds manual curation for skills (power, stars, tags, categories).

Machine-specific settings live in `novahiz.config.json`, which is gitignored: the database path, the skill roots, and gate behavior. Copy the example file to create it.

## CLI

```
node src/cli.ts sync
node src/cli.ts check
node src/cli.ts classify "ajoute une migration supabase avec une policy rls"
node src/cli.ts gate --file src/hero.css --tool edit
node src/cli.ts gate --file src/hero.css --tool edit --loaded humanizer,impeccable
node src/cli.ts skills --category design-ui
node src/cli.ts catalog "design frontend landing" --limit 5
node src/cli.ts roadmap --category code
node src/cli.ts step --session my-session --done plan
node src/cli.ts report --format markdown
```

`gate` prints a JSON verdict and exits `0` when the edit is allowed, `2` when it is blocked. Adapters rely on that exit code.

## opencode adapter

Copy `adapters/opencode/novahiz.ts` into `~/.config/opencode/plugins/`. It loads automatically at startup. The adapter classifies each user message, injects the roadmap checklist and expected skills, tracks loaded skills, and calls the CLI gate on `edit`, `write`, `patch`, `apply_patch`, and `bash`.

Set `NOVAHIZ_GATE=off` to disable gating for a session. Set `NOVAHIZ_HOME` when the repo is not at `~/.config/novahiz`.

## Multi-harness

The adapter is thin on purpose. The gate logic lives in the CLI, so a harness that can run a command before a tool call can reuse it. Claude Code gets a blocking `PreToolUse` hook, Codex gets advisory `PostToolUse` and `Stop` hooks, both through `novahiz hook`. Any harness with a stdio MCP client can use `novahiz_classify`, `novahiz_catalog`, `novahiz_roadmap`, `novahiz_providers`, `novahiz_step`, `novahiz_list_skills`, and `novahiz_gate`. Novahiz also catalogues external components as providers: MCP servers (playwright, security, narsil, context7, sequential-thinking, cron), skill packs (impeccable), and command packs (speckit), and can run their official install commands. See [docs/HARNESSES.md](docs/HARNESSES.md), [adapters/README.md](adapters/README.md), and [docs/PROVIDERS.md](docs/PROVIDERS.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
