# CLI Reference

Novahiz exposes a single CLI entry point. All commands return JSON when invoked programmatically.

## Core commands

### `Novahiz init`

One-shot setup: copies core, builds catalog, installs skills.

```bash
Novahiz init
```

### `Novahiz doctor`

Health check — 21 local checks, 26 with `--deep` (five live MCP probes):

| Check | What it verifies |
|-------|------------------|
| `node` | Node.js >= 22.18 |
| `npx` | npx available (required by providers) |
| `index` | `build/installed-skills.json` is readable |
| `referenced` | All skills referenced in the catalog are installed |
| `sessions` | The registry and the database agree on recorded skills |
| `cli` | External CLIs declared in `SKILL_CLI` are present (none by default) |
| `git` | Git is present, so provider skill packs can install |
| `gate` | Gate smoke test passes: a write without a loaded skill is blocked |
| `gate-bypass` | Reports whether `--force-readonly` is in effect |
| `db` | Ledger database is readable |
| `schema` | Database schema version matches the build |
| `manifest` | Baseline digests exist and their drift is counted |
| `backups` | The newest snapshot verifies, and a `native` one exists |
| `evolution` | The change registry's hash chain is intact |
| `adapter` | Installed plugin copy matches the home |
| `memory` | Memory module limits match the expected contract |
| `memory-tools` | The eight `memory_*` tools are registered |
| `mcp-gate` | `novahiz-gate` exposes `novahiz_gate` |
| `agent` | Agent file grants the `question` tool |
| `mcp-config` | `opencode.jsonc` lists the expected MCP servers |
| `playwright-policy` | Playwright policy: Edge and an explicit `--user-data-dir` |

With `--deep`: one probe per MCP server, a memory lifecycle round-trip
(init → write → get → rebuild), and direct probes of the scheduler, docs and gate
servers.

```bash
Novahiz doctor
Novahiz doctor --deep
```

### `Novahiz status`

Shows current classification and gate state.

```bash
Novahiz status
```

### `Novahiz version`

Prints the version from `package.json`.

```bash
Novahiz version
```

## Task management

### `Novahiz task new <title>`

Starts a new tracked task in the ledger.

```bash
Novahiz task new "Add CSV export"
```

### `Novahiz task status`

Shows task progress with todos and their states.

```bash
Novahiz task status
```

### `Novahiz task done <id>`

Marks a todo as complete. For `verify` steps, requires a proof.

```bash
Novahiz task done t1
```

## Session commands

### `Novahiz report`

Session report — shows what was done, what's pending.

```bash
Novahiz report
```

### `Novahiz clean`

Removes old logs and sessions.

```bash
Novahiz clean --days 30 --apply --vacuum
```

Options: `--days N`, `--dry-run`, `--apply`, `--vacuum`, `--json`.

### `Novahiz upgrade`

Pulls latest changes and rebuilds catalog.

```bash
Novahiz upgrade
```

## Advanced commands

### `Novahiz classify <text>`

Classifies a prompt and returns categories, skills, and roadmaps.

```bash
Novahiz classify "ajoute une migration supabase"
```

Output:
```json
{
  "categories": [{ "id": "database-supabase", "score": 3.0, "confidence": 0.6 }],
  "primary": "database-supabase",
  "requiredSkills": ["novahiz-supabase", "novahiz-postgres"],
  "enforcedSkills": ["novahiz-supabase"],
  "roadmaps": [{ "id": "schema", "steps": [...] }],
  "providers": ["supabase"]
}
```

### `Novahiz gate`

Checks if an edit is allowed.

```bash
Novahiz gate --tool edit --file src/hero.css --args-stdin
```

Exit codes: `0` = allowed, `2` = blocked.

### `Novahiz skills`

Lists loaded or available skills.

```bash
Novahiz skills --category design-ui
```

### `Novahiz catalog <query>`

Searches the skill catalog.

```bash
Novahiz catalog "design frontend landing" --limit 5
```

### `Novahiz roadmap`

Shows execution roadmap for a category.

```bash
Novahiz roadmap --category code
```

### `Novahiz dispatch`

Generates work packets from open todos.

```bash
Novahiz dispatch --task <id>
```

### `Novahiz tokens`

Token diagnostics.

```bash
Novahiz tokens --calibrate
```

### `Novahiz sync`

Rebuilds the installed-skills index.

```bash
Novahiz sync
```

### `Novahiz snap <subcommand>`

Versioned snapshots of the SQLite ledger, kept in a content-addressed store under `<home>/.snap` (gzip objects deduplicated by sha256, 50 snapshots kept per operation with a floor of 10).

