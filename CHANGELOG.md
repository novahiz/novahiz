# Changelog

All notable changes to Novahiz are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Verified after a restart

- **Documentation no longer inherits design requirements.** Editing this
  CHANGELOG asks for `novahiz-docs` (rule R8, matched on the path) and nothing
  else, even with design vocabulary in the content. Before the seed fix, the
  same edit demanded eleven design skills because the changelog's own prose was
  being classified as the task. Boundary, stated on purpose: `PRODUCT.md` and
  `DESIGN.md` are not in the documentation set — they are the design brief, so
  design rules may apply there.
- **The seed rule lives in one place.** The MCP gate server kept its own copy
  and still classified documentation from its prose after the CLI was fixed
  (measured: `novahiz_gate` on `CHANGELOG.md` returned thirteen required skills).
  Both now call `src/seed.ts`, and a static test fails if the MCP copy comes back.
- **The gate records the project of the edited file, not its own cwd.** The
  plugin daemon's cwd is the directory opencode started from — the user home —
  so every project under it collapsed into one key (`c:\users\tawhid`), and two
  unrelated projects could be reported as conflicting. `projectRootForPath`
  walks up to the nearest `.git` or `package.json`. Verified by calling the gate
  from the Novahiz home on a file in `booking-website`: the row recorded
  `…\documents\booking-website`.
- **The end-of-session hook listened for an event this harness never emits.**
  The trigger was `session.idle`; the event log (one line per distinct type,
  added for exactly this question) lists 41 real types and that name is not
  among them. The trace never fired because the name did not exist. The trigger
  is now `session.execution.succeeded`, observed at the end of a run;
  `session.idle` stays as a secondary trigger for harnesses that do emit it. The
  CLI throttles per session, so a double trigger costs one process at most every
  ten minutes. A static test fails if the trigger stops being a real event.

### Fixed

- **`novahiz commit --files <dir>` no longer reports its own commit as an
  intrusion.** A directory argument legitimately pulls in everything under it,
  but the verification compared the commit against the literal arguments, so
  `--files wireframes/controle-de-theme` committed two files and then called
  them "not requested" (measured 2026-10-29: exit 1 on a commit that was
  correct). Directory arguments are expanded before the check.
- **A dismissed proposal stays dismissed.** `improve scan` re-created it on
  every run, which makes the advisor noise and a noisy advisor gets ignored. A
  dismissal is now permanent until `improve reopen` says otherwise; a *rejected*
  proposal (the apply failed) comes back after seven days, because the
  observation may still be right. Measured on the dismissed `fail` fixture:
  scan now reports `count: 0` instead of resurrecting it.
- **A documentation file is no longer classified from its own prose.** Measured
  on 2026-10-29: a one-line edit to `novahiz/CHANGELOG.md` demanded 11 design
  skills (`R8` + `R11` + `R13` + `R14` + `R17`), because the changelog talks
  about design skills and its content was used as the classification seed. For
  a documentation path (`novahiz-docs/**`, `docs/**`, `README.md`,
  `CHANGELOG.md`) the seed is now the prompt or nothing, never the prose; the
  path rule `R8-docs` still applies. A wireframe is deliberately *not* in that
  list: `wireframes/**` is design material, so its content may speak, and the
  full design set still blocks there. Both behaviours verified side by side on
  the real catalog.
- **The gate now records the project session where it always runs.** Only the
  MCP gate server wrote `project_sessions`, and the plugin path — the normal one
  — never goes through that server. Measured on 2026-10-29: the table was empty
  for a project with live sessions, so `resume` reported `session: null`,
  `otherSessions: []` and `defaultSessionForProject` could never resolve.
  Recording now happens in `commandGate`, in the connection the ledger checks
  already open, and it never decides a verdict (best effort, fail-open).
  Covered by a spawn test that asserts the row exists after a real gate call.

### Added

- **Verifications carry a session, so telemetry can attribute them.**
  `novahiz verify` and `novahiz docs verify` resolve the live session on the
  project instead of writing `session_id: null`. With two sessions on the same
  project they refuse to choose and say why — `attribution: { session: null,
  reason: "2 sessions vivantes…" }` — because guessing would attribute a proof
  to the wrong agent. Measured: an explicit `--session` run moved
  `improve evidence` from `concluded: 0` to `concluded: 1` for the skills loaded
  in that session, which is the whole point of the correlation.
- **`novahiz improve evidence`** — per skill, the sessions where it was loaded
  and what followed: a green verification, a red one, or nothing. Labelled a
  correlation, not a measure of the skill's prose, and refuses to conclude under
  five sessions. Measured on the live ledger: 18 skills, all `unproven` — the
  verifications recorded so far belong to CLI runs without a session id, so
  nothing could be attributed. That limitation is the report's own output, not a
  footnote.
- **`NOVAHIZ_AUTOIMPROVE=off`** — one environment variable stops `improve scan`,
  `improve apply` and `repair --apply`, in the CLI and over MCP. Reading the list
  of proposals stays available: a disabled system can still be audited.
- **The end-of-session trace lands in the project, or nowhere.** The spawn used
  `process.cwd()`, which for the plugin is where opencode started — a line was
  written to `C:\Users\Tawhid\.novahiz\session-end.jsonl` instead of the project.
  The directory now comes from the event envelope, then from this session's
  `session.created` (`data.location.directory`, the only event carrying it per
  the V2 schema), then from the context; with none of them the trace is skipped.
  The trace also rotates: beyond 500 lines it keeps the newest 400.
- **`novahiz backup restore --rebuild`** — `dist/` is rebuilt from the restored
  sources with the local compiler (no shell), because a restore that leaves a
  newer build next to older sources is a half-restore. `needsRebuild` is still
  reported when the flag is absent.
- **`novahiz manifest sync --origin package [--from <dir>]`** — records the bytes
  of the package that was installed, not the state of the tree they landed in.
  It refuses when the source is the home itself, since on a source checkout the
  package and the working tree are the same thing and the manifest would call
  today's edits "native".
- **Exit code 3 means "measurement impossible".** A verification command that
  cannot reach what it measures (a paused database, a dead network path) used to
  be indistinguishable from a false claim: both came back as `failed`. It now
  returns `inconclusive: true`, `ok: false`, and exit 3 from `novahiz verify`,
  and `novahiz docs verify` reports it as `unknown` instead of counting it as a
  failure. Red keeps meaning "the document is wrong", never "the network
  blinked". Measured need: `verifier-catalogue` answered "Mesure impossible"
  during a transient failure and would have painted PRODUCT.md red.
- **End-of-session trace** (`second-memory suggest --record`, wired to
  `session.idle` in the plugin). One throttled line per session in
  `.novahiz/session-end.jsonl`: when the session ended, whether the project is
  bound, how many docs moved, how many slots were fresh. It is a record, not a
  write to the vault: deciding what survives stays a human act, and a wrong
  merge would be silent damage. Throttled to one line per session per 10 min so
  an often-idle editor does not produce a wall of duplicates.
- **`novahiz backup`** — versioned snapshots of the Novahiz home, verified by
  SHA-256. Three kinds: `native` (taken before any self-improvement, never
  pruned — it is the baseline), `auto-improve` (taken after a verified-good
  change, newest two kept), `pre-restore` (taken automatically before a restore,
  so a restore stays reversible). `verify` re-hashes every stored file;
  `restore` refuses to write when the snapshot fails its own check, and reports
  `needsRebuild` because `dist/` is rebuilt, never snapshotted.
