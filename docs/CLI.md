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
