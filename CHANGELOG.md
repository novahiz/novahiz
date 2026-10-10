# Changelog

All notable changes to Novahiz are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.8.0] - 2026-10-09

Minor release: total Impeccable coverage on the design roadmap, a repair
command for the optional skill packs, and an honest diagnosis of why packs go
missing on fresh installs.

### Added

- **Design-ui roadmap: total Impeccable coverage** (`catalog/categories.json`):
  23 `kind: skill` steps carry the whole official playbook — init, document,
  shape, critique, then the targeted fixes (layout, typeset, colorize,
  animate, adapt, bolder, quieter, clarify, delight, distill, extract,
  onboard, optimize, overdrive, generate), then audit, harden, polish and the
  detect → verify loop. Labels match the official descriptions published on
  https://impeccable.style/cheatsheet. Every step is `optional: true` (a
  checklist the agent follows, gate enforcement stays with R14);
  `impeccable-live` is excluded on purpose (live browser session, not a
  code path) and the deprecated `craft` alias is dropped. Rollback:
  `categories.json.pre-impeccable-full.bak`.
- **`/novahiz-skills-update` command**
  (`adapters/opencode/commands/novahiz-skills-update.md`): reinstalls every
  optional skill pack — dart, flutter, expo, impeccable — cleanly from their
  official providers (`novahiz deps --install --yes`), refreshes the
  Impeccable CLI/engine from npm, resyncs the skill index and verifies with
  doctor. The one command a community member runs when packs are missing.

### Changed

- **`doctor` now names the git root cause** (`src/commands/doctor.ts`): a new
  non-blocking `git (skill packs)` row — the official skills CLI behind every
  `providers.json` `kind: skill` entry (dart-lang/skills, flutter/agent-plugins,
  expo/skills, pbakaus/impeccable) requires git; without it those installs fail
  silently on a fresh setup, which is exactly how a machine ends up with 33
  pack skills missing and no explanation. Present → "installable"; missing →
  install hint pointing at `/novahiz-skills-update`.
- **`Referenced skills` hint** (`src/commands/doctor.ts`): the
  "novahiz-install --dart-skills --flutter-skills" hint now points at
  `/novahiz-skills-update, or novahiz deps --install`, the actual repair path.

## [0.7.1] - 2026-10-08

Patch release: two installation-level repairs found while cutting 0.7.0 — the
memory MCP degraded on machines without a home catalog, and the docs reading
layer collapsed under the SQLite planner of node 22.

### Fixed

- **`packageRoot()` walk-up** (`src/spec.ts`): the community-path assumption
  (entry script exactly one directory below the package root) held for `bin/`
  and `src/` but not `mcp/<server>/index.mjs` — two levels down it resolved to
  `mcp/catalog/` (absent), so on any machine whose home has no catalog yet
  (CI, fresh `npm install -g novahiz` before the installer ran) every memory
  call returned `failed: true` « Invalid or missing catalog file ». The
  resolver now walks up to the nearest `package.json`, preferring
  `name: "novahiz"`, pinned by a regression test that reproduces the exact CI
  condition (`tests/memory-p5.test.ts`, `NOVAHIZ_HOME` empty) — red CI on
  Linux since 0.7.0, dead memory tools on the documented community path.
- **Docs search plan pinned with CROSS JOIN** (`mcp/novahiz-docs/src/store.ts`):
  SQLite 3.51.3 (node:sqlite of node 22.23.x) reorders the plain JOIN — it
  drives from `chunks(library)` and re-evaluates the full FTS MATCH for every
  chunk of the library (50 × ~6 ms ≈ 315 ms instead of ~14 ms), collapsing
  the 100 ms reading budget (742-1085 ms observed on CI runners). SQLite
  never reorders a CROSS JOIN (`optoverview` 7.1.2, `lang_select` 2.2), so
  the plan is now pinned on every runtime: 315.8 → 13.3 ms on 3.51.3,
  unchanged 14.1 ms on 3.53.3 — same result set, only the plan changes.

## [0.7.0] - 2026-10-08

Feature release: the Obsidian vault becomes a first-class citizen of the
workflow, and the install ships a self-sufficient runtime — the MCP trio is
wired statically, the docs index is seeded, and the LSP section is declared.

### Added

