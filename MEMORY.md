# Novahiz — Project Memory

Durable facts about this repository. The change history lives in [CHANGELOG.md](CHANGELOG.md).

## What it is

An enforcement and execution layer for coding agents. It classifies a request into categories, attaches a roadmap, and gates edits until the roadmap's skills are loaded. It runs on opencode as a plugin plus an MCP server, and installs hooks for Claude Code and Codex.

## Invariants

- **Gate semantics.** A requirement reaches the gate from two sources: `catalog/rules.json`, which is content-aware and keyed by file class, and the roadmap's steps that have `kind: "skill"` and are not `optional`. Steps of the other kinds shape the checklist and never block (`src/gate.ts`).
- **An unindexed skill fails open.** A required skill missing from the installed index lands in `unmatchedRequired`, is reported in `warnings`, and stops being enforced. See `src/gate.ts:229-236`. The index is `build/installed-skills.json`, written by `sync`.
- **Categories and roadmaps live in `catalog/categories.json`.** The six-stage pipeline (plan, clarify, tasks, analyse, implement, converge) applies to `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`.
- **The ledger requires proof.** A `verify` todo does not close without `proof` (`src/ledger.ts`).
- **Providers are referenced, never vendored** (`catalog/providers.json`).
- **Every Novahiz skill exists twice**: the source under `skills/` and the installed copy in the harness config directory. When several scanned roots carry the same skill id, the catalog keeps the copy whose `sourcePath` sorts first alphabetically. `~/.config/humanizer` beats `skills/humanizer`, and `skills/` beats `~/.config/opencode/skills`. That is why `sync` has to run after a skill changes.
- **The opencode adapter exists twice as well**: `adapters/opencode/novahiz.ts` and `adapters/opencode/tokens.ts` in the repository, and their copies in `~/.config/opencode/plugins/`. opencode runs the installed copy, so editing the repository file changes nothing until that copy is refreshed (the installer does it) and opencode restarts.

## Configuration

- `novahiz.config.json` holds `dbPath`, `skillRoots`, `gate` (enabled, mode, envEscape, tools), `classify`, `providers`, `ledger`, and `tokens`.
- `NOVAHIZ_HOME` relocates the home directory. `NOVAHIZ_DB` overrides the database path, which is how the tests stay off the real ledger.
- `NOVAHIZ_GATE=off` disables the gate for a session.

## Gotchas

- Any change to `catalog/*.json` or to a skill needs `novahiz sync`, or the catalog and the index keep describing the previous state.
- The gate logs every decision to `enforcement_log`, so the database grows during ordinary use. `novahiz clean` prunes it.
- `defuddle` is a real external dependency of the `research` roadmap step, and `novahiz doctor` checks for it.
- `skills/` is partly third-party. `NOTICE.md` records each licence, and says plainly which ones have no upstream information.
- The package ships no runtime dependency. Anything added has to earn its place.

## Open work

Tracked in the execution ledger and in `CHANGELOG.md`, not here. Run `novahiz doctor` to see what blocks.