```bash
Novahiz snap save -m "before the migration"   # capture the ledger now
Novahiz snap diff 9bd58bf current             # what changed since a snapshot
Novahiz snap restore 9bd58bf --force          # put the ledger back (backup first)
```

| Subcommand | Effect |
|-----------|--------|
| `save -m <msg>` | Capture the ledger now, labelled with your message |
| `list` / `log` | Snapshots, newest first |
| `show <id>` | One manifest |
| `diff <id> [current]` | Row-level diff against a snapshot or the live ledger |
| `restore <id> --force` | Restore in one transaction; refuses without `--force` |
| `export <id> <file>` | Copy one snapshot to a `.sqlite` file (workspace paths only) |
| `verify` | Object hash + `integrity_check` for every snapshot |
| `prune` | Delete objects no snapshot references |
| `status` | Store location, count, size, retention, deferred captures |
| `help` | Subcommand reference |

Snapshot ids accept any unambiguous prefix; an ambiguous one is refused and lists its candidates. `list`, `show`, `diff`, `verify`, `prune` and `status` never write to the ledger — only `save` and `restore` do, and `restore` writes a backup before touching a row. Every subcommand accepts `--json`.

### `Novahiz graph <subcommand>`

The workspace code graph, built in-process by our own lexer, extractor and resolver (no external tool). The index lives under `<home>/.graph/<sha12(root)>`; the indexed workspace is never written to. Full architecture and precision rules: [GRAPH.md](GRAPH.md).

```bash
Novahiz graph build                 # rebuild the index now (incremental)
Novahiz graph find snapStatus --json # locate declarations, machine-readable
Novahiz graph trace ensureGraph --depth 2   # callers/callees, N hops
Novahiz graph fresh                 # drift check (stat-only, writes nothing)
```

| Subcommand | Effect |
|-----------|--------|
| `build` | Rebuild the index now — unchanged files reuse their stored object |
| `status` | Store location, build time, freshness, added/changed/removed lists |
| `fresh [--rebuild]` | Drift check against the workspace; `--rebuild` reindexes first |
| `find <name> [--kind k] [--file f] [--limit n]` | Locate declarations: exact → case-insensitive → substring |
| `all <ident> [--file f]` | Every masked occurrence (strings/comments excluded): counts + lines |
| `trace <symbol> [--file f] [--direction both] [--depth 1] [--limit 20]` | Blast radius; ambiguous names return candidates instead of a guess |
| `api <file>` | Signatures-only view: exports, raw imports resolved, definitions |
| `map [--path p] [--depth 3]` | Aggregated tree + workspace call statistics |
| `help` | Subcommand reference |

Subcommands accept any unambiguous prefix (`fi` → `find`); an ambiguous one is refused with its candidates. `--root <path>` indexes another workspace (default: cwd). `find`, `all`, `trace` and `api` exit `1` when they match nothing (grep-style). Every subcommand accepts `--json`.

### `novahiz memory <subcommand>`

Project memory hygiene (`project-memory/`: `index.json` + `slots/`). `clean`, `prune` and `check-docs` are **dry-run by default** — they report the planned actions and write nothing until `--apply`. Nothing here ever deletes content: GC means *archive, never destroy*.

```bash
novahiz memory status              # read-only report (no heal, no write)
novahiz memory clean --json        # plan: stale lock, failed drains, .tmp, duplicates, reindex
novahiz memory clean --apply       # execute the plan
novahiz memory prune --days 7      # list actives not used (read or written) for 7 days
novahiz memory prune --decay 90    # list never-read slots stale for 90 days
novahiz memory prune --retention 90  # list pre-compact copies older than 90 days
novahiz memory prune --apply       # archive/move them (files stay on disk)
novahiz memory check-docs          # verify novahiz-docs citations in slots (dry-run)
novahiz memory check-docs --apply  # append the ⚠ re-verify marker to flagged slots
```