- **Vault auto-consult**: the plugin reads the `second-memory` vault during
  session setup (`memory.auto.vault`), so decisions and next steps from the
  vault reach the model without a manual read. `instructions.md` now states
  the Obsidian/second-memory consultation rules (T2, T3).
- **`novahiz docs` command** (`src/commands/docs.ts`): `status` reports the
  local documentation index per library, `ingest <id>|--all [--dry]` fills it
  over the network. Backed by new CLI modes on the docs MCP itself
  (`node mcp/novahiz-docs/index.mjs --ingest … | --status`) — `src/ingest.ts`
  finally has an entry point (D1).
- **Docs index seed at install**: the installer fills the core bouquet
  (react, nextjs, typescript, nodejs, tailwindcss, dart, flutter, expo) in a
  non-blocking step; offline installs still succeed and the fill command stays
  available. `read_docs` now names the command when a library is unindexed.
- **`novahiz second-memory search`** (T1) and **`doctor --apply` regenerates a
  drifted `STRUCTURE.md`** (T6, `structureDrift`).
- **`stitchConfigured()`**: `novahiz init` recommends `novahiz stitch` only
  when the API key is absent (T5); new `src/commands/stitch.ts`.
- **`novahiz upgrade`** command and the `/novahiz-upgrade` in-session command
  (`src/commands/upgrade.ts`, `adapters/opencode/commands/novahiz-upgrade.md`).
- **Installer UI**: dedicated `install/ui.mjs` (+ `.d.mts`), plain/ASCII banner,
  step layout — `tests/installer-ui.test.ts`.
- **Obsidian vault step (10/10)**: the installer creates the `second-memory`
  vault structure and its ten community plugins when missing (T7).

### Fixed

- **MCP trio wired statically (D2)**: `novahiz-core`, `novahiz-gate` and
  `novahiz-scan` are written into the generated `opencode.jsonc`, and the
  plugin transform registers them *before* the awaited `providers --mcp-json`
  spawn — a transform landing after MCP resolution never binds servers (audit
  2026-10-08: no connection, no warning). The trio now connects on install;
  the plugin skips ids already present, so no duplicates.
- **Plugin renamed `novahiz` → `novahiz-workflow`** (descriptive id in the
  image of `novahiz-token-economy`), and the live plugin copy is resynced from
  the source on install — the running session no longer lags the repo.
- **Gate tests are hermetic to `NOVAHIZ_GATE`**: an operator running
  `novahiz gate off` no longer turns two MCP gate tests red — child processes
  get a sanitized environment.
- **`tsconfig.build.json` restored**: `npm run prepare` referenced a file that
  was missing from the working copy.

### Changed

- **LSP declared**: the live opencode config carries an `lsp` object with five
  servers verified present on the machine (dart, typescript, bash, yaml, json);
  the generated config writes `lsp: true` (portable — no dead entries on user
  machines). Verified against OpenCode v2.0.24: the config is accepted and
  preserved (`config.get` echoes it), but V2 has no LSP runtime yet — no server
  is started until upstream ships one.

## [0.6.0] - 2026-10-06

Feature release: the gate learns project scope, and Stitch design projects
get a capture → composite → fidelity-verdict loop.

### Added

- **`R16-stitch-fidelity` gate rule**: editing a UI file (`*.tsx`, `*.jsx`,
  `*.vue`, `*.svelte`, `*.dart`, `*.css`, `*.scss`, `*.html`) now requires
  the `novahiz-stitch-fidelity` skill — but only inside a project that
  carries `stitch/**` references. This is the new `projectGlobs` selector
  (`src/spec.ts`, `src/gate.ts`): nearest ancestor of the edited file
  holding `.git`, `package.json` or `pubspec.yaml`, globs written from that
  root. Projects without Stitch references are unaffected.
- **`novahiz-stitch-fidelity` skill**: `scripts/stitch_capture.mjs` (adb:
  uiautomator dump, screencap, input, adb.autoStart), `scripts/stitch_composite.mjs`
  (screenshot ↔ design overlay), the fidelity judgment grid, capture
  recipes and a `verify.config.defaults.json`.
- **`stitch-fidelity` provider** (`kind: commands`): adb prerequisite with
  per-OS bootstrap (winget / brew / apt), categories `design-ui`, `expo`,
  `flutter`; `stitch_capture.mjs --check` reports the seven readiness items.
