# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Six-stage execution pipeline: `novahiz-plan`, `novahiz-clarify`, `novahiz-task`, `novahiz-analyse`, `novahiz-implement`, `novahiz-converge`, orchestrated by `novahiz-planner`.
- `novahiz clean` removes old enforcement logs, roadmap progress, sessions, and closed tasks, with `--days`, `--dry-run`, `--apply`, and `--vacuum`.
- `novahiz doctor` runs seven preflight checks and exits non-zero on a blocking finding.
- Terminal renderer (`src/render.ts`) with colour, tables, and byte formatting, plus `--pretty` and `--json` output modes.
- Slash commands `novahiz-clean`, `novahiz-doctor`, and `novahiz-status`, installed with the opencode command directory.
- The gate reports required skills that are absent from the installed index, in `unmatchedRequired` and in a `warnings` array.
- `CHANGELOG.md` and a rewritten `NOTICE.md` that records the licence of every bundled third-party skill.

### Changed

- The planning pipeline asks its questions through the harness question interface instead of writing them in the chat.
- The installer skips a skill that already exists in another scanned root (`~/.claude/skills`, `~/.agents/skills`) and reports what it skipped. `--force-skills` overrides.
- The opencode adapter persists skill invocations, so `report` and `clean --logs` see them under that harness.

### Fixed

- Test suites that opened the real ledger database now use a temporary one and clean up after themselves.
- `clean --dry-run` exits zero.

### Removed

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