| Subcommand | Effect |
|-----------|--------|
| `status` | Root/layout, index state, slot counts, orphans/ghosts/unreadable files, stale `.lock`, `.pending` queue — strictly read-only (no auto-heal) |
| `clean [--apply]` | Dry-run plan: remove a stale `.lock` (dead pid or malformed), drop `.pending/failed-*.json`, drop `.tmp-*` fragments of interrupted atomic writes (root and `slots/`), rebuild `index.json` (adopts orphan slots, drops ghosts), archive duplicate slots (Resume + Détails byte-identical: the oldest is kept, the newest archived, file kept). Junk non-`.md` files and unreadable slots are reported, never deleted |
| `prune [--days n] [--decay n] [--retention n] [--apply]` | Dry-run lists. `--days` (default 30): active slots whose last use — last read (`last_read`, traced by `memory_get`) or last write — is older than `n`; a recent read extends a slot's life. `--decay` (default 90): active slots **never read** (`last_read` absent) and stale since creation/update. `--retention` (default 90): pre-compact copies in `slots/archive/` older than `n` days, moved to `slots/archive/retention/` (byte-identical). `--apply` archives the slots (`archiveSlot`: status flip, file kept) and moves the copies — nothing is ever deleted |
| `check-docs [--days n] [--slot id] [--apply]` | Checks every `novahiz-docs/<library>[@version]` citation in active slots against the catalogue and the local docs index: flags `absent` (left the bouquet), `unindexed` (catalogued but never ingested), `version-drift` (cited vs indexed version, only when the index knows its own), `refetched` (docs refreshed after the note was written). Also lists libraries consulted through `read_docs` in the last `--days` (default 7) with no persisted decision (nudge → `memory_write`). Dry-run by default; `--apply` **appends** a `⚠ docs à revérifier (check-docs <date>)` marker (idempotent, never deletes); `--slot` checks a single slot |

`--root <path>` targets another project root or memory dir (an explicit path is the workspace reference, so it is honored as-is); default is cwd. Every subcommand accepts `--json`. `prune` and `check-docs` exit `1` on a corrupt index and point you at `clean --apply`.

## Proof, concurrency and the safety net

These commands share one rule: a claim is worth what was measured. None of them
trusts a sentence, and none of them edits the system in secret.

### `novahiz verify <name>`

Runs a command declared by the project and records what actually happened: exit
code, output tail, duration, and a sha256 of command + output. The proof lands in
the ledger and in `.novahiz/evidence/<stamp>-<name>.json`.

`.novahiz/verify.json` is written by `novahiz init` from the detected scripts:

```json
{ "commands": { "tests": "npm test", "typecheck": "npx tsc --noEmit" } }
```

```bash
novahiz verify typecheck
novahiz verify tests --expect "0 failing"
```

| Flag | Effect |
|------|--------|
| `--expect "text"` | Fails unless the output contains this text |
| `--session <id>` | Attribute the proof to that session |
| `--root <dir>` | Project root (default: cwd) |
| `--timeout <s>` | Kill the command after N seconds |

Exit `0` proves the claim, `1` contradicts it, `3` means the measurement was
impossible (paused database, dead network). Without `--session` a session is
resolved only when exactly one is live on the project; two live sessions mean no
attribution, and `attribution.reason` says so instead of guessing.

### `novahiz render --url <url>` / `--file <path>`

Reads the HTML actually served and reports facts a script can check: title,
language, heading outline, landmarks, images without `alt`, links and buttons
without a name, inputs without a label, duplicate ids, positive `tabindex`,
inline styles.

```bash
novahiz render --url http://localhost:3000/fr
novahiz render --url http://localhost:3000/admin --cookie "session=abc" --header "Accept-Language: fr"
```

`--cookie "a=1,b=2"` and `--header "Name: value"` (several headers joined by `|`)
reach an authenticated page. Exit `1` on a blocking finding, `0` otherwise.

### `novahiz dev doctor`

Measures the development environment instead of guessing: which ports answer and
with what status, whether a server listens without ever replying, whether `.next`
exists while a server runs, and whether `fonts.gstatic.com` is reachable.

| Flag | Effect |
|------|--------|
| `--ports 3000,5173` | Ports to probe (default: a small common set) |
| `--no-fonts` | Skip the font/CDN probe |
| `--root <dir>` | Project root (default: cwd) |

### `novahiz secrets scan`

Scans `tmp/`, `logs/`, `.novahiz/evidence/`, `dev-server.log` and `.env.local`
for passwords, bearer tokens, JWTs, API keys and connection strings. The output
is masked; a finding exits non-zero so a CI job or a caller cannot ignore it.

`--paths ...` replaces the default target list, `--root <dir>` moves the root.

### `novahiz skillpack --category <id>`

A compact map of a category's skills: one line of purpose plus headings and
bullet rules per skill, capped by a character budget. It answers "what is in this
pack?" before paying the 30–40k tokens of loading them. It does not replace
`skill()`: the gate still requires the real load.

`--skills a,b` names skills explicitly, `--max-chars N` sets the budget (minimum
500).

### `novahiz resume --session <id>`