- Optional `stitch-verify` roadmap step (`kind: verify`) in two roadmaps.
- Tests: `tests/gate-stitch-fidelity.test.ts` — project-scoped enforcement.

### Changed

- README headline and counts refreshed: 99 skills, 13 gate rules, 8 MCP
  providers, version line at 0.6.0 (was advertising 96/11/7 and 0.4.1).

## [0.5.2] - 2026-10-05

Maintenance release closing the three leftovers traced right after `0.5.1`:
the installer's dead `plugin` config key, the unread `tokens` block of the
example config, and the scheduler's 0 ms wake loop on a busy task.

### Fixed

- `install/install.mjs` no longer writes a `"plugin"` array of **file paths**
  into a freshly created `opencode.jsonc`. opencode never read it (the plugins
  are loaded from `<config>/plugins`, proved in E2E: the key pointed at the
  repo while the loaded copies came from the plugins directory) and a file
  entry triggered `configured plugin path must be a directory` at every
  startup. Existing configs are left untouched.
- `novahiz.config.example.json` no longer advertises a `tokens` block
  (`enabled`, `trimOutputs`, `keepHeadLines`, `dedupeReads`, `capOutputTokens`,
  `trimTools`, …) that no code ever read — a leftover of a layer that was never
  shipped. The example now carries exactly the keys `defaultConfig()` writes,
  and `docs/TOKENS.md` states it instead of pointing at a block that should
  not be there.
- `mcp/clepsydre/src/scheduler.ts`: `arm()` no longer arms a timer for a task
  that is already running. A past-due schedule on a busy task used to feed a
  0 ms `wake → skip → arm` loop (one task-store read per turn) for the whole
  execution, and a manual trigger could sustain it. The lock release now goes
  through `release()`, which re-evaluates the calendar once the task is free,
  so a due occurrence is still caught up exactly once instead of by the spin.

## [0.5.1] - 2026-10-05

Fix-forward release: the `v0.5.0` tag was pushed but its CI never reached
`npm publish`, so no `0.5.0` exists on the registry.

### Fixed

- `tests/memory-robust.test.ts` built the child process's import URL from a
  hardcoded absolute path (`file:///C:/Users/...`): the two-process lock test
  only passed on one machine and failed every CI run with "le fils ne s'est
  jamais signale pret". The URL now derives from `import.meta.url`.
- `tests/clepsydre-scheduler.test.ts` (lock test) observed the released lock
  a single `setImmediate` after `release()`, racing a wake armed at delay 0
  for a past-due schedule: depending on event-loop timing it saw either
  `busy = []` or the task re-locked by a second execution. The test stops the
  wake before observing the state, so the lock-release assertion is
  deterministic. The re-arm it exposes (a past-due schedule on a busy task
  keeps `arm()` at delay 0) is left to the scheduler, not to this release.

## [0.5.0] - 2026-10-05

### Added

- **Token economy, plugin + skill** (`adapters/opencode/novahiz-token-economy.ts`,
  `skills/token-economy/SKILL.md`): the plugin trims oversized tool output
  before it reaches the model - head kept, full text written to
  `<NOVAHIZ_HOME>/tmp/tool-output/`, footer naming the file to re-read instead
  of re-running - and `/novahiz-tokens` posts the estimated saving for the
  session without a model call. Strictly opt-in: nothing happens until
  `NOVAHIZ_TOKEN_ECONOMY=1`, `read`/`edit`/`write` and skill output are never
  trimmed, and any plugin error fails open. Budgets: `NOVAHIZ_TE_MAX_LINES`
  (120), `NOVAHIZ_TE_MAX_BYTES` (16384), `NOVAHIZ_TE_TOOLS`,
  `NOVAHIZ_TE_DUMP_DIR`. The skill carries the agent-side rules (read the
  smallest thing, batch calls, delegate exploration, answer in paths).
- The installer now copies both plugin files into `<config>/plugins/`, the
  directory opencode actually loads plugins from.

### Fixed

- **Argus vulnerable fixtures are no longer collected by the test runner**:
  `mcp/argus/src/test/` was renamed to `mcp/argus/src/fixtures/`, so
  `node --test` (and `node scripts/ci-local.mjs`) stops picking
  `test_xss.js` - a deliberately vulnerable sample - up as a test file and
  failing on `require is not defined in ES module scope`. The argus end-to-end
  suite still reports 30/30.