- **`novahiz evolution append|list|verify`** — append-only registry of every
  change to the system, in `evolution/evolution.jsonl`. Each record carries its
  provenance (`native`, `learned`, `user`), a reason sentence, evidence ids and a
  rollback target. Records are hash-chained to the previous one: editing,
  reordering or deleting a line breaks the chain and `verify` says so.
- **`novahiz manifest sync|diff`** — baseline digests of the 278 system files.
  `diff` separates untouched, modified (`learned`/`user`), added and missing, so
  "is this native?" becomes a measurement instead of a memory. The first
  manifest is labelled `baseline`, not `native`: on a source checkout the home
  *is* the working tree, so the shipped bytes cannot be recovered from it.
- **`novahiz doctor` reports the safety net** — three rows: baseline drift,
  newest snapshot verification (must be green, and a `native` must exist), and
  registry chain integrity. All non-blocking: a missing backup is a warning, not
  a broken install.
- **`novahiz improve scan|list|show|dismiss|apply`** — Phase 1 of
  self-improvement, and it proposes rather than changes. Three measurable
  observations: sessions stuck in the fallback category (≥ 3), a required skill
  loaded in ≥ 3 sessions that produced neither an edit nor a proof afterwards,
  and the same verification failing ≥ 3 times. Proposals land in `proposals/`,
  one file each, deduplicated. `apply` accepts exactly one mechanical kind
  (`unused-skill` → advisory) and runs snapshot → patch → disk re-read → rollback
  on any doubt → registry entry. The proof is behavioural when the proposal kept
  its prompts: they are replayed through the real classifier and the real gate
  before and after, and any drift beyond the demoted skill itself rolls the file
  back. Without prompts it stays `structural` and says so. A category is never
  created automatically: it changes the whole classifier, so the proposal carries
  the required web naming check and stays unapplied. Budget: at most five new
  proposals per scan and one applied change per 24 h, so the registry stays
  readable and a regression stays attributable.
- **MCP tools for the safety net** — `novahiz_backup`, `novahiz_improve` and
  `novahiz_repair` are registered in `novahiz-tools` alongside the CLI, so an
  agent can snapshot, read proposals and run whitelisted repairs without
  shelling out. Restore and apply require `confirm` to equal the snapshot or
  proposal id: naming it is the act of having read it.
- **`novahiz repair [--apply]`** — Phase 3, on a closed whitelist: a missing or
  unreadable skills index (rebuilt by the same code path `novahiz sync` uses), a
  native baseline snapshot, and a baseline manifest. Read-only integrity of the
  ledger is reported, never "fixed". Every repair is re-checked afterwards, and
  a fix that ran but left the symptom says so instead of reporting success.
- **`novahiz docs verify`** — a documentation claim can carry the command that
  proves it: `- Le projet compile. <!-- verify: typecheck -->`, with an optional
  `expect="…"`. Each marker is replayed through `.novahiz/verify.json` and comes
  back `ok`, `failed` or `unknown`; a failure exits non-zero. This is what
  `SOURCES.md` ("5 low contrast pairs" that were measurement artefacts) and
  `PRODUCT.md` (a dark theme the stylesheet had removed) were missing.
- **`novahiz dev doctor`** — measures the development environment instead of
  guessing: which ports answer (and with what HTTP status), whether `.next`
  exists while a server runs (never purge it then), and whether `fonts.gstatic.com`
  is reachable. A font failure returns the exact `--webpack` fallback for the
  `next/font` + IPv6/DNS class of outage.
- **`novahiz secrets scan`** — scans `tmp/`, `logs/`, `.novahiz/evidence/`,
  `dev-server.log` and `.env.local` for passwords, bearer tokens, JWTs, API keys
  and connection strings. Output is masked; a finding exits non-zero so CI or a
  caller cannot ignore it.
- **`second-memory decisions`** — the open decisions in one table: lines from the
  bound branch's `decisions/` notes matching "reste ouvert", "à faire", "bloqué",
  "en attente"… Read-only; no note is rewritten.
- **`second-memory suggest`** — what would go to the vault at the end of a
  session: docs modified in the last 24 h, recent memory slots, and whether the
  project is bound at all. It computes; it never writes. The automatic
  end-of-session reminder is not wired to the harness yet, and this command does
  not pretend otherwise.
- **`second-memory status` reports the project binding** — the branch the project
  is linked to, the target folder, and an explicit "NON lié" with the command to
  fix it. It used to read the legacy global memory and report a binding it had
  never looked at.
- **Live-session detection per project.** `novahiz_task new` and `novahiz resume`
  now report `otherSessions` and a `worktreeHint`: a session counts as live when
  it left a task, a claimed path or recorded evidence in this project within the
  last 90 minutes. Two agents in one worktree cost a contaminated commit in this
  project's history; the tool now says so before the collision instead of after.
- **The gate tells the tools which session is working.** MCP tools never receive
  the OpenCode session id, so the tasks, proofs and claims they created were
  stored with `session_id = NULL` and escaped per-session accounting. Every gated
  call records `(project, session)`; `novahiz_task new`, `novahiz_step`,
  `novahiz_verify` and `novahiz_claim` fall back to it when the caller passes
  none. The lookup refuses to guess: two live sessions in the window means no
  default, only the candidate list.
- **`novahiz_skillpack` / `novahiz skillpack`** — a category's skills as a compact
  map: one line of purpose plus headings and bullet rules per skill, capped by a
  character budget. Enforced skills are described first, omissions are named, and
  the response lists what is already loaded for the session and what remains. It
  does not replace `skill()`: the gate still requires the real load. It answers
  "what is in this pack?" before paying 30–40k tokens to find out.
- **`novahiz_verify` / `novahiz verify`** — a proof is now something that ran.
  The tool executes a command declared by the project in `.novahiz/verify.json`
  (never an arbitrary shell), records the exit code, output tail, duration and a
  sha256 of command+output, and writes both a ledger row and
  `.novahiz/evidence/<stamp>-<name>.json`. `novahiz_evidence` lists them,
  scoped to the current project.
- **`novahiz_claim`** — a session reserves file paths; the gate refuses a path
  another live session holds. Claims expire (30 min default) and are scoped by
  project. This is the guard against two agents writing the same worktree.
- **`novahiz commit`** — commits only the named paths (`git commit -- <paths>`)
  and verifies afterwards that HEAD contains nothing else. `git commit` without
  a pathspec publishes whatever another session already staged; that is how an
  8-file commit turned into a 12-file one.
- **`novahiz resume`** — reloads loaded skills, classification, active task,
  open todos, claims and evidence in one call, for the restart case.
- **Plan journal (`plan_history`)** — every `add`, `insert`, `amend`, `drop`,
  `reorder`, `review`, `close` and `abandon` records its before/after snapshot;
  read it with `novahiz_task action="history"` or `novahiz task history`.
- **Memory entries can carry their proof** — `verify: <name>` in a slot, replayed
  by `memory_verify` / `novahiz memory verify` with an `ok` / `failed` /
  `unknown` verdict recorded as `last_verified` / `last_verdict`.
