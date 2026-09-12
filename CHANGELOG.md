# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Six-stage execution pipeline: `novahiz-plan`, `novahiz-clarify`, `novahiz-task`, `novahiz-analyse`, `novahiz-implement`, `novahiz-converge`, orchestrated by `novahiz-planner`.
- `novahiz clean` removes old enforcement logs, roadmap progress, sessions, and closed tasks, with `--days`, `--dry-run`, `--apply`, and `--vacuum`.
- `novahiz doctor` runs nine preflight checks and exits non-zero on a blocking finding.
- Terminal renderer (`src/render.ts`) with colour, tables, and byte formatting, plus `--pretty` and `--json` output modes.
- Slash commands `novahiz-plan`, `novahiz-clean`, `novahiz-doctor`, and `novahiz-status`, installed with the opencode command directory.
- `/novahiz-plan` produces the plan read-only: it classifies the request, asks its questions through the interface, traces the plan in the ledger, and writes nothing.
- `scripts/capture-cli.mjs` records the JSON output of every CLI invocation and diffs two runs, ignoring timestamp fields, so a refactor can be proven neutral.
- The gate reports required skills that are absent from the installed index, in `unmatchedRequired` and in a `warnings` array.
- `CHANGELOG.md` and a rewritten `NOTICE.md` that records the licence of every bundled third-party skill.
- `novahiz-uninstall --only <directory>` confines the removal to one directory and lists the entries it left in place.

### Changed

- `src/cli.ts` is now a thin entry point: 107 lines left from 1435. The commands moved to `src/commands/` and their shared primitives to `src/commands/context.ts`. The split is behaviour-neutral, checked against captured output of all 31 CLI invocations.
- The planning pipeline asks its questions through the harness question interface instead of writing them in the chat.
- The installer skips a skill that already exists in another scanned root (`~/.agents/skills`) and reports what it skipped. `--force-skills` overrides.
- The opencode adapter persists skill invocations, so `report` and `clean --logs` see them under that harness.
- The CLI validates its numeric flags (`--min-score`, `--max-categories`, `--limit`, `--days`, `--max-iterations`) and rejects a value out of range instead of falling back to the default in silence.
- `novahiz check` reports the stored `last_sync` timestamp, which nothing read before.
- `novahiz doctor` reports the schema version as a tenth check.
- `enforcement_log` gained indexes on `session_id` and `logged_at`, and `PRAGMA user_version` marks the schema generation.
- `commandTask` split into thirteen helpers; 59 exports with no reader outside their own file lost the keyword; the unused `bullet` and `emphasize` are gone.

### Fixed

- Test suites that opened the real ledger database now use a temporary one and clean up after themselves.
- `clean --dry-run` exits zero.
- A bundled skill whose frontmatter names an `allowed-tools` entry the harness does not recognize fails to launch at all. The eleven `novahiz-*` skills no longer declare `allowed-tools`.
- The `question` tool was missing under opencode. opencode denies it to every agent by default and only the built-in `build` and `plan` agents re-allow it, so the custom `novahiz-agent` inherited the denial and the pipeline could not ask a clarifying question. The agent now grants `question` and `plan_enter`, and the new `agent` doctor check fails when the installed copy loses the grant.
- `novahiz classify` scored zero on a refactor prompt: `decouper`, `decoupage`, `extraire`, `extraction`, `isoler`, `modules`, `split`, `cli`, and `refactorisation` are now keywords of the `code` category.
- Adding a todo to a completed ledger task left it marked `done`. The task is reopened as `active`.
- An error at the top of the CLI printed a Node stack trace of up to sixteen lines. It now prints one line, `novahiz: <message>`, on stderr. An unknown command likewise exits 1 with `unknown command <name>` instead of printing help and exiting 0.

### Removed

- Claude Code and Codex support: `install/hooks.mjs`, `src/hook.ts`, `src/commands/hook.ts`, `adapters/claude/`, and the `hook` CLI command. opencode is now the only harness Novahiz configures; other clients keep the MCP server and lose the gate.
- The vendored `impeccable` copy, which the provider installs.
- The `planner` stub, replaced by the `novahiz-plan` stage.

## [0.1.0] - 2026-09-11

Initial release.

### Added

- Category-aware catalog: 14 categories with roadmaps, 6 content rules, and per-skill overrides.
- Classifier that maps a prompt to categories, required skills, and the roadmap to follow.
- Enforcement gate for `edit`, `write`, `patch`, `apply_patch`, `bash`, and `shell`, driven by the rules and by the roadmap's skill steps.
- Durable execution ledger with a plan the gate keeps alive.
- MCP server exposing the catalog, the classifier, the roadmap, the gate, the providers, the dependency checks, and the task ledger.
- opencode adapter with plugin hooks, enforcement context, and token economy.
- Installer for the opencode harness, plus harness hooks for Claude Code and Codex.
- Token economy layer: output trimming for read and shell tools, stale-read deduplication, and a savings report.
- Provider registry where providers are referenced by an install command and never vendored.
