# CLI Reference

Novahiz exposes a single CLI entry point. All commands return JSON when invoked programmatically.

## Core commands

### `Novahiz init`

One-shot setup: copies core, builds catalog, installs skills.

```bash
Novahiz init
```

### `Novahiz doctor`

Health check — runs 10 diagnostic checks:

| Check | What it verifies |
|-------|------------------|
| `node` | Node.js >= 22.18 |
| `npx` | npx available (required by providers) |
| `index` | `build/installed-skills.json` is readable |
| `referenced` | All skills referenced in catalog are installed |
| `cli` | External CLIs declared in `SKILL_CLI` are present (none by default) |
| `gate` | Gate smoke test passes |
| `db` | Ledger database is readable |
| `plugin` | Installed plugin matches source |
| `agent` | Agent file grants `question` tool |
| `config` | Config file is valid |

```bash
Novahiz doctor
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

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Command failed (error on stderr) |
| `2` | Gate refused an edit |

## Flags

| Flag | Purpose |
|------|---------|
| `--home <path>` | Override Novahiz home directory |
| `--json` | Machine-readable output |
| `--pretty` | Force human-readable output |
| `--dry-run` | Print actions without executing |
| `--yes` | Skip all prompts |