- **`novahiz init` writes `.novahiz/verify.json`** in every new project, with the
  detected `typecheck` / `test` / `lint` / `build` scripts. An existing file is
  never overwritten.

### Changed

- **The ledger contract is the tool's contract.** `size` (XS–XL) is accepted on
  `plan` / `todo` / `insert` / `amend`; `edit` and `verify` steps cannot close
  without a proof, and `evidence:<id>` is checked against the evidence table.
  A task no longer closes itself when its last todo is done: `close` is explicit
  and requires a proof (recorded as `closing_proof`). `status` reports
  `openTodos` and `readyToClose`.
- **Review cadence 10 edits / 5 todos** (was 3/2) in both `ledger.ts` and
  `spec.ts`, which had silently diverged.
- **`novahiz_step` is scoped to the project** instead of a shared `"default"`
  bucket, and its description now says when to call it.
- **A task opened with a `category` must record its roadmap steps before
  `close`.** Every non-optional step carrying `requireSkills` (the same ones the
  gate enforces) must appear in `roadmap_progress` for the task's project or
  session. A task opened without a category keeps the previous behaviour. This
  is what stops `critique`, `polish` and `a11y` from disappearing silently from
  a "finished" plan — where the catalog marks them enforced; a step flagged
  `optional` stays advisory, and the annotation below makes that visible.
- **Every roadmap step now says whether it is enforced or advisory.** `novahiz_roadmap`
  and `novahiz classify` annotate each step with `enforced` / `advisory` / `why`,
  using the gate's own rule (non-optional **and** carrying `requireSkills`). The
  ledger's close rule reads the same set, so what you see is what blocks.
- **The lite tier keeps domain skills.** It used to keep only `novahiz-implement`
  and `novahiz-converge`, so a "small" design change silently dropped wireframe,
  design tokens and the impeccable checks. Lite now skips only the skills that
  structure the work (plan, clarify, task, analyse) and the full accessibility
  audit (`novahiz-wcag-audit`); everything else a category enforces survives.
- **`design-ui` requires `impeccable-critique`, `impeccable-polish` and `a11y`.**
  They were flagged `optional`, so a task could close without ever running them.
  The 20+ stylistic impeccable commands stay advisory; the quality gates do not.
  `flutter` keeps its own policy (unchanged).

### Documentation

- **`ui-slop-remover`**: an explicit brief wins. When the owner asks for a fade,
  a purple accent or a centred hero on purpose, the pass judges execution
  (varied timing, intent, real copy) instead of forbidding the pattern.
- **`novahiz-browser`**: "never Chromium" was misleading — Edge is Chromium-based.
  The rule now bans launching `chrome.exe`/`chromium`, and a diagnostics section
  covers a server that never answers: port already in use, `next/font` failing on
  broken IPv6/DNS with the `--webpack` fallback, and the rule against purging
  `.next` while a dev server runs.
- **`design-token-pipeline`**: a CSS-first mode for projects that keep tokens as
  custom properties in `@theme` / `:root`, with the same three layers and without
  inventing DTCG files.
- **`novahiz-wireframe`**: a light path for an existing screen — update the one
  affected section and build it, without replaying `plan`/`screen`/`sections`/
  `review`. The scope of the change decides the path, not habit; a new screen
  still follows all eleven steps.