- `tests/clepsydre-tools.test.ts` used a one-shot date hardcoded to
  `2026-10-05T09:00:00Z`, which started failing once the clock passed it; the
  test now uses a date relative to now.

### Docs

- `docs/TOKENS.md` rewritten around what is implemented (the plugin, the
  skill, `novahiz tokens`); it now states that the `tokens` block of
  `novahiz.config.example.json` is read by no code.

## [0.4.1] - 2026-10-05

### Fixed

- **`npm install -g novahiz` works on npm 11.16+**, where install scripts no
  longer count as approved unless they appear in `allowScripts` and a global
  install has no `package.json` to record that approval in — npm prints
  `npm warn allow-scripts novahiz (...)` and, depending on the version, skips
  the postinstall so nothing gets configured. The recommended command is
  `npm install -g --allow-scripts=novahiz novahiz`;
  `npm config set allow-scripts=novahiz --location=user` makes it permanent so
  plain `npm install -g novahiz` works afterwards.
- **The published 0.4.0 tarball still carried the dry-run postinstall**
  (`node install/install.mjs --dry-run`) — the `--yes` republish never reached
  the registry, so even an allowed postinstall only printed the next step
  instead of installing. 0.4.1 publishes `postinstall: node install/install.mjs
  --yes`.
- **`novahiz` finishes the setup itself when npm skipped the postinstall**: the
  first run of the CLI finds no `~/.config/novahiz/.novahiz-install.json`
  manifest and executes `install/install.mjs --yes` once before the command
  runs. `-v`, `--version`, `--help`, `-h` and `NOVAHIZ_AUTOINSTALL=0` skip the
  bootstrap; a repo checkout (outside `node_modules`) is never touched.

### Docs

- README quick start rewritten: the one-liner carries `--allow-scripts`, both
  fallbacks are listed, and the `ENOENT: package.json` trap of running the flag
  without a package name is called out.

## [0.4.0] - 2026-10-05

### Added

- **Zero-friction install for the community** - `providers.autoInstall` now
  defaults to `true` (the official skill packs impeccable, flutter, dart and
  expo install with `novahiz-install`, so gate rule R14 never blocks a fresh
  setup); Playwright MCP installs globally using the catalog pin instead of an
  on-demand npx download; the postinstall dry-run prints the exact next step;
  `files` ships `CHANGELOG.md` and `scripts/` so `npm run ci:local` works from
  the published package. Version 0.4.0 (breaking renames: plugin
  `novahiz-plugin.ts`, MCP `novahiz-<function>` ids).
- **clepsydre** - a local scheduling MCP server (`mcp/clepsydre`) written in
  this repository with zero npm dependency: 5-field cron expressions plus
  macros, `every Ns/Nm` intervals, one-shot ISO dates, IANA timezones, an
  atomic JSON store with a JSONL execution journal, and 14 `clepsydre_*` tools
  (CRUD, enable/disable, detached manual runs, history, schedule validation).
  Both MCP protocol eras are supported (`initialize` legacy and the 2026-07-28
  `server/discover` era). The stdio transport, protocol layer, parser,
  scheduler, and executors are original code — no third-party scheduler code
  is used or vendored.
- `clepsydre-mcp` bin entry in `package.json`; `mcp-clepsydre-probe` check in
  `novahiz doctor --deep`.
- `novahiz-gate` — the rule gate extracted from the core server into its own
  stdio MCP server (`mcp/novahiz-gate`, tool `novahiz_gate`, same `src/gate.ts`
  core as the CLI), with `mcp-gate` and `mcp-gate-probe` checks in
  `novahiz doctor` (the probe runs with `--deep`).

### Changed

- Plugin file renamed to the same `novahiz-<function>` convention:
  `adapters/opencode/novahiz.ts` → `novahiz-plugin.ts`, in the source tree and
  in `~/.config/opencode/plugins/` (installer scripts, doctor `adapter` check,
  tests, and docs follow).
- MCP server ids renamed to the `novahiz-<function>` convention:
  `lodestone` → `novahiz-search`, `clepsydre` → `novahiz-scheduler`, `argus` →
  `novahiz-scan`, `novahiz` → `novahiz-core`. Updated in
  `catalog/providers.json`, `opencode.jsonc`, the installer templates, the
  plugin fallback and the docs; tool names (`lodestone_*`, `clepsydre_*`,
  `novahiz_*`) and file paths are unchanged.

