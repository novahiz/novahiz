# Novahiz — Project Memory

Durable facts about this repository. The change history lives in [CHANGELOG.md](CHANGELOG.md).

## What it is

An enforcement and execution layer for coding agents. It classifies a request into categories, attaches a roadmap, and gates edits until the roadmap's skills are loaded. It runs on opencode as a plugin plus an MCP server. Other clients can use the MCP server, without the gate.

## Invariants

- **Gate semantics.** A requirement reaches the gate from two sources: `catalog/rules.json`, which is content-aware and keyed by file class, and the roadmap's steps that have `kind: "skill"` and are not `optional`. Steps of the other kinds shape the checklist and never block (`src/gate.ts`).
- **An unindexed skill fails open.** A required skill missing from the installed index lands in `unmatchedRequired`, is reported in `warnings`, and stops being enforced. See `src/gate.ts:229-236`. The index is `build/installed-skills.json`, written by `sync`.
- **Categories and roadmaps live in `catalog/categories.json`.** The six-stage pipeline (plan, clarify, tasks, analyse, implement, converge) applies to `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`. `flutter` reuses the same stages and inserts architecture, `dart analyze`, and unit-test skills (non-optional on full tier).
- **The ledger requires proof.** A `verify` todo does not close without `proof` (`src/ledger.ts`).
- **Providers are referenced, never vendored** (`catalog/providers.json`).
- **Every Novahiz skill exists twice**: the source under `skills/` and the installed copy in the harness config directory. When several scanned roots carry the same skill id, the catalog keeps the copy whose `sourcePath` sorts first alphabetically. `~/.config/humanizer` beats `skills/humanizer`, and `skills/` beats `~/.config/opencode/skills`. That is why `sync` has to run after a skill changes.
- **The opencode adapter exists twice**: `adapters/opencode/novahiz.ts` in the repository, and its copy in `~/.config/opencode/plugins/`. opencode runs the installed copy, so editing the repository file changes nothing until that copy is refreshed (the installer does it) and opencode restarts.

## Configuration

- `novahiz.config.json` holds `dbPath`, `skillRoots`, `gate` (enabled, mode, tools), `classify`, `providers`, and `ledger`. `gate.envEscape` remains in the schema for compatibility but the kill-switch name is hardcoded to `NOVAHIZ_GATE`.
- `NOVAHIZ_HOME` relocates the home directory. `NOVAHIZ_DB` overrides the database path, which is how the tests stay off the real ledger.
- `NOVAHIZ_GATE=off` disables the gate for a session.

## Gotchas

- **Windows env vars are case-sensitive through spawnSync.** Passing `NOVAHIZ_HOME` (lowercase) in `spawnSync` env does NOT make `NOVAHIZ_HOME` (uppercase) visible to the child process. All test env overrides and plugin env vars MUST use uppercase keys (`NOVAHIZ_HOME`, `NOVAHIZ_DB`, `NOVAHIZ_GATE`).
- Any change to `catalog/*.json` or to a skill needs `Novahiz sync`, or the catalog and the index keep describing the previous state.
- The gate logs every decision to `enforcement_log`, so the database grows during ordinary use. `Novahiz clean` prunes it.
- `novahiz-web-extract` replaced the external `defuddle` CLI on the `research` roadmap step; `Novahiz doctor` no longer checks for external CLIs (`SKILL_CLI` is empty).
- `skills/` is entirely Novahiz-owned. `NOTICE.md` records each licence.
- Pipeline skills (`novahiz-*`) are Apache-2.0 in their frontmatter; only `novahiz-humanizer` and `novahiz-security` stay MIT, as recorded in NOTICE.
- `bundled-skills/` was removed on 2026-09-24: third-party skill packs are no longer vendored. Catalog has 7 MCP providers (context7, cron, dart, narsil, novahiz, playwright, security) plus skill packs `flutter-skills` and `dart-skills` (9 entries total; install via `npx skills add`, licences BSD-3-Clause).
- The MCP `novahiz_gate` tool accepts `file` or `filePath`: some harnesses rename the parameter when they surface the tool. Neither being a non-empty string fails closed with -32602.
- The package ships no runtime dependency. Anything added has to earn its place.

## Open work

Tracked in the execution ledger and in `CHANGELOG.md`, not here. Run `Novahiz doctor` to see what blocks.
