# CLI Reference

skillenforce exposes a single CLI entry point. All commands return JSON when invoked programmatically.

## Core commands

### `skillenforce init`

One-shot setup: copies core, builds catalog, installs skills.

```bash
skillenforce init
```

### `skillenforce doctor`

Health check — runs 10 diagnostic checks:

| Check | What it verifies |
|-------|------------------|
| `node` | Node.js >= 22.18 |
| `npx` | npx available (required by providers) |
| `index` | `build/installed-skills.json` is readable |
| `referenced` | All skills referenced in catalog are installed |
| `cli` | External CLIs (defuddle) are present |
| `gate` | Gate smoke test passes |
| `db` | Ledger database is readable |
| `plugin` | Installed plugin matches source |
| `agent` | Agent file grants `question` tool |
| `config` | Config file is valid |

```bash
skillenforce doctor
```

### `skillenforce status`

Shows current classification and gate state.

```bash
skillenforce status
```

### `skillenforce version`

Prints the version from `package.json`.

```bash
skillenforce version
```

## Task management

### `skillenforce task new <title>`

Starts a new tracked task in the ledger.

```bash
skillenforce task new "Add CSV export"
```

### `skillenforce task status`

Shows task progress with todos and their states.

```bash
skillenforce task status
```

### `skillenforce task done <id>`

Marks a todo as complete. For `verify` steps, requires a proof.

```bash
skillenforce task done t1
```

## Session commands

### `skillenforce report`

Session report — shows what was done, what's pending.

```bash
skillenforce report
```

### `skillenforce clean`

Removes old logs and sessions.

```bash
skillenforce clean --days 30 --apply --vacuum
```

Options: `--days N`, `--dry-run`, `--apply`, `--vacuum`, `--json`.

### `skillenforce upgrade`

Pulls latest changes and rebuilds catalog.

```bash
skillenforce upgrade
```

## Advanced commands

### `skillenforce classify <text>`

Classifies a prompt and returns categories, skills, and roadmaps.

```bash
skillenforce classify "ajoute une migration supabase"
```

Output:
```json
{
  "categories": [{ "id": "database-supabase", "score": 3.0, "confidence": 0.6 }],
  "primary": "database-supabase",
  "requiredSkills": ["supabase", "supabase-postgres-best-practices"],
  "enforcedSkills": ["supabase"],
  "roadmaps": [{ "id": "schema", "steps": [...] }],
  "providers": ["supabase"]
}
```

### `skillenforce gate`

Checks if an edit is allowed.

```bash
skillenforce gate --tool edit --file src/hero.css --args-stdin
```

Exit codes: `0` = allowed, `2` = blocked.

### `skillenforce skills`

Lists loaded or available skills.

```bash
skillenforce skills --category design-ui
```

### `skillenforce catalog <query>`

Searches the skill catalog.

```bash
skillenforce catalog "design frontend landing" --limit 5
```

### `skillenforce roadmap`

Shows execution roadmap for a category.

```bash
skillenforce roadmap --category code
```

### `skillenforce dispatch`

Generates work packets from open todos.

```bash
skillenforce dispatch --task <id>
```

### `skillenforce tokens`

Token diagnostics.

```bash
skillenforce tokens --calibrate
```

### `skillenforce sync`

Rebuilds the installed-skills index.

```bash
skillenforce sync
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Command failed (error on stderr) |
| `2` | Gate refused an edit |

## Flags

| Flag | Purpose |
|------|---------|
| `--home <path>` | Override skillenforce home directory |
| `--json` | Machine-readable output |
| `--pretty` | Force human-readable output |
| `--dry-run` | Print actions without executing |
| `--yes` | Skip all prompts |