- The external scheduler providers are replaced by the local `clepsydre`
  server: `opencode.jsonc` now launches `node mcp/clepsydre/index.mjs`
  instead of the former `mcp-cron` command, `catalog/providers.json` lists
  `clepsydre` (local, Apache-2.0) in place of the `cron` venv-clone entry,
  and the `cron_*` gate tools were renamed to their `clepsydre_*`
  equivalents across `src/spec.ts`, `install/lib.mjs`, the adapter, the
  configs, and `docs/CONFIGURATION.md`.
- `providers.disabled` defaults to `[]`: every bundled server now runs
  locally with no setup step.

### Removed

- The `cron` provider entry (third-party scheduler clone) and its
  documentation. Replaced by `clepsydre`; no third-party scheduler
  dependency remains. See `NOTICE.md` for provenance.
- The `security` provider (`security-mcp`) and every installation vector for
  it: the entry is gone from `catalog/providers.json`, and `install.mjs` /
  `bootstrap.mjs` keep an empty MCP install list while purging any trace of
  `security-mcp` or `mcp-cron` (shim and global package) on every run — never
  reinstall, per explicit user decision. `providers.disabled` in
  `novahiz.config.json` keeps the id out of the registry; the `audit` category
  stays served by `novahiz-scan`.

### Fixed

- **Default-path skill packs installed again** - `providers.autoInstall` runs
  `deps --install` on every fresh setup, which exposed a latent guard refusal:
  `refused unsafe token: *` on the `--skill *` commands of flutter-skills and
  dart-skills (expo and impeccable listed their skills explicitly and passed).
  `SAFE_TOKEN` in `src/exec.ts` now admits `*` with the rationale on the spot:
  cmd.exe does not glob and the POSIX branch spawns without a shell, so the
  glob reaches the skills CLI, which expands it. Verified 4/4 `ok`.
- **Audit 2026-09-25 follow-up — every P0→P3 finding resolved in one batch.**
  - **P0 (secret exposure)** — the Stitch API key left `opencode.jsonc`: the
    header now references `{env:NOVAHIZ_STITCH_API_KEY}` and the value lives in
    the user environment (never logged, never printed). Rotating the key in the
    Google Cloud console is the one manual step remaining.
  - **P1 (gate hardening)** — the CLI accepts `--tools` (the plugin passes its
    frozen snapshot, so a live `gate.tools` edit cannot weaken enforcement
    before the required restart) and `--prompt` (the last prompt seeds the
    tier); it classifies the seed itself when `--categories` is empty instead
    of evaluating unscoped, failing closed only when classification breaks.
    The MCP gate follows: tool case normalized, DB-recorded skills unioned
    like the CLI, warn/audit mode reports `wouldBlock` instead of blocking
    silently, and only block mode fails closed on DB errors.
  - **P2 (robustness)** — the plugin runner is async: a CLI/MCP call can no
    longer freeze OpenCode's event loop for up to 30 s, and a deterministic
    timeout flag replaced the status/signal heuristic. `novahiz-scan` joined
    the hard-coded MCP fallbacks and every catalog server registers with a
    structured 120 s timeout. `snap_restore` and `clepsydre_enable_task` joined
    `gate.tools` across all six copies; R8 covers the docs tree,
    README/CHANGELOG and docs-writing prompts; R13/R14 skip sub-200-char
    touch-ups (`minChange: 200`; the doctor's operational probe now carries a
    real CSS payload and asserts the trivial case stays allowed); classify's
    lite tier only advertises skills the gate enforces; the inline gate-repair
    text gained its step 3; `writeState` writes through a temp file + rename;
    the dirty-path marker rejects cross-drive absolute paths; prompt text is
    no longer logged (language + size only); doctor flags missing script
    arguments (R1) and version-drifted installed copies (R6).
  - **P3 (hygiene)** — purged 63 `*.novahiz-bak`/`*.pre-v2` files, the stale
    `opencode.jsonc.bak`, and the dead `mcp-cron`/`security-mcp` global shims
    (with two orphaned `mcp-cron` processes); repaired three memory slots
    (addendum heading, duplicated review block, comma-split tags).