- **`wireframe plan` explains itself when it cannot classify.** With no class
  recognised it now returns `classification.needs` (supply the screen's purpose)
  and the words each class matches, instead of "default / nothing recognised".

### Fixed

- **The gate fails closed when its skill index is unreadable.** It used to drop
  every required skill from `effective`, answer `allow:true`, and still claim
  "all required skills are enforced". Three pre-existing tests were failing on
  that contradiction.
- **Session skills survive an active session.** The TTL compared
  `sessions.updated_at` (written only at classification) against the cutoff, so
  a session working more than four hours lost its recorded skills and looped on
  GATE RELOAD. The cutoff now uses the most recent of classification and skill
  load.
- **The declared `loaded` list is no longer trusted blindly.** Once a session has
  recorded skills, the database is authoritative; anything else is returned in
  `unverifiedLoaded` and does not satisfy the gate.
- **`SAFE_TABLES` is enforced by a test.** A table added to the schema but
  missing from the allowlist made `ensureColumn` throw on every `openDb`,
  taking down the gate, the ledger and memory at once. `npm test` now fails if
  the two lists diverge, in either direction.
- **`classify` no longer needs the database.** Persisting session state is a side
  effect; a broken ledger degraded classification into `exit 1`, which the
  plugin read as "gate unavailable" and blocked every tool — including the ones
  needed to repair it.
- **The gate daemon restarts itself.** Three consecutive infrastructure failures
  (`DB open failed`, `internal error`) make it exit so the plugin spawns a fresh
  process, instead of serving a stale module until OpenCode is restarted.
- **Reading a slot no longer drops fields it does not know.** `readSlot` and
  `scanSlots` rebuilt the metadata field by field and both forgot
  `verify` / `last_verified` / `last_verdict`; one builder now serves both.
- **Memory slots are checked against their format contract** — mandatory keys,
  a Résumé and a Détails section, a coherent `verify` / `last_verdict` pair.
  Reported by `novahiz memory status`, on `memory_get` and on write; never
  silently rewritten.
- **The session/skills coherence check exists in `doctor`** — it reported "no
  blocking anomaly" while the registry and the database disagreed.
- **Usage errors are no longer labelled `internal error`** in the MCP tools, and
  `done` on an unknown todo returns the valid ids.

## [0.11.9] - 2026-10-24

### Fixed

- **Serveurs MCP `dart` et `playwright` déclarés en échec au démarrage** - les
  deux entrées générées dans `opencode.jsonc` n'avaient aucun `timeout`, donc le
  harnais appliquait son défaut (~30 s). Le MCP `dart` mesure 4 à 30 s de
  démarrage à froid (bundle `dart_mcp_server`), et `playwright` passe par `npx`
  qui peut télécharger le paquet au premier lancement : les deux étaient coupés
  en pleine connexion et rapportés `mcp connect failed: Request timed out`.
  `novahiz-docs` reçoit aussi un `timeout` explicite par cohérence.
- **Pin Playwright désaligné** - `catalog/providers.json` et l'installateur
  épinglaient `@playwright/mcp@0.0.82` alors que le paquet publié et installé
  est `0.0.83`. Les deux sources pointent maintenant sur `0.0.83`.
- **Texte de gate faux sur l'exemption shell read-only** - l'injection annonçait
  que les commandes shell read-only sont exemptées, sans dire que tout `|`,
  `;`, `&`, `>`, backtick, retour ligne ou `$(...)` annule l'exemption. Un agent
  qui enchaînait `Get-ChildItem | Select-Object` se croyait face à un bug alors
  que la règle est délibérément conservatrice (`src/readonly.ts`). Le texte
  décrit maintenant la règle réelle : une seule commande, sans métacaractère,
  sinon on découpe en appels séparés.
- **`## [Unreleased]` dupliqué dans le CHANGELOG** - un second titre vide
  subsistait au milieu de l'historique 0.8.x et cassait le repérage de la
  section courante.

## [0.11.8] - 2026-10-23

### Removed

- **Support Linux et macOS retire** - Novahiz ne supporte plus que Windows.
  L'installation et les MCP ne sont plus testes ni documentes pour Linux ni
  macOS. La section d'installation du README ne couvre plus que Windows.

## [0.11.7] - 2026-10-23

### Fixed

- **MCP Novahiz ne fonctionnent pas sur Linux** - OpenCode (en mode GUI/Desktop) ne
  n'hérite pas du PATH du shell, donc `node` seul ne se résolvait pas pour les MCP
  locaux (`novahiz-core`, `novahiz-gate`, `novahiz-docs`, `novahiz-search`,
  `novahiz-scheduler`, `novahiz-scan`). L'installateur utilise maintenant le chemin
  absolu de `node` (`process.execPath`) et propage le `PATH` de l'installateur via
  `environment` à chaque MCP. Le MCP `dart` est omis si le Dart SDK n'est pas
  présent (`which dart` / `where dart`).

## [0.11.6] - 2026-10-23

### Fixed

- **Installer spawnSync arguments** - `spawnSync(...cmd, opts)` spread the
  command array into separate positional arguments, causing
  `ERR_INVALID_ARG_TYPE` on the options object during the catalog sync step
  of `novahiz setup`. All 5 call sites now use
  `spawnSync(cmd[0], cmd.slice(1), opts)`.

## [0.11.5] - 2026-10-23

### Fixed

- **`novahiz setup` now completes on Linux with Node builds lacking TypeScript support** - `runSync()` and the installer spawned `home/src/cli.ts` directly, which fails with `ERR_UNKNOWN_FILE_EXTENSION` / `ERR_NO_TYPESCRIPT` on Node builds without TypeScript compiled in (e.g. Debian/Ubuntu Node 24.19.0). `runSync()` and all installer spawn sites now prefer `home/dist/cli.js` (JS compiled, present in the published package and copied into the home by the installer via `CORE_ITEMS`) and fall back to `src/cli.ts` with `--experimental-strip-types` only when `dist` is missing. `"dist"` was added to `CORE_ITEMS` so the file is copied into the home on every install.

## [0.11.4] - 2026-10-22

### Fixed

- **`novahiz setup` now completes on Linux** - `runSync()` executed
  `home/src/cli.ts` directly with Node, which cannot read TypeScript
  without `--experimental-strip-types`. On a fresh global install the home
  has no `dist/` build, so the sync step failed with
  `ERR_UNKNOWN_FILE_EXTENSION`. The flag is now added so the two-pass
  install (core then extras) completes on Linux, macOS and Windows.

## [0.11.3] - 2026-10-22

### Fixed

- **`--clean` now sees the files an older version left behind** - the install
  manifest never recorded what earlier installers had copied, so a home
  upgraded across several versions kept dead entry points (`install/bootstrap.mjs`,
  `install/install.sh`, `install/install.ps1`, `bin/veille-mensuelle.ps1`) that
  `--clean` could not detect. `install/retired.json` now lists them with the
  sha256 of the published content, line endings normalised to LF, and cleanup
  removes an entry only when the file on disk still matches that fingerprint.
  A file edited by hand no longer matches, comes back as kept, and is never
  deleted. The inventory is read from the package, never from the home, so an
  installation cannot widen the list of what it erases.

## [0.11.2] - 2026-10-22

### Fixed

- **The 0.11.1 entry-point test no longer fails on Node 22.18** - it demanded a
  completely empty stderr, but the CLI imports `node:sqlite`, which emits a
  legitimate `ExperimentalWarning` on that line. The test now rejects only the
  `DEBUG` line the release removed, and passes on Node 22.18.0 and Node 24.

## [0.11.1] - 2026-10-22

### Fixed

- **`novahiz` no longer writes a debug line on every call** - 0.11.0 shipped
  `bin/novahiz.mjs` with a leftover `console.error("DEBUG", ...)` that printed
  the absolute home path and the auto-install state to stderr on each
  invocation. The line is gone, and `tests/bin-entrypoint.test.ts` fails from
  now on if the published entry point writes anything to stderr for
  `--version`.

## [0.11.0] - 2026-10-22

### Changed

- **`npm install -g novahiz` is the whole install instruction** - the installer
  now has two modes and two moments. `--core` is the local half: home, skills,
  plugin, agent, commands, config, catalog. No network, no `sudo`, so it is safe
  from a postinstall, a CI job or an agent with no terminal. `--extras` is the
  network/system half (providers and toolchain, global MCP servers, docs index
  seed, Obsidian vault, npm refresh) and is replayed at the first real `novahiz`
  call. Without a flag the installer still does everything in one pass, so
  `novahiz-install` keeps its historical behaviour.
- **The first `novahiz` run finishes the setup** - npm 11.16+ blocks install
  scripts unless `allowScripts` covers the package, and a global install has no
  `package.json` to record that approval in. `bin/novahiz.mjs` therefore runs
  `--core` when no manifest exists, then `--extras` in the same invocation, and
  clears `extrasPending`. `NOVAHIZ_NO_EXTRAS=1` and `NOVAHIZ_AUTOINSTALL=0`
  remain the opt-outs.
- **Linux and macOS compatibility** - `which()` and `commandExists()` scan
  `PATH` (plus `PATHEXT` on Windows) instead of spawning `which`/`where`, which
  Debian minimal and Alpine do not ship. The opencode `shell` setting follows
  `$SHELL` on macOS/Linux (zsh by default on macOS) instead of hardcoding
  `bash`, and keeps the `pwsh`/`powershell` probe on Windows. CI gains an
  `install` job that runs the core installer and the resulting CLI on ubuntu,
  macos and windows.
- **Nothing privileged is executed any more** - the core toolchain bootstrap no
  longer spawns `sudo apt-get install` or `sh -c "curl … | sh"`. Both are
  printed as the exact manual command (`manual core python - run: …`), so a CI
  job or an agent can no longer hang on a password prompt. `brew` and `winget`
  (structured argv, no privilege escalation) stay executable.

### Removed

- **Four redundant entry points** - `install/bootstrap.mjs`,
  `install/install.sh`, `install/install.ps1` and `bin/veille-mensuelle.ps1`,
  together with the `novahiz-bootstrap` bin and the `bootstrap` / `bootstrap:dry`
  scripts. `novahiz-install` is the single installer; `npm run setup:core` and
  `npm run setup:extras` cover the two modes.

### Fixed

- **`novahiz --version` printed the usage** - the `command === undefined` branch
  ran before the `--version` flag check.

## [0.10.0] - 2026-10-22

### Fixed

- **The gate and the injected block now agree on the pipeline** - `R6-Novahiz`
  required plan/clarify/analyse/implement/converge on every workflow prompt,
  while the roadmap loop only enforced `kind: "skill"`. A lite or Flutter task
  could therefore announce nothing (or five skills) and be blocked for seven.
  `R6` is removed and every non-optional roadmap step that carries
  `requireSkills` is enforced, whatever its kind (`skill`, `edit`, `verify`,
  `advisory`). `R10-security` is removed too: the audit roadmap already names
  `novahiz-security`. `R11-accessibility` is narrowed to `design-ui`. The
  catalogue now holds 13 rules instead of 15.
- **A trivial follow-up no longer disarms the gate** - the plugin kept the
  classification in memory only. `continue` / `ok`, or a plugin restart, fell
  back to `general/trivial` and the gate allowed every edit with `missing: []`.
  The last non-trivial classification is now persisted in the `sessions` table
  (schema v3 adds the `prompt` and `tier` columns), `classify --session`
  returns the effective classification, and the gate CLI reads that state from
  the database when categories and prompt are empty.
- **`doctor` reports a schema mismatch** - the schema check hardcoded
  `ok: true`; it now compares `PRAGMA user_version` with `SCHEMA_VERSION`.
- **The gate no longer blocks provably read-only shell commands** -
  `git status`, `git log`, `git diff`, `ls`, `Get-Content` and their
  equivalents are exempt (`src/readonly.ts`). The gate used to ask for the
  design skills before it would let an agent read a file.
- **French UI prompts are no longer fail-open** - `ajoute` / `ajouter` now
  score as lite and `implémente` as full, so a French additive request reaches
  the pipeline instead of falling through to trivial. `design-ui` recognises
  `bouton`, `écran`, `connexion`, `formulaire`, `menu`, `champ`, `icône`,
  `carte`, `modal`, `header`, `sidebar` and their English forms. Numeric
  micro-changes (`ajoute 8px de marge`) stay trivial, and debug words
  (`bug`, `error`, `crash`, ...) subtract from `design-ui` so
  `fix the login bug` stays in `debug` instead of dragging the design pipeline
  into a fix.

### Changed

- The gate CLI falls back to the persisted session state when the caller
  passes no categories and no prompt, instead of letting the decision rest on
  an empty classification.
- The plugin asks `classify --session` and, for a trivial continuation,
  inherits the previous task's prompt so the tier does not drop back to
  trivial mid-task.

### Added

- **Session state persistence** - `src/session.ts` stores the categories, tier
  and prompt of the last non-trivial task, with a TTL that keeps a stale
  session from being mistaken for a continuation.
- **A read-only allowlist for the gate** - `src/readonly.ts` lists the shell
  commands the gate can prove do not write.
- **The `novahiz-capture` skill** - reliable screenshot capture for the
  physical Playwright browser, when a plain capture comes back stale, blank
  or cropped.
- **Three test files** - `tests/session-state.test.ts`, `tests/readonly.test.ts`
  and `tests/gate-alignment.test.ts` pin the session state, the read-only
  exemption and the alignment between the classifier and the gate.

## [0.9.9] - 2026-10-16

### Changed

- **`novahiz upgrade --apply` now finishes the job it started** - it stopped at
  `npm install -g novahiz@latest`, which refreshes the global package and
  nothing else: `~/.config/novahiz`, the plugin copy and the MCP entrypoints
  stayed on the previous version. It now resyncs the whole installation from
  the fresh package (`install.mjs --yes --clean`) on both channels, so
  `novahiz update` behaves exactly the same. If the update or the resync
  fails, the command stops and reports the error instead of announcing a
  completed upgrade.

### Added

- **A cleanup of the previous installation, opt-in** - an update used to leave
  behind whatever it no longer shipped: a renamed skill stayed loadable, a
  removed plugin stayed registered. `install.mjs --clean` now removes the files
  a previous install wrote whose source has disappeared. The only proof of
  ownership is the install manifest (`.novahiz-install.json`, field `created`):
  a skill or a command placed by a pack is not in it, so it cannot be removed.
  The rule "absent from the source" was the tempting one and it is wrong here —
  it would have deleted `impeccable`, which the pack keeps in
  `~/.agents/skills`. Three guards hold: only files under the four installed
  roots, never after a failed step, never without `--clean`. A `.novahiz-bak`
  goes with the file it backed up and never alone. `novahiz.config.json`,
  `project-memory/` and `novahiz.sqlite` sit outside those roots, untouched by
  construction.

### Fixed

- **`pruneEmptyDirs` never removed anything** - it called
  `rmSync(dir, { recursive: false })`, which throws `ERR_FS_EISDIR` on a
  directory, and the surrounding `catch` swallowed the error. The function
  looked like it worked and silently left every emptied directory behind, for
  `novahiz uninstall` as well. It now uses `recursive: true`, which is safe
  because the directory is already known to be empty.

## [0.9.8] - 2026-10-15

### Removed

- **The 7 `eas-*` skills from the catalogue** - `test` and `devops` listed them
  as `defaultSkills` (`eas-app-stores`, `eas-hosting`, `eas-observe`,
  `eas-simulator`, `eas-update`, `eas-update-insights`, `eas-workflows`) while
  the expo pack deliberately excludes them: `providers.json` says so in the
  provider's own purpose. No provider could install a single one, so `doctor`
  named them and `novahiz deps --install` returned `install: []`. 0.9.5 made
  that row tell the truth instead of blaming the reader; the references
  themselves stayed, and the row reports without blocking, which is why nothing
  had failed since. `referencedSkills` now spans 51 ids and none of them is
  undeliverable, so `doctor` reports `51 present` with no caveat. The seven
  inert `overrides.json` entries went with them; the `devops` keywords `eas`,
  `eas build` and `eas update` stay, since they route a deployment question to
  a roadmap that still applies.

### Added

- **A test holding the catalogue to that invariant** -
  `undeliverableReferences(spec, packageRootDir)` is exported from
  `doctor.ts`, and `tests/doctor-referenced-skills.test.ts` runs it against the
  shipped catalogue: it must return `[]`, no `defaultSkills` may carry an
  `eas-*`, and a reintroduced one must be named. Checked by injection: putting
  `eas-simulator` back into `test.defaultSkills` turns both assertions red.

## [0.9.7] - 2026-10-15

### Added

- **Project docs mirrored into the vault** - `novahiz init` now fills the
  `<Domain>/<Branch>/docs/<slug>/` folder it creates instead of leaving it
  empty: a new `Obsidian project docs` step copies `ARCHITECTURE.md`,
  `CONVENTIONS.md`, `DECISIONS.md` and `STANDARDS.md` verbatim from
  `novahiz-docs/`, and `novahiz autodocs --flush` re-mirrors them on every
  flush, reported as a `Vault` row. The folder previously appeared holding only
  a `_MOC.md` - the `docs` leaf of the catalogue existed and nothing ever wrote
  into it. The copy is a **mirror, never the source**: every note reflects a
  file that still lives in the project, which is what makes an overwriting flush
  safe instead of a second history to maintain. Guards, none silent: no
  `vault.json` binding, a binding outside the catalogue, or a target folder
  `project-init` never created all skip with advice and invent nothing (contract
  1); a doc file absent from the project is reported as `absent`, never
  manufactured; a dry-run writes neither note nor log entry. Each real write
  appends one `- HH:MM -` line under the day's heading of `log.md` through
  `appendLogLine` - contract 8's "log the operation" was an instruction for the
  agent and not code, so it only happened when someone remembered it. The
  project name now resolves through a single `readProjectName` helper shared by
  `init` and `flush`, so the seed and the refresh cannot slugify to different
  folders.

## [0.9.6] - 2026-10-15

### Added

- **`PRODUCT.md` and `DESIGN.md`** - the product context and the visual-system
  record `impeccable` asks for, both written from sources in the repository
  (`README.md`, `docs/CONSTITUTION.md`, `src/render.ts`) with anything they do
  not settle marked "not determined" instead of guessed. `novahiz doctor` runs
  from a project now finds both instead of two `fail` rows; when doctor runs
  from the Novahiz home both rows are skipped by design
  (`impeccableChecks` returns early when `cwd === home`).

- **`when.pathExcludes`** - a rule-level *negative* selector, the counterpart of
  `pathGlobs`. A rule carrying it never applies to a matching path, whatever the
  other selectors say. With `match: "any"` a prompt category alone fired on any
  file, so `design-ui` demanded the frontend design skills on unit tests, and
  inclusion-only selectors could not express "never on tests" (`**/*.tsx` also
  matches `tests/Foo.test.tsx`). Applied to the five design-scoped rules
  (R11-accessibility, R13-design-craft, R14-impeccable, R16-stitch-fidelity,
  R17-wireframe), which now skip `**/tests/**`, `**/__tests__/**`,
  `**/*.test.*` and `**/*.spec.*`. R9-code-review and R10-security are
  untouched — a test is still code — and R15-token-economy keeps its own
  `**/tests/token-economy.test.ts` target.

### Changed

- **The installer states its own limit** - `install.mjs` now prints that
  `deps --install` is an install-only pass: packs already present are left
  untouched, and `/novahiz-skills-update` (`deps --install --update`) is what
  refreshes them. Installation and update stay separate commands by choice — a
  reinstall must not overwrite local skill edits — but the choice was previously
  only written down in `docs/PROVIDERS.md`, not shown to the person installing.

### Fixed

- **`doctor` no longer advises a command that cannot help** - the "Referenced
  skills" row counted every absent non-shipped skill as a pack skill and
  answered "run /novahiz-skills-update, or novahiz deps --install". Measured on
  the 0.9.5 install: the 7 skills it named are `eas-app-stores`, `eas-hosting`,
  `eas-observe`, `eas-simulator`, `eas-update`, `eas-update-insights`,
  `eas-workflows`, referenced as `defaultSkills` by the `test` and `devops`
  categories, while `catalog/providers.json` ships four skill packs only
  (`flutter-skills`, `dart-skills`, `expo-skills`, `impeccable`) and the expo
  command names 20 `expo-*` skills, no `eas-*`. `deps --install` accordingly
  returned `install: []` and exited 0 - nothing to install. The row now reads
  each pack's `install` argv (`--skill` list, or `--skill *` resolved to the
  repo's leading segment, so `dart-lang/skills` covers `dart-*`), and skills no
  pack can deliver are named as such instead of being sent after a command that
  installs nothing. New `tests/doctor-referenced-skills.test.ts` pins the
  contract - eight cases, none existed before.

## [0.9.5] - 2026-10-15

> 0.9.4 was prepared on 2026-10-14 but never tagged nor published to npm
> (the registry went straight from 0.9.3 to 0.9.5). Its changes are included
> here and remain described under their own heading below.

### Added

- **Wireframe-first design pipeline** - new `novahiz_wireframe` MCP tool and
  `src/wireframe.ts` module
  (`init/screen/section/sections/plan/review/index/attach/mark/status`).
  Each screen gets a subfolder of ordered, annotated sections plus a
  regenerated `INDEX.md`; `attach` returns the whole wireframe as the
  attachment block fed to `impeccable shape`. `sections` creates a whole
  batch in one call (one `INDEX` rebuild instead of one per section, existing
  names skipped); `plan` classifies the screen and says whether it needs
  several sections and why; `review` reports the sections that were
  forgotten and gates approval (`mark` refuses while `verdict != pass`).
  Sections are renumbered from the highest existing index instead of
  `length + 1`. Gate rule `R17-wireframe` and the `wireframe` roadmap step
  (before `impeccable-shape`) make the sequence mandatory on `design-ui`
  work and on screen/page/component paths. New skill `novahiz-wireframe`,
  tested by `tests/wireframe.test.ts`.
- **`novahiz deps` reports real dependency health** - the single provider
  check is replaced by a four-part `dependencyReport`: toolchain probing
  (node, npm, npx, uv, python), local MCP entrypoint `existsSync`, npm home
  health (declared deps resolved + lockfile present), and provider
  prerequisites. `novahiz_deps` returns the same shape.
- **Core toolchain bootstrap** - `deps --install` can now install `uv` and
  Python on win32 / darwin / linux. The argv lives in `src/deps.ts`
  (`coreBootstrap`), not in the catalog, and runs through a plain spawn:
  `runScript`'s allowlist deliberately refuses shells and package managers,
  so catalog data can never widen it. `--core-only` installs only toolchain
  and npm health; the installer uses it when providers are declined.
- **Idempotent provider installs** - a new `installedWhen` field on a
  provider lists skill ids whose combined presence marks the pack already
  installed; when all of them are on disk the install command is skipped, so
  a second `deps --install --yes` runs nothing. Providers without the field
  keep the historical always-run behaviour.
- **Gate rule `R18-skill-craft`** - `novahiz-skill-craft` is now actually
  required on any `SKILL.md` edit, matching what its own description
  already promised.
- **Skills `novahiz-prd` and `novahiz-skill-craft`** ship in the package.
- **Commands `novahiz-obsidian` and `novahiz-obsidian-audit`**, plus
  `bin/veille-mensuelle.ps1`.
- **A real refresh path for the provider skill packs** - `deps --install
  --update` and a per-provider `update` command in `catalog/providers.json`.
  `deps --install` drops every pack whose `installedWhen` markers are all on
  disk, so it could only fill gaps: `/novahiz-skills-update` called it and
  therefore refreshed nothing, which is why flutter/dart/expo were never
  actually updated. `updateCommands()` reads the provider's `update` command
  instead and applies no `installedWhen` gate. For the skills CLI that command
  is the upstream `skills update -g -y`, already present in the pinned
  `skills@1.7.0`. An identical argv shared by several providers is deduplicated
  and records the packs it covers under `covers`, in the dry-run plan and in
  the result, so a skipped pack can no longer be mistaken for an updated one.
  `/novahiz-skills-update` gained an explicit step 4 running it.
- **The Flutter skill pack is installed from its official repository** -
  `flutter/agent-plugins` is now recorded as `flutter/skills`, the name used by
  the Flutter blog post *Introducing Skills for Dart and Flutter*. The two
  resolve to the same repository (identical `main` HEAD `0ef3972` and branch
  list), so this is a provenance correction, not a source change.

### Fixed

- **`tests/plugin-warmstart.test.ts` failed `tsc --noEmit`** with three real
  type errors: the `editor` parameter shadowed the `editor` binding, making
  `typeof editor` self-referential (TS2502), and `await cleanup()` was called
  on the `void | Cleanup` union without a guard (TS2349, twice). The previous
  session reported this file as type-clean; that report was wrong.
- **`Agent harness copy outdated`** — the last non-blocking `doctor` failure —
  is repaired by `node install/install.mjs --yes` alone. Only the rewrite of
  `novahiz.config.json` is gated on `--force`; the plugin, agent and command
  copies are not, so a plain run refreshes them while the config reports
  `Existing config preserved`.

### Changed

- **`novahiz sync` is now listed in `--help`** - the command existed
  (`case "sync"` → `commandSync()`), and both `gate.ts:498` and
  `gate-repair.ts:87` pointed users at it, but it was missing from the help
  output.
- **The installer no longer backs up the published package inside its own
  home** - the home is a copy of what npm already holds, so preserving its
  previous version only accumulated `*.novahiz-bak` (235 of the 320 found by
  the audit). Backups are kept only where they carry something that exists
  nowhere else: `catalog/` (user-edited configuration) and the files written
  into the opencode config dir, which are exactly what `novahiz uninstall`
  restores (`uninstall.mjs:53`).
- **`scripts` is part of `CORE_ITEMS`** - `package.json` copied into the home
  declares `ci:local = node scripts/ci-local.mjs`, but the directory was
  never copied, so `npm run ci:local` failed there.
- **Windows PATH staleness is no longer reported as a missing dependency** -
  the parent process may predate the install (opencode started before uv or
  Python landed), so its inherited PATH hides binaries that ARE on disk.
  `toolchainStatus` reloads PATH from the registry (Machine + User) once and
  re-probes. `python` is probed with `--version` rather than `where python`,
  because the `WindowsApps` execution alias answers on machines without any
  Python.
- **The installer asks about providers by default** (`true` instead of
  `false`) and adds a `--no-deps-install` flag. Automatic dependency
  installation now defaults to on (`autoInstall !== false`); when providers
  are declined the toolchain and npm health still install, being system
  dependencies rather than optional providers.
- **`npm install` runs with `--ignore-scripts`** and `npm_config_global=false`,
  scoped to the Novahiz home, so nothing in the home re-enters the
  installer.

### Notes

- `novahiz deps` and the `novahiz_deps` tool change their JSON contract:
  `{node, platform, dependencies}` becomes
  `{node, platform, toolchain, dependencies, entrypoints, npm}`, and the
  dry-run `plan` becomes `{core, npm, bootstrap, install}`. Anything parsing
  the old shape must be updated.

## [0.9.4] - 2026-10-14

### Fixed

- **No absolute machine path is shipped any more** - the tree handed to every
  member of the community carried the drive letters, the folders and the
  account name of the machine Novahiz was developed on, so the system was
  broken on arrival for anyone else.
  - `adapters/opencode/instructions.md` (the system prompt injected into every
    session), `skills/novahiz-browser/SKILL.md` and
    `skills/browser-session/SKILL.md` pointed the Playwright profile at a
    hardcoded `C:\Users\<account>\.opencode\playwright-profile`. The profile
    rule was unusable and the browser profile wrong for every other user. All
    three now use `~/.opencode/playwright-profile`.
  - `docs/TOKENS.md`, `docs/audit-2026-09-25.md`,
    `mcp/argus/IMPLEMENTATION-SUMMARY.md` and
    `mcp/stitch-template/recommandation.md` presented absolute paths as
    instructions to run. They now use `~` or `<NOVAHIZ_HOME>`.
  - The placeholders shipped to the agent were corrupted:
    `node NNovahiz-home>/src/cli.ts classify "Nrequest>"` and
    `skill({ name: "Nskill>" })` in `adapters/opencode/agent/novahiz.md`. They
    are restored to `<Novahiz-home>`, `<request>` and `<skill>`, so the first
    step of the pipeline is executable as written.

- **Home resolution no longer yields a ghost home** - `src/cli.ts`,
  `src/commands/upgrade.ts` and `src/commands/second-memory.ts` built the home
  from `process.env.HOME || process.env.USERPROFILE || ""`. When both are
  absent - a Windows service, the gate daemon child, a container - the joined
  result was a path relative to the cwd, so `detectTarget`, `runSync` and the
  Stitch recommendation all operated silently on a directory that does not
  exist. All three now resolve through `NovahizHome()` or `homedir()`.

- **The C3 index guard fires on Windows** - `src/gate.ts` compared the
  protected `build/installed-skills.json` and `build/catalog.json` suffixes
  spelled with `/` against a path carrying the platform separator, so the guard
  never triggered on Windows. Those two files define what the gate requires and
  were editable like ordinary build output on the platform most of the
  community installs on. The path is now normalised before comparison.

- **The gate daemon stops flashing a console window on Windows** -
  `adapters/opencode/novahiz-plugin.ts` spawned it without `windowsHide: true`,
  the only spawn site in the file missing it.

- **Duplicated `NOVAHIZ_HOME` reads** in `src/spec.ts` and `install/lib.mjs`
  collapse into one canonical read. A user who exported the older variable name
  silently kept the default home while believing they had redirected it.

- **`novahiz doctor` stops failing at home root on project context** -
  `src/commands/doctor.ts` resolved `PRODUCT.md` and `DESIGN.md` against the
  novahiz home, producing two permanent rows no command could close. The rows
  are scoped to a project directory and remain unchanged inside one.

- **A plan that declares its dependencies by label no longer wedges** -
  `src/ledger.ts` resolved each dependency by todo id only, while
  `novahiz task plan` accepts labels ("T2", "P5"). Every label-declared
  dependency read as unfinished and blocked its dependent step for the whole
  life of the task. Resolution now accepts both, and fails closed on an
  unknown or ambiguous reference.

### Added

- **A persistent gate daemon** (`src/gate-daemon.ts`, wired in
  `adapters/opencode/novahiz-plugin.ts`) replaces one Node process spawn per
  gate call. Every request re-executes `commandGate`, which re-reads
  `rules.json`, `categories.json` and the skill index from disk, so no verdict
  can go stale; any daemon failure returns as `spawnError` and the existing
  deny path applies unchanged. Measured on this machine: one-shot median 331 ms
  against 8.1 ms warm.

### Changed

- **Portability is enforced by a test** - `tests/portability-paths.test.ts`
  fails the build on an absolute machine path, a machine account name, an MCP
  command the catalog cannot resolve to an absolute path, or a regression of
  the C3 guard. It ships a negative proof: an injected path makes it fail by
  file and line.

- **`.novahiz-install.json` and `novahiz.config.json` are no longer tracked** -
  the install manifest embedded the absolute paths and the account name of the
  machine that ran the installer, and was published with them. Both are
  machine-local state regenerated on demand, and are now ignored.

## [0.9.3] - 2026-10-11

### Changed

- **CI verifies the suite and the installer dry-run on Windows and macOS**
  — the matrix keeps the Ubuntu node grid (22 / 22.18.0 / 24) and adds one
  node-24 job each on `windows-latest` and `macos-latest` (5 jobs).
  Previously only Ubuntu ran in CI; Windows rested on local runs and macOS
  on nothing at all.

### Fixed

- **`install.sh` is executable in the package** — mode moved from 100644
  to 100755, so `./install/install.sh` no longer fails with permission
  denied on Linux/macOS.
- **macOS memory CLI test compares canonical paths** — `$TMPDIR` on macOS
  is a symlink (`/var` → `/private/var`); the first-ever macOS CI run
  caught `tests/memory-cli.test.ts` asserting the CLI's resolved root
  against a raw string. Both sides now go through `realpathSync`.

### Notes

- Cross-platform claims re-checked against primary sources: GitHub docs
  (matrix `include` adds non-mergeable combinations → 5 jobs, confirmed by
  the runs), npm docs (`--allow-scripts=novahiz` is the documented way to
  approve a global install; a package cannot self-authorize), Playwright
  docs (WebKit runs on all three OSes; Linux needs its system libraries).
  The README now carries the Linux remedy: `npx playwright install-deps
  webkit`.

## [0.9.2] - 2026-10-11

### Fixed

- **Memory root lock: no more silent marker loss under contention** — a
  transient `EPERM`/`EBUSY` when reading `.lock` (Windows filter driver
  under I/O load) was indistinguishable from "absent", so a waiter could
  delete the lock of a **live** holder: two critical sections, one
  read-modify-write clobbered, one marker lost while both writers exited 0.
  `readLock` is now tri-state (`ok` / `absent` / `unreadable`); a steal
  requires a confirmed stale lock (dead pid or age) plus an immediate
  re-read (closes the TOCTOU window); a torn file left by a crash is
  detected via `mtime > LOCK_STALE_MS` and only then removed.
- **`acquireRootLock` no longer crashes on transient create errors** — the
  same `EPERM` on the `wx` create (reproduced: 2 crashes in 40 rounds
  under 6 CPU burners) now retries with the existing deadline and ends in
  a loud `E_LOCK` instead of killing the caller.

### Notes

- Proven under load: 60/60 stress rounds clean after the fix (2/40 rounds
  crashed before). Two new deterministic tests (torn + fresh mtime →
  `E_LOCK` with the foreign lock intact; torn + old mtime → stolen).
  Suite 613 tests / 612 pass / 0 fail; CI green on Windows and Linux.

## [0.9.1] - 2026-10-10

### Fixed

- **Fresh-install scan stops reporting missing skill roots** — the default
  `skillRoots` include `~/.agents/skills`, which most profiles do not have.
  The first `sync` (run by the installer) used to surface it as a scan error
  on every new machine; a declared root that does not exist yet now simply
  contributes nothing (`scanErrors: []`).
- **README install banner aligned with the shipped version** (0.8.0 → 0.9.0).

### Notes

- The npm installer path is verified end-to-end on npm 12.2: install with the
  `postinstall` blocked by `allowScripts`, first `novahiz` run finishes the
  setup itself (auto-install, `NOVAHIZ_AUTOINSTALL=0` to opt out), second run
  clean. `novahiz doctor` exits 0 on the fresh sandbox.

## [0.9.0] - 2026-10-10

### Added

- **`second-memory project-init`** — gives a new project its vault folders
  (`docs/journal/decisions/<project>/`, each with a real `_MOC.md`, never
  `memory/`) and binds the project to its branch. Dry-run by default,
  `--branch Domain/Branch` validates against the catalog, idempotent, and
  `--apply` writes the `vault.json` binding (slug → domain/branch) in the
  memory root.
- **`novahiz init` Obsidian step** — when a vault exists and the project has
  a name, init creates the project's folders through the same logic; no
  vault, no name or no branch signal means the step skips with an advice and
  never invents a folder. Honors `--dry-run`.
- **`journal` and `decisions` leaves** in `catalog/vault-structure.json` for
  every `memory|docs` branch (19 branches, 38 leaves), with root
  `journalKeywords` / `decisionsKeywords`. `routePath` resolves the leaf
  `decisions` > `journal` > `docs` > `memory`, and the project level extends
  to the new leaves.
- **Project binding in `routePath`** — a note carrying a `project:` bound by
  `project-init` lands in the project's branch whatever the keywords say;
  stale or missing bindings fall back to the historic keyword routing.

### Changed

- **`second-memory sync` is archive-only** — project memory stays local
  (`MEMORY.md` + `project-memory/` slots); the bidirectional slot ↔ vault
  mirror (pull / push / rebuild, last-writer-wins) is retired. `sync` now
  lists (dry-run) and archives (`--apply`, backed up under `Archive/.backup`)
  the notes the old mirror generated (`novahiz_slot_id`), while keeping the
  opt-in inverse import (`novahiz_slot_sync: true` → slot in local memory).
  `status` / `doctor` report the leftovers as `project-memory note(s) in the
  vault`.
- **Skills and instructions follow** — `novahiz-memory` / `memory` are
  local-only (no vault write, no routing table); `novahiz-second-memory`
  documents the new leaves, `project-init`, the binding and the archive-only
  sync; `instructions.md` adds the local-memory rule and the
  no-speculative-folders rule.

### Removed

- Mirror helpers and constants of the retired sync (`renderSlotNote`,
  `slotBody`, `parseIso`, `SYNC_TOLERANCE_MS`, and the `readIndex` usage in
  sync).

## [0.8.2] - 2026-10-10

### Fixed

- **In-place `npm install -g novahiz` now keeps the new package instead of
  silently restoring the previous one** (`install/install.mjs`): the
  `Finalize` step spawned `npm outdated` / `npm update` from inside npm's own
  `postinstall` to refresh dependencies. npm exports its config to lifecycle
  scripts (`npm_config_*`, `envExport` default true), so the inherited
  `npm_config_global=true` from the outer `npm install -g` turned that refresh
  into a **second reify of the same global prefix while npm's transaction was
  still open**. Its retire of `node_modules\novahiz` fails with `EBUSY` (the
  installer's cwd *is* the package directory), the nested npm crashes, and
  arborist's rollback runs `rm(new)` + `rename(.novahiz-OLD → novahiz)` —
  the previous install comes back byte-for-byte with its original mtimes
  while the outer npm reports exit 0 / "changed 1 package". The refresh is now
  pinned to the novahiz home (`npm_config_global=false`, `--ignore-scripts`),
  a directory the outer transaction never touches. This was the actual cause
  of "the in-place install does not replace": it reproduces with **no OpenCode
  restart at all** (proved end-to-end 2026-10-10, see tests below).

- **The npm postinstall no longer writes the opencode config while npm is
  still mid-transaction** (`install/install.mjs`, `install/lib.mjs`): a second,
  independent failure mode — running `npm install -g novahiz` from an
  OpenCode-owned shell restarted the OpenCode server during `postinstall`, and
  the restart killed the process tree with npm still inside its reify
  transaction. Depending on where the kill landed, the update either left
  orphaned `.novahiz-*` retire directories and shims behind or aborted the
  configuration pass. The installer now splits in two: the synchronous pass
  only touches `NOVAHIZ_HOME` (the only zone never observed as the restart
  trigger across three reproduced kills), while everything that writes the
  OpenCode config — skills, plugin, agent, commands, `opencode.jsonc`,
  provider skill packs — runs in a detached process that waits for the
  installer and npm to exit first (`--deferred-opencode`, log:
  `<novahiz-home>/install-deferred.log`). That child is spawned with
  `cwd=novahiz-home` so it can never hold the package directory open (a
  process whose cwd sits in `node_modules\novahiz` is what makes any npm
  retire of it fail with `EBUSY` on Windows). Direct runs (`novahiz-install`,
  CLI bootstrap) keep the historical fully synchronous behaviour, and
  `--sync` forces that behaviour back under npm as an escape hatch.
  Regression tests: `tests/install-defer.test.ts`.

## [0.8.1] - 2026-10-10

Patch: `novahiz upgrade` always reported "up to date" on the npm channel.

### Fixed

- **`novahiz upgrade` reads the published version again**
  (`src/commands/upgrade.ts`): the `npm view` call ran with `stdio: "ignore"`,
  which makes `spawnSync` return `stdout: null` — `latest` was always empty,
  `compareVersions(local, "")` always won, and the command printed
  `up to date (npm latest: )` even when a newer release existed, so `--apply`
  could never trigger. The call now captures stdout (`"pipe"`), with a
  regression test spawning `npm --version` locally (no network). Inherited
  since 0.7.1.

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
