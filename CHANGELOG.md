# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.6] - 2026-09-28

### Added

- Claude Code harness support: `novahiz hook --harness claude` (PreToolUse gate with the auto-repair prompt, skill-load detection, `NOVAHIZ_GATE=off` kill-switch), `install/hooks.mjs` merging a novahiz group into `~/.claude/settings.json` (foreign groups preserved, `.novahiz-bak` backup, idempotent) plus the codex `hooks.json` variant, `claude mcp add` / `codex mcp` registration, the `adapters/claude/agent/novahiz.md` agent and its install-time copy to `~/.claude/{skills,commands,agents}`.
- Installer harness selection: interactive select (`opencode`, `claude`, `codex`, detected ones pre-checked), `--harness <list>` for scripted runs, `--yes` takes every detected harness, and only the selected harnesses are configured and auto-installed when absent (`opencode-ai`, `@anthropic-ai/claude-code`, `@openai/codex`, non-blocking).
- `doctor`: four non-blocking Claude Code checks (`claude-hooks`, `claude-agent`, `claude-skills`, `claude-commands`) shown only when a Claude config directory exists.
- Skill `novahiz-release`: the versioned release process (changelog entry, `npm version` bump, tag, GitHub Actions publish with provenance, post-release resync), wired as a final advisory step on the `devops` roadmap; devops now classifies release/publish/bump/tag/changelog prompts.
- `doctor`: `mcp-config` check (every `opencode.jsonc` server entry resolved against the catalog) and a `--deep` live probe — a JSON-RPC `initialize` handshake per configured server, probed in parallel with a 10 s budget each (14 checks with `--deep`, 13 without).
- Advisory roadmap steps: `novahiz-audit` closes the `audit` roadmap; `design-token-pipeline` sits on `design-ui` between tasks and design-craft.
- Impeccable integration (lots A + B), all advisory and opt-in:
  - `novahiz init` prints a non-blocking `impeccable` context step: it reads the installed-skills index (the gate's authority) and resolves `PRODUCT.md` / `DESIGN.md` per the impeccable rule (root → `.agents/context/` → `docs/`); a missing file yields a `/impeccable init` hint in `next`, never a failed step.
  - `doctor` gains `impeccable-context` and `impeccable-design` rows, visible only when the skill is indexed, never blocking (same opt-in visibility as the Claude harness rows).
  - `design-ui` roadmap gains three optional steps: `impeccable-shape` (UX/UI brief before code), `impeccable-harden` (errors/i18n/edge cases between audit and polish) and `impeccable-detect` (deterministic `verify` scan after polish); roadmap tests assert all six impeccable steps stay optional and `impeccable` never gates a non-optional step.
  - Skills: `novahiz-init` gains step 6 (run `/impeccable init` when `PRODUCT.md` is missing on design projects), `novahiz-converge` gains a UI-verification section (`npx impeccable detect <files>` as convergence proof).
  - Shared resolver `src/impeccable.ts` (`findContextFile`) used by init and doctor.

### Changed

- README showcase: a new "How a session runs" section walks the real loop (classify → roadmap → gate with auto-repair → verify/converge → memory), the Roadmaps section gains the six-stage pipeline table with the `trivial`/`lite`/`full` tiers, the Gate section documents auto-repair and the index-gap behaviour, a Memory section covers the `project-memory/` slots and the `MEMORY.md`/Obsidian dual-write, and the doctor counts now read 13 base / 17 with Claude Code / 19 with impeccable.

### Security

- Gate: `cron_add_task`, `cron_add_ai_task` and `cron_add_http_task` join `GATE_TOOLS` everywhere it is listed (plugin fallback, spec, installer, example config, configuration docs, test) — creating cron shell/AI/HTTP tasks now requires the same roadmap skills as the rest of the catalog, closing the gap found by the 2026-09-25 audit (L164).

### Fixed

- Gate auto-repair always includes `novahiz-gate` in its load steps, so the agent understands why an edit was blocked before retrying.
- Ghost skill references removed (`memory-save`, `wiki-ingest`, `wiki-lint`, `wiki-status`, `graph-colorize` were never in the installed index): `adapters/opencode/instructions.md`, `skills/novahiz-memory/SKILL.md`, `skills/memory/SKILL.md`.
- `expo-skills` provider now installs all 19 `expo-*` skills — `expo-migrate-module` and `expo-skill-eval` were referenced by the index but missing from the install command.
- Fresh `npm install -g novahiz` works before any home exists: `loadSpec` falls back to the catalog shipped inside the package (`packageRoot()`/`catalogPath`) instead of dying with ENOENT on the first documented command — npm 11+ gates lifecycle scripts, so nothing copies the home first. The home copy still wins once the installer wrote it.
- `novahiz-install` and `novahiz-uninstall` shipped shebang-less targets, so npm built shims that executed the `.mjs` bare: on Windows, with no `.mjs` file association, the community command hung or exited silently (the other three bins had `#!/usr/bin/env node` and worked). Both files now carry the shebang, and a test asserts every `package.json` bin target does.
- `doctor` Claude hooks row mirrors `install/hooks.mjs` `isNovahizHandler` (`hook --harness` plus `novahiz` or `cli.ts`) instead of testing the command for a `novahiz` path segment: a custom `NOVAHIZ_HOME` such as `/opt/gov` made a correctly wired install report as unwired.
- `doctor` referenced-skills blocks only on skills the package ships: the 34 dart/eas/expo/flutter/impeccable pack skills are optional delivery, so a healthy fresh install no longer exits 1 with `missing from index: dart-...` right after `novahiz-install --yes`. The row stays informational with the pack-install hint; the gate already reports absent skills as "not enforced".
- `DEFAULT_CONFIG.skillRoots` mirrors the example config (adds `~/.config/opencode/skills` and `~/.agents/skills`): a config missing its `skillRoots` key no longer hides gate-required pack skills from the index, the same gap `install/lib.mjs` had already fixed for fresh installs.
- README quick start matches reality: lowercase package and bin names, the explicit `novahiz-install --yes` step (npm 11+ allow-scripts means `postinstall` never auto-configures), no more `npm run build` (that script never existed; `prepare` builds), and the stale "12 health checks" comment replaced (13 base, 17 with Claude Code).
- The `mcpEntryProblems` doctor test no longer depends on the machine: it plants its own `narsil-mcp` shim on a temp PATH (and restores it in a `finally`), because CI runners have no `narsil-mcp` — the assertion had only ever run on dev boxes and failed on its first GitHub Actions pass (372/373).

## [0.3.5] - 2026-09-28

### Fixed

- Gate availability (audit 2026-09-25, MEDIUM): `RUN_TIMEOUT_MS` raised from 10 s to 30 s in the
  OpenCode plugin. Gate/CLI runs legitimately exceeded 10 s on 23-24/09 and the cap turned them into
  14 spurious fail-closed refusals; a truly hung CLI stays bounded.
- Slot ids are validated at both MCP entry points (`assertSlotId` in `parseSlotInput` and `getSlot`):
  empty ids, ids longer than 128 chars and ids carrying `.`, `/` or `\` fail with `E_SLOT_ID` instead
  of surfacing as "slot inconnu" (audit, LOW).
- Fresh installs pin their MCP commands instead of floating: context7 runs as
  `npx -y @upstash/context7-mcp@4.1.1` - no more global `context7-mcp` shim - and playwright as
  `npx -y @playwright/mcp@0.0.82`, matching `catalog/providers.json` (audit, LOW).
- `.gitignore` excludes `.mcp/` so a security-mcp report generated from the repo can never be
  tracked again (audit, MEDIUM on `.mcp/audit/tool-calls.jsonl`).

## [0.3.4] - 2026-09-28

### Added

- `scripts/ci-local.mjs` + `npm run ci:local`: reproduces the four steps of `.github/workflows/ci.yml`
  (catalog build, test suite, installer dry-run into `.ci-home`, check) with the same environment as the
  runner — `NOVAHIZ_HOME` set for sync/check and absent for the tests — so a local run and CI agree
  step for step. Stops at the first failing step; `.ci-home` is cleaned up and gitignored.

### Fixed

- `skills/novahiz-gate/SKILL.md` carried three statements the code no longer (or never) made: roadmap
  steps `edit`/`verify`/`advisory` do not join `requiredSkills` (the filter at `src/gate.ts:375` skips
  them), the index-semantics section pointed at lines 229-236 instead of 404-422, and an index gap is
  not silent — the gate appends `required skill not in index, not enforced: <skill> — run "novahiz"
  sync` to `reasons` and the CLI prints the same on stderr.

## [0.3.3] - 2026-09-28

### Added

- Compiled CLI for npm installs: `prepare` now emits `dist/` (`tsc -p tsconfig.build.json`, `rewriteRelativeImportExtensions` for the 41 `.ts`-extension relative imports). Node refuses type stripping under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so on 0.3.2 `npx novahiz version` crashed with exit 1 from any npm install. `bin/novahiz.mjs` now runs `src/cli.ts` from a checkout and the shipped `dist/cli.js` under `node_modules`, with an actionable message when `dist/` is missing and a Node >= 22.18 guard that prints one clear line instead of a module-resolution stack.

### Changed

- The installer is non-blocking on Windows and on degraded machines:
  - every `npm`/`npx` spawn in `install/install.mjs` and `install/bootstrap.mjs` passes `shell: true` on win32 — they are `.cmd` shims, and direct `spawnSync` throws ENOENT since the Node CVE-2024 hardening, which made global MCP/skill-pack installs silently never run and `npm outdated` always report "up to date". `runScript` in `src/exec.ts` now goes through the same validated `cmd.exe` path as `runCommand`.
  - a failed `npm install -g opencode-ai` prints a warning and continues instead of exiting 1 mid-install.
  - the postinstall dry-run can no longer fail a parent `npm install`: an old Node prints a warning instead of exiting 1, an unexpected crash exits 0 with a message, and the npm script itself carries `|| exit 0` as a last resort.
- Fresh-install config (`defaultConfig`, moved to `install/lib.mjs` so tests can assert it) mirrors `novahiz.config.example.json`: `skillRoots` covers `./skills`, `~/.config/opencode/skills`, and `~/.agents/skills`. Before, skill packs installed outside the repo were invisible to `novahiz sync` on a fresh install.
- `DEFAULT_CONFIG.skillRoots` is `./skills` instead of `[]`, matching `docs/CONFIGURATION.md`: a config that omits the key now indexes the bundled skills instead of nothing.
- `.novahiz-install.json` records the real package version (was hardcoded `0.1.0`).

### Fixed

- Regression tests: `runCommand`/`runScript` must spawn `npm` on every platform, and the installer-written config must keep all skill roots with `cron` disabled.

## [0.3.2] - 2026-09-28

### Added

- `impeccable` skill provider (`pbakaus/impeccable`, Apache-2.0, category `design-ui`): the upstream Impeccable skill required by gate rule R14 is now installable through the catalog instead of a manual copy — `npx skills add pbakaus/impeccable --skill impeccable -g -a opencode -y` (verified on Windows; installs to `~/.agents/skills`). 11 catalog entries = 7 MCP + 4 skill packs.

### Changed

- `catalog/providers.json` de-personalized: the `cron` and `novahiz` entries no longer carry machine-specific absolute paths. `novahiz` points at `~/.config/novahiz/mcp/novahiz-tools/index.mjs` (the opencode plugin resolves the real path from the home directory itself) and says so in its `purpose`; `cron` ships a template command plus the local-clone setup instead of one machine's venv paths.
- `cron` ships disabled by default (`providers.disabled` in `novahiz.config.example.json`, `DEFAULT_CONFIG`, and the installer), so fresh installs no longer register an MCP entry that only resolves on one machine. Enable it after the local scheduler setup documented in `docs/PROVIDERS.md`.
- Counts and docs follow the new provider: hygiene and CLI tests assert 11 providers and 11 dependencies, `docs/CATALOG.md` / `docs/CONFIGURATION.md` / `docs/PROVIDERS.md` updated, `NOTICE.md` records the Apache-2.0 attribution for pbakaus/impeccable.

### Fixed

- `docs/audit-2026-09-25.md` is excluded from the npm tarball: the machine-specific audit report stays in the repository but no longer ships to npm users.

## [0.3.1] - 2026-09-28

### Added

- Catalog `defaultSkills` guidance for the installed Flutter/Dart/Expo skill packs (33 entries across 6 categories; classification and `enforcedSkills` stay unchanged — defaults surface as guidance in `requiredSkills`):
  - `code`: 13 skills (`flutter-apply-architecture-best-practices`, `dart-run-static-analysis`, plus the 11 optional `expo-*` skills).
  - `debug`: `dart-fix-runtime-errors`, `flutter-fix-layout-issues`, `expo-dev-client`, `expo-upgrade`.
  - `test`: `flutter-add-widget-test`, `dart-add-unit-test`, `expo-skill-eval`, `eas-simulator`.
  - `design-ui`: `flutter-build-responsive-layout`, `expo-native-ui`, `expo-design-system`, `expo-animation`, `expo-ui` (appended to the three R13 skills).
  - `devops`: the six `eas-*` skills, plus the `eas` keyword so EAS build/submit/credentials prompts classify as `devops` instead of falling through to `general`.
  - `general`: `expo-skill-feedback`.
- `novahiz.config.example.json` `skillRoots` gains `~/.agents/skills`, so fresh installs index the agent skill packs alongside `./skills` and `~/.config/opencode/skills`.

### Fixed

- Gate tests read the gitignored `novahiz.config.json` directly, and no CI step creates it: the five `MINEUR`/`MAJEUR` gate tests in `tests/cli.test.ts` failed with ENOENT on `main` since the audit-test commits. A shared `rootConfigPath()` now falls back to `novahiz.config.example.json`, which is structurally identical for these assertions.

## [0.3.0] - 2026-09-26

### Added

- Expo / React Native category with precise skill routing (progressive gate):
  - `catalog/categories.json` gains `expo` (priority 61, tied with `flutter`) with weighted keywords (`expo`×3, `react native`×3, expo router / eas build / app.json / metro bundler / …), negative keywords `flutter`/`pubspec`, and `defaultSkills: ["expo-overview"]`.
  - Roadmap `expo-feature` (11 steps): the six-stage pipeline plus four **optional** `expo-*` steps between analyse and implement (`expo-router`, `expo-module`, `expo-dev-client`, `expo-upgrade`) and a final `novahiz-code-review`. Only pipeline skills are enforced; optional steps guide without blocking.
  - `R6-Novahiz` `promptCategories` includes `expo`.
  - `catalog/providers.json` gains `expo-skills` (10 entries = 7 MCP + 3 skill packs): MIT, categories `code`/`expo`, install command naming the 17 `expo-*` skills explicitly; the 7 `eas-*` paid-service skills are excluded.
  - 17 `expo-*` skills installed to `~/.agents/skills` via upstream tarball fallback (git transport to GitHub fails on this machine); `novahiz.config.json` `skillRoots` adds `~/.agents/skills`, so `novahiz sync` now indexes **84 skills** (dart/flutter packs finally indexed too).
  - Tests: hygiene counts (17 categories, 10 providers, 84 skills), classify tests for English and French Expo prompts (primary `expo`, `expo-overview` required, `enforcedSkills` stays pipeline-only, `expo-skills` provider proposed).
  - Docs: README, CLASSIFICATION, CATALOG, ARCHITECTURE, ROADMAPS (task→skill matrix for all 17 skills), PROVIDERS, NOTICE (MIT pack), planner skill.

- Impeccable design skill integrated as a first-class gate rule and roadmap steps:
  - `catalog/rules.json` gains `R14-impeccable` (11 rules total): same selectors as `R13-design-craft` (`design-ui` prompts or css/scss/sass/less/html/htm files), requiring the `impeccable` skill.
  - `catalog/categories.json`: design-ui roadmap gains optional `impeccable-critique`, `impeccable-audit`, `impeccable-polish` steps after implement; `flutter-feature` gains an optional `impeccable-critique` step after tests. Optional steps guide without blocking (roadmap tests assert `impeccable` never gates a non-optional step).
  - `novahiz.config.json` `skillRoots` adds the installed skill folder (`~/.config/.agents/skills/impeccable`); `novahiz sync` indexes 42 skills.
  - Adapters, agent prompt, instructions, README, docs (RULES, GATE, ROADMAPS, CATALOG, ARCHITECTURE) and `plugin.hygiene.test.ts` counts aligned (11 rules, 42 skills).
  - Workspace `opencode.jsonc` loads `~/.config/.agents/skills`; `opencode/NOTICE.md` records the Apache-2.0 attribution for pbakaus/impeccable.

- Deterministic Flutter category in the catalog:
  - `catalog/categories.json` gains `flutter` (priority 61, above `code`) with weighted keywords (`flutter`×3, `dart`×2, widget/pubspec/riverpod/…), negative keywords for Supabase, and default skills architecture + static analysis + unit tests.
  - Roadmap `flutter-feature` (10 steps): the six-stage pipeline plus non-optional `flutter-apply-architecture-best-practices` and `dart-run-static-analysis` before implement, `dart-add-unit-test` after, and a final `novahiz-code-review`.
  - `dart`/`flutter` keywords moved out of the generic `code` category so Flutter prompts classify as `flutter`.
  - `R6-Novahiz` `promptCategories` includes `flutter`; providers `dart`, `flutter-skills`, `dart-skills` serve the `flutter` category.
  - `catalog/overrides.json` adds ten Flutter skill entries (architecture/analyze/tests power 5).
  - Tests: classify Flutter prompts, roadmap quality gates, gate full/lite tiers on `lib/main.dart`, hygiene count 16 categories.
  - Docs: CLASSIFICATION, CATALOG, ARCHITECTURE, ROADMAPS, README, planner skill (16 categories).

- Official Flutter/Dart integration as providers, not vendored packages:
  - MCP `dart` (`dart mcp-server`, Dart SDK, BSD-3-Clause) in `catalog/providers.json`, re-enabled after the 0.2.x removal (`providers.disabled` no longer lists `dart`).
  - Skill packs `flutter-skills` (`flutter/agent-plugins`, 25 skills) and `dart-skills` (`dart-lang/skills`, 15 skills) with official `npx skills add` install commands.
  - `install.mjs` / `bootstrap.mjs` generated `opencode.jsonc` include the `dart` MCP entry and merge `~/.agents/skills` into `skills.paths`.
- Documentation and NOTICE record provenance and licences for the Dart MCP and both skill packs.

### Changed

- README / PROVIDERS / CATALOG counts: 7 MCP providers, 10 catalog entries, 17 categories, 84 indexed skills (tests updated in `providers.test.ts` and `plugin.hygiene.test.ts`).
- MCP list refreshed to match `catalog/providers.json`: `docs/PROVIDERS.md`, `README.md` and `NOTICE.md` now describe `cron` as the local MIT `scheduler-mcp` clone (replacing the AGPL `mcp-cron` npm package), and narsil/context7/dart categories align with the registry.

### Fixed

- `Novahiz doctor` `referenced` check: skill-pack ids (`flutter-skills`, `dart-skills`, `expo-skills`) were collected as if they were index entries, but a pack id never matches a `SKILL.md` name, so the check reported "missing" since packs were introduced. It now collects only gate-referenced skills (categories, roadmap steps, rules) — 32 present, check green.
- `Novahiz doctor` `gate` check: the smoke probe edited `README.md` with `categories: []`, which matches no current rule (R6 needs prompt categories, R9 needs the `code` class, R13/R14 need a style path, and no rule matches prose content since the old content rules were removed), so the check always reported "did not block". The probe now runs two deterministic evaluations against the live ruleset — a style-file edit (path rules) and a classified code edit with an explicit full tier (R6 plus roadmap steps) — and requires both to block. Doctor reports `No blocking anomaly.`
- `skills/novahiz-code-review/SKILL.md` (source and installed copy): the unquoted `description` contained `: `, which made the frontmatter invalid YAML so the skill never registered as loadable; it is now quoted.
- Pipeline skills omitted the new `expo` category from their category lists: `novahiz-plan`, `novahiz-task`, `novahiz-analyse`, `novahiz-implement`, `novahiz-converge`, and `novahiz-audit` did not mention `expo`, although `R6-Novahiz` and the `expo-feature` roadmap require them on Expo prompts. `expo` is now listed in all six (source and installed mirror, byte-identical). The stale counts in two of those lists are corrected: `novahiz-plan` said "Eight categories" while listing nine after the flutter sync (now "Ten categories"), and `novahiz-audit` said "Fourteen categories" while listing fifteen (now "Sixteen categories").
- `skills/novahiz-audit/SKILL.md` (source and installed mirror): the audited-category list included `security`, which is not a Novahiz category. It is removed and the count word follows the real list ("Fifteen categories").
- `install/install.mjs` and `install/bootstrap.mjs` still installed the AGPL `mcp-cron` npm package and emitted an `opencode.jsonc` template entry (`mcp-cron --transport stdio`), although `catalog/providers.json` moved `cron` to the local MIT `scheduler-mcp` venv, documented as having no npm install step. Both installers no longer install a `cron` npm package and no longer emit a template entry; the plugin registers `cron` from `catalog/providers.json` at startup like any other missing server.
- New hygiene test `skill category lists stay aligned with categories.json` (`plugin.hygiene.test.ts`): the planner's canonical list must equal the catalog ids (count in the heading plus set membership), and each pipeline skill's category paragraph may only name real categories, with any count word (Ten, Fifteen, …) matching the number of listed ids. It would have caught the missing `expo` and the ghost `security`.

## [0.2.5] - 2026-09-24

Single release combining the planned 0.2.4 fixes with the unreleased work below. 0.2.4 was never published to npm.

### Fixed

- Plan review due no longer forces `allow: false` on every gate target. The gate now blocks only paths owned by an open todo with a non-empty owner pattern (`reviewBlockReason`); unrelated files stay allowed, and a due review with no owned open todo is reported as a warning instead of a lock-out.
- `R4-playwright` also matches browser test paths (`**/*.spec.ts`, `**/e2e/**`, `**/playwright/**`, and related globs) with `match: "any"`, so editing those files loads `novahiz-browser` even without a `browser` prompt category.
- `docs/INSTALL.md` listed nine doctor checks; there are twelve. The same page now documents the `NOVAHIZ_GATE` kill-switch and that `gate.envEscape` is schema-only.

### Removed

- `novahiz-humanizer` and `ui-slop-remover` are no longer required by default on every prose, docs, or code edit. Gate rules `R1-docs` and `R1-code-prose` are gone. Both skills (plus `ui-craft-rules`) are now required only under `R13-design-craft`, which fires on `design-ui` prompts or style files (`css`/`scss`/`sass`/`less`/`html`/`htm`). `docs-writing.defaultSkills` is empty; `research → synthesize` no longer lists `novahiz-humanizer`. README count drops to 10 gate rules. Catalog, adapters, instructions, agent prompt, plugin gate message, docs, skills, and tests are aligned.
- `bundled-skills/` (132 vendored third-party skill folders) is gone. The package ships only `skills/`; `package.json` `files`, `install.mjs` / `bootstrap.mjs`, and `skillRoots` no longer reference it.
- MCP providers `expo`, `dart`, `sequential-thinking`, and `obsidian` removed from `opencode.jsonc` and from `catalog/providers.json` (otherwise `autoRegister` would restore them). Six providers remain: playwright, security, narsil, context7, cron, novahiz.

### Changed

- README / NOTICE / docs counts and tables match the new surface: 41 skills, 6 MCP providers. Tests assert the new numbers (`providers.test.ts`, `cli.test.ts`, `plugin.hygiene.test.ts`).
- Provenance for third-party MCP providers and opencode plugins is documented: `catalog/providers.json` gains `source` and `license` for each provider (real npm packages, not the former `@anthropic-ai/mcp-*` placeholders that 404), NOTICE lists package/repo/license for MCP and plugins, `docs/PROVIDERS.md` shows a provenance table, and `docs/HARNESSES.md` records `@mohak34/opencode-notifier` (MIT) and `@tarquinen/opencode-dcp` (AGPL-3.0-or-later). `install.mjs` / `bootstrap.mjs` now install `narsil-mcp`, `mcp-cron`, and `security-mcp` from their real package names, and pin the OpenCode plugins to `@mohak34/opencode-notifier@0.3.0` and `@tarquinen/opencode-dcp@3.2.0` to match the live `opencode.jsonc`.
- The twelve remaining third-party skill folders were replaced by Novahiz-authored skills under new names, written from scratch against primary sources: `anti-AI-design` → `ui-slop-remover`, `frontend-design-taste` → `ui-craft-rules`, `design-system-tokens` → `design-token-pipeline`, `apple-hig-audit` → `apple-ui-audit`, `engineering-code-standards` → `code-standards`, `ai-security` → `llm-threat-review`, `dependency-auditor` → `package-risk-audit`, `env-secrets-manager` → `secrets-hygiene`, `mcp-server-builder` → `openapi-mcp-server`, `skill-creator` → `skill-eval-loop`, `write-a-skill` → `skill-authoring`, `playwright-agent` → `browser-session`. Rewired: `catalog/rules.json` (R13), `opencode/catalog/rules.json` (R2), `catalog/categories.json` (design-ui defaults and design-craft step), `catalog/overrides.json`, `tests/gate.test.ts`, `tests/relevance.test.ts`, `tests/mcp.test.ts`, `agent/novahiz.md`, `docs/RULES.md`, `docs/ROADMAPS.md`, `README.md`, `novahiz-planner`. Old folders are removed from `skills/` and the `opencode/skills` mirror.

## [0.2.3] - 2026-09-23

### Added

- `dropTask` in the ledger: abandon a task (reason required when it is active), mark open todos as dropped, keep finished ones, and record a graft commit. Exposed as `novahiz task drop --id <task_id|todo_id> --reason "why"` and as MCP `novahiz_task` action `drop`. An unknown id returns an explicit error instead of a silent no-op.
- `novahiz init` project command: scaffold `project-memory/` and `novahiz-docs/`, with `--dry-run`, `--docs-only`, `--memory-only`, `--apply`, and `--json`. Distinct from `novahiz setup`, which still installs the package on the machine.
- `novahiz autodocs [--flush]`: tracks major source edits under `.novahiz/` and flushes docs when the session goes idle.
- `novahiz-init` skill and `/novahiz-init` slash command: agent pipeline around the CLI scaffold (deep read, docs fill-in, memory seed, reviewed cleanup).
- MCP `novahiz_gate` accepts an optional `prompt`. When `categories` is omitted or empty, the gate classifies from prompt, then content, then file path; explicit categories still win, and a classify failure fails closed.
- Tests for Windows path tokenization, PowerShell value flags, `dropTask`, and gate auto-classify (259 passing).

### Changed

- Shell path extraction keeps Windows path separators outside quotes. A backslash only escapes a shell metacharacter (`\ ` `\"` `` \` `` `$` and operators), so `C:\Users\…` is no longer mangled into a false target.
- Positional extraction skips values of common PowerShell value flags (`-ErrorAction`, `-Path`, `-ErrorVariable`, …) so switch arguments are not treated as file targets. Delete cmdlets prefer an explicit `-Path`/`-LiteralPath`/`-FilePath`/`-File` when present.
- The opencode plugin gate is fail-closed on spawn error and on non-zero non-two exit codes (previously it allowed the tool call).
- Plugin MCP key is `config.mcp.novahiz` (lowercase). Prompt rewriting and autodocs helpers are inlined so the installed copy under `~/.config/opencode/plugins/` does not depend on `../../src/*`.
- `gate.envEscape` stays in the schema for compatibility, but the kill-switch name is hardcoded to `NOVAHIZ_GATE` in the CLI, MCP gate, and plugin.
- README counts refreshed: 173 skills, 12 gate rules, 10 MCP providers, 12 doctor checks.

### Fixed

- `novahiz task drop` used to drop todos only. It now dispatches task ids and todo ids, and it fails with usage text when `--id` is missing.
- Doctor reports `none required (web-extract replaced defuddle)` when no external CLI is needed, instead of implying a missing dependency.

### Removed

- Test and polluter tasks left active in the ledger were bulk-abandoned (355 abandoned, 7 real tasks kept).

## [0.2.2] - 2026-09-23

### Added

- `project-memory` durable store under the project root: `index.json` plus fixed-size slots (8000 chars / 200 lines), compact → archive → new-slot rotation, shared by the plugin and the MCP surface.
- Five MCP tools: `memory_write`, `memory_list`, `memory_get`, `memory_init`, `memory_rebuild`.
- Plugin bootstrap (`ensureProjectMemory`) so a project gets a memory skeleton on first use.
- Two `doctor` checks: `memory` (limits present) and `memory-tools` (five tools registered).
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

### Removed

- Sixteen redundant third-party skills, removed from `skills/` and the `opencode/skills` mirror: `clean-code`, `zero-hallucination-coder`, `adversarial-reviewer`, `api-design-reviewer`, `anti-pattern-detector`, `code-understand`, `database-designer`, `postgresql-optimization`, `senior-architect`, `senior-backend`, `senior-secops`, `spec-driven-workflow`, `challenge`, `typescript-expert` (overlaps with the `Novahiz-*` pipeline), plus `fix` and `migrate` (outside this project's scope). Their `overrides.json` entries and `NOTICE.md` rows are gone; the dangling references in `novahiz-analyse`, `novahiz-implement`, and `env-secrets-manager` were removed.

### Changed

- Package and product renamed from Skillenforce to Novahiz across code, docs, skills, harnesses, and installers. The npm package name is `novahiz`; bins are `novahiz`, `novahiz-bootstrap`, `novahiz-install`, `novahiz-uninstall`, `novahiz-mcp`.
- NOTICE license inventory closed: the "no recorded upstream" list is empty. `skill-creator` frontmatter gains `license: Apache-2.0` (matches `LICENSE.txt`); `write-a-skill` license recorded as MIT (frontmatter + `original_license` metadata); `playwright-agent` recorded (MIT, upstream not recorded); `prompt-rewriter` recognized as Novahiz-owned with `license: Apache-2.0` and `compatibility` (implementation lives in `src/prompt-rewriter.ts` / `adapters/opencode/novahiz.ts`); em-dashes cleaned in `prompt-rewriter` SKILL.md.
- `playwright-agent` humanized (French prose kept, `license: MIT` preserved): absolute external-server rule reframed, 4-step startup protocol, error/cause/solution table, Playwright command cheatsheet (navigate, interact, capture, inspect, wait), 6 practical rules, Novahiz pipeline integration note; em-dashes and AI tells removed; mirror synced (1 file, 0 hashDiff).
- `skill-creator` humanized as Novahiz-owned (Apache-2.0 frontmatter already present): prose rewritten to drop em-dashes and AI writing patterns across `SKILL.md`, `agents/grader.md`, `references/schemas.md`, `scripts/improve_description.py`, `scripts/aggregate_benchmark.py`, `scripts/generate_report.py`, `eval-viewer/generate_review.py`, and `eval-viewer/viewer.html`; UI placeholder em-dashes replaced by `-`; structure and Anthropic LICENSE.txt preserved; mirror synced (18 files, 0 hashDiff).
- `env-secrets-manager` script `env_auditor.py` openai_key pattern fixed: `sk-[A-Za-z0-9]{20,}` missed real `sk-proj-` keys; now matches `sk-[A-Za-z0-9][A-Za-z0-9_\-]{19,}` (fixture on `.env` + `app.py` detects 7 findings: 3 critical / 3 high / 1 medium); mirror synced (4 files, 0 hashDiff).
- Humanization batch on remaining `Novahiz-*` skills: em-dashes and AI tells cleaned in `novahiz-browser` (16), `novahiz-code-review` (20+, plus not-X-but-Y in anti-patterns), `novahiz-supabase` (10), `novahiz-wcag-audit` (7 SKILL + 2 references + 2 scripts), `novahiz-web-extract` (12, plus "Extraction, pas reecriture"), `novahiz-postgres` (1); `novahiz-humanizer` left intact (documents the pattern on purpose); `write-a-skill` cleaned across SKILL, 3 scripts, 4 references (voice field, `leverage`/`highest-leverage`, POWERFUL badge removed); `skill-creator/agents/analyzer.md` "leverage" fixed; `gate` and `memory` aliases gain `license: Apache-2.0` + `compatibility` (only skills previously missing frontmatter license).
- Second-pass audit of all `Novahiz-*` skills (structural AI tells beyond em-dashes): fixed not-X-but-Y splits in `novahiz-gate` ("n'est pas un obstacle...c'est le signal") and `novahiz-planner` ("because it is followed, not only because it is programmed"); removed the "This is not a diff" opener in `novahiz-converge`; stripped the ⚠️ decoration in `novahiz-delta-review` and the en-dash in the `novahiz-supabase` PGRST range; tightened "serves as verification proof" in `novahiz-browser` and "pas seulement condamner" in `novahiz-code-review`; removed the double H1 (`# Skill: ...` + real title) in `novahiz-docs` and the five `Novahiz-assess-*` skills. Third-party fixes in the same pass: `skill-creator` aphorism "heart of the loop" and CLI emojis in `package_skill.py`; `dependency-auditor` heading emojis in README and "crucial" in the license matrix. `novahiz-humanizer` still intentionally keeps its em-dashes. Mirror realigned (17 files, final_mismatches=0).
- Full reinvention of all Novahiz-owned and previously third-party skills as original Novahiz work (author `Novahiz`, Apache-2.0 except MIT on `novahiz-humanizer` and `novahiz-security`). Twelve third-party skills rewritten from primary sources with no residual upstream text or attribution: `mcp-server-builder`, `anti-AI-design`, `frontend-design-taste`, `design-system-tokens`, `apple-hig-audit`, `engineering-code-standards`, `ai-security`, `dependency-auditor`, `env-secrets-manager`, `skill-creator` (Anthropic LICENSE.txt replaced by Novahiz Apache-2.0), `write-a-skill` (Matt Pocock `original_author`/`voice` metadata removed), `playwright-agent`. All 25 `Novahiz-*` pipeline skills rewritten (including the seven core stage skills and the five `Novahiz-assess-*` skills), plus the `gate`/`memory` aliases and `prompt-rewriter`. `novahiz-humanizer` rebuilt as an original pattern catalogue with no Wikipedia/WikiProject source line. NOTICE.md updated: only `supabase-postgres-best-practices`, `supabase`, and `bundled-skills/android-reverse-engineering` remain recorded as third-party. Mirror synced (135 files, final_mismatches=0).
- `env-secrets-manager` rewritten as Novahiz-owned (Apache-2.0): frontmatter gains `license` and `compatibility`; prose humanized (removed AI writing tells, em-dashes, POWERFUL badge meta); dangling cross-references to non-existent `engineering/*` skills replaced with existing `novahiz-security`, `engineering-code-standards`, `dependency-auditor`, `ai-security`; script capability stated accurately (7 offline regex patterns, working tree only, not a gitleaks/detect-secrets replacement); Sources section added (gitleaks, detect-secrets, OWASP WSTG, HashiCorp Vault, cloud secret managers, CSI driver, External Secrets Operator); em-dashes cleaned in `references/validation-detection-rotation.md`.
- Author field on all 40 proprietary skills under `skills/` set to `Novahiz` (was `Novahiz`); `organization: Novahiz` unchanged; NOTICE.md wording updated to match.
- `package.json` `author` set to `Novahiz` (was `Novahiz`); package `name` and bins unchanged.
- `dependency-auditor` rewritten as Novahiz-owned (Apache-2.0): frontmatter gains `license` and `compatibility`; prose humanized (removed AI writing tells, em-dashes, POWERFUL badge meta); scope boundary with `ai-security` and `engineering-code-standards` made explicit; OpenSSF supply-chain context section added (SLSA, Sigstore, GUAC, OSPS Baseline, Supply Chain Integrity WG, verified openssf.org 2026-09-22); Sources section added (OpenSSF, OSV, SPDX).
- `ai-security` rewritten as Novahiz-owned (Apache-2.0): frontmatter gains `license` and `compatibility`; prose humanized (removed AI writing tells, em-dashes, NOT-X-but-Y contrasts); OWASP LLM Top 10 2025 / GenAI Security Project mapping added (LLM01 injection, LLM03 poisoning, LLM06 inversion, LLM08 excessive agency) with live source; cross-references fixed (dangling `threat-detection`, `incident-response`, `cloud-security`, `security-pen-testing`, `red-team` replaced with existing `novahiz-security`, `dependency-auditor`, `engineering-code-standards`); Sources section added; em-dashes cleaned in `references/atlas-coverage.md` and `scripts/ai_threat_scanner.py` CLI strings.
- `engineering-code-standards` rewritten as Novahiz-owned (Apache-2.0): frontmatter `compatibility` expanded (load-on-demand rules, standards 20/41/42 live in engine); prose humanized (removed AI writing tells, em-dashes, ALL-CAPS shouting in section intros); factual updates (Core Web Vitals FID replaced by INP as of March 2024, WCAG 2.1 AA raised to WCAG 2.2 AA); Sources section added (OWASP, WCAG 2.2, web.dev Vitals, Conventional Commits, Keep a Changelog, Google SRE, Stripe, GDPR, NIST).
- `apple-hig-audit` rewritten as Novahiz-owned (Apache-2.0): frontmatter gains `compatibility`; prose humanized (removed AI writing tells, em-dashes, ALL-CAPS shouting); Related skills fixed (dangling `ux-researcher-designer` and `landing-page-generator` removed, replaced with existing `anti-AI-design`/`frontend-design-taste`); Sources section added to SKILL.md; em-dashes cleaned in `references/accessibility.md`, `references/visual-design.md`, `references/platform-specifics.md`.
- `design-system-tokens` rewritten as Novahiz-owned (Apache-2.0): frontmatter gains `compatibility`; prose humanized (removed AI writing tells, em-dashes, ALL-CAPS shouting); new "Standards layer" section covering DTCG format (2025.10: 13 token types, `$value`/`$type`, aliases, `$root` groups, color spaces) and Style Dictionary v4 (DTCG forward-compatible, per-platform transform groups, `outputReferences`); decision table for when to use which tool; sources section citing designtokens.org, Style Dictionary, and Tokens Studio.
- `frontend-design-taste` rewritten as Novahiz-owned (Apache-2.0): prose humanized (removed AI writing tells, em-dashes, ALL-CAPS shouting); structure reorganized (baseline dials, architecture, design rules, creative implementation, performance, dial reference, forbidden patterns, arsenal, bento paradigm, pre-flight); enriched with Taste Skill sources (border rule `1px solid #EAEAEA`, staggerChildren parent-tree constraint, color palette rule, DESIGN.md seven-aspect structure); explicit pairing note with `anti-AI-design` (R13).
- `anti-AI-design` rewritten as Novahiz-owned (Apache-2.0): frontmatter gains `license` and `compatibility`; banned-pattern tables humanized (unsourced statistics removed); new sections on fake KPI panels, endless centered sections, cloned block rows, carousels, monospace for numerical data; explicit pairing note with `frontend-design-taste` (R13); sources section citing Taste Skill anti-slop rules.
- `mcp-server-builder` rewritten as Novahiz-owned (Apache-2.0): new SKILL.md covering spec baselines (stable 2025-11-25 and main 2026-07-28), capability declaration, primitive table, OAuth 2.1 roles, tool design rules, stdio logging, and evolution rules; new `references/spec-compatibility.md` documenting field deltas, elicitation flow, pagination/caching fields, and adoption checklist; `production-hardening-guide.md` extended with OAuth 2.1 resource-server pattern and spec security requirements; README updated. The commands moved to `src/commands/` and their shared primitives to `src/commands/context.ts`. The split is behaviour-neutral, checked against captured output of all 31 CLI invocations.
- The planning pipeline asks its questions through the harness question interface instead of writing them in the chat.
- The installer skips a skill that already exists in another scanned root (`~/.agents/skills`) and reports what it skipped. `--force-skills` overrides.
- The opencode adapter persists skill invocations, so `report` and `clean --logs` see them under that harness.
- The CLI validates its numeric flags (`--min-score`, `--max-categories`, `--limit`, `--days`, `--max-iterations`) and rejects a value out of range instead of falling back to the default in silence.
- `novahiz check` reports the stored `last_sync` timestamp, which nothing read before.
- `novahiz doctor` reports the schema version as a tenth check.
- `enforcement_log` gained indexes on `session_id` and `logged_at`, and `PRAGMA user_version` marks the schema generation.
- `commandTask` split into thirteen helpers; 59 exports with no reader outside their own file lost the keyword; the unused `bullet` and `emphasize` are gone.

### Fixed

- `NOTICE.md` now names both `skills/` and `bundled-skills/` and records the `android-reverse-engineering` upstream (Simone Avogadro, Apache-2.0).
- Six `SKILL.md` files (`novahiz-assess-intake`, `-research`, `-define`, `-shape`, `-decide`, `novahiz-docs`) were missing YAML frontmatter; each now carries `name`, `description`, `license`, and `compatibility`.
- `docs/CONSTITUTION.md` package list omitted `bundled-skills`.
- Seventeen `Novahiz-*` skills declared `license: MIT` while NOTICE states those pipeline skills are always Apache-2.0; only `novahiz-humanizer` and `novahiz-security` keep MIT, as recorded in NOTICE. The `opencode/skills` mirror was realigned with the source tree.
- `skills/` and `opencode/skills` were aligned so their content hashes match.
- The MCP `novahiz_gate` tool rejected calls that used the `filePath` parameter name (as some harnesses surface it). It now accepts `file` or `filePath` and still fails closed when neither is a non-empty string.
- Docs said 14 categories while `categories.json` defines 15: added `assessment` (priority 44, 5-step roadmap) to the counts and tables in README, CLASSIFICATION, CATALOG, ARCHITECTURE, and the planner skill.
- Test suites that opened the real ledger database now use a temporary one and clean up after themselves.
- `clean --dry-run` exits zero.
- A bundled skill whose frontmatter names an `allowed-tools` entry the harness does not recognize fails to launch at all. The eleven `novahiz-*` skills no longer declare `allowed-tools`.
- The `question` tool was missing under opencode. opencode denies it to every agent by default and only the built-in `build` and `plan` agents re-allow it, so the custom `novahiz` agent inherited the denial and the pipeline could not ask a clarifying question. The agent now grants `question` and `plan_enter`, and the new `agent` doctor check fails when the installed copy loses the grant.
- `novahiz classify` scored zero on a refactor prompt: `decouper`, `decoupage`, `extraire`, `extraction`, `isoler`, `modules`, `split`, `cli`, and `refactorisation` are now keywords of the `code` category.
- Adding a todo to a completed ledger task left it marked `done`. The task is reopened as `active`.
- An error at the top of the CLI printed a Node stack trace of up to sixteen lines. It now prints one line, `novahiz: <message>`, on stderr. An unknown command likewise exits 1 with `unknown command <name>` instead of printing help and exiting 0.

### Removed

- 37 duplicate skill folders: every skill present in both `skills/` and `bundled-skills/` now lives once under `skills/`.
- Root-level orphan skill folders that no longer belonged to either tree.
- Leftover Humanizer artifacts left behind by an earlier rename.
- The coquille directory `opencode/skills/impeccable`.
- Claude Code and Codex support: `install/hooks.mjs`, `src/hook.ts`, `src/commands/hook.ts`, `adapters/claude/`, and the `hook` CLI command. opencode is now the only harness Novahiz configures; other clients keep the MCP server and lose the gate.
- The vendored `impeccable` copy, which the provider installs.
- The `planner` stub, replaced by the `novahiz-plan` stage.

## [0.1.0] - 2026-09-11

Initial release under the Skillenforce name (npm history later continued as `novahiz` 0.1.x).

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