Reloads the real state after a restart in one call: recorded skills,
classification, active task, open todos, claims, recent evidence, and the other
sessions live on the project.

`--root <dir>` targets another project. Without a valid session the payload is
honest about it: `session: null` rather than an empty shell.

### `novahiz commit <message> --files a,b`

Commits only the named paths and then verifies that HEAD contains nothing else. A
plain `git commit` publishes whatever another session already staged; in a shared
worktree that turned an 8-file commit into a 12-file one. Files can also follow
the message as positionals. `--message` is accepted for symmetry.

### Claims and live sessions

File claims have no CLI command: they are exposed as the `novahiz_claim` MCP tool
and enforced by the gate (`gate.claims.required`, false by default). A path held
by another live session is refused; a delegated child session inherits its
parent's claims through the `session_links` lineage. Claims expire (30 minutes)
and are scoped by project.

## The safety net

### `novahiz backup [create|list|verify|restore]`

Versioned snapshots of the Novahiz home, verified by SHA-256 over every stored
file.

| Subcommand | Flags | What it does |
|------------|-------|--------------|
| `create` | `--kind native\|auto-improve\|pre-restore` (default `auto-improve`), `--note "…"` | Writes a snapshot. `native` is never pruned: it is the baseline |
| `list` | `--kind` | Lists snapshots with their kind and file count |
| `verify` | `--id <id>` | Re-hashes every stored file and reports the first mismatch |
| `restore` | `--id <id>`, `--yes`, `--prune`, `--rebuild`, `--dry-run` | Refuses to write when the snapshot fails its own check; reports `needsRebuild` unless `--rebuild` rebuilds `dist/` with the local compiler |

### `novahiz evolution [append|list|verify]`

Append-only registry of every change to the system, in
`evolution/evolution.jsonl`. Records are hash-chained: editing, reordering or
deleting a line breaks the chain and `verify` says so.

`append` takes `--kind`, `--target`, `--reason` (the three required), then
`--provenance native|learned|user`, `--verdict`, `--before`, `--after`,
`--evidence a,b` and `--note`. `list` filters with `--kind`.

### `novahiz manifest [sync|diff]`

Baseline digests of the system files. `diff` separates untouched, modified
(`learned` / `user`), added and missing, so "is this file native?" becomes a
measurement. `sync --origin package --from <dir>` records the bytes of the
package that was installed; it refuses when the source is the home itself,
because on a source checkout the package and the working tree are the same thing.

### `novahiz improve [scan|list|show|dismiss|reopen|evidence|apply]`

Self-improvement that proposes rather than changes. `scan` looks for three
measurable signals: sessions stuck in the fallback category, a required skill
loaded in three sessions that produced neither an edit nor a proof, and the same
verification failing three times. Proposals land in `proposals/`, one file each,
deduplicated.

| Subcommand | Flags | What it does |
|------------|-------|--------------|
| `scan` | — | Writes new proposals (at most five per scan) |
| `list` | `--status proposed\|dismissed\|applied` | Lists proposals |
| `show` | `--id <id>` | Full proposal with its evidence |
| `dismiss` | `--id <id>`, `--reason "…"` | Dismissal is permanent until `reopen` |
| `reopen` | `--id <id>`, `--reason "…"` | Puts a dismissed proposal back |
| `evidence` | `--skill <id>` | Per skill: sessions where it was loaded and what followed |
| `apply` | `--id <id>` | One mechanical kind only (`unused-skill`): snapshot, patch, re-read, rollback on any doubt |

`NOVAHIZ_AUTOIMPROVE=off` stops `scan`, `apply` and `repair --apply`, in the CLI
and over MCP. Listing and reading stay available: a disabled system can still be
audited.

### `novahiz repair [--apply]`

Runs a closed whitelist of repairs: a missing or unreadable skills index (rebuilt
by the same code path `novahiz sync` uses), a native baseline snapshot, and a
baseline manifest. Ledger integrity is reported, never "fixed". Every repair is
re-checked afterwards, and a fix that ran but left the symptom says so. Without
`--apply` it reports what it would do.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Command failed (error on stderr, or a claim contradicted) |
| `2` | Gate refused an edit |
| `3` | Measurement impossible — neither success nor failure (see `novahiz verify`) |

## Flags

| Flag | Purpose |
|------|---------|
| `--home <path>` | Override Novahiz home directory |
| `--json` | Machine-readable output |
| `--pretty` | Force human-readable output |
| `--dry-run` | Print actions without executing |
| `--yes` | Skip all prompts |
