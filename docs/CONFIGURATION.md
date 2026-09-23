# Configuration

Novahiz uses two layers of configuration: versioned catalog files and machine-specific settings.

## Catalog files (versioned)

These files live in `catalog/` and are part of the git repository:

| File | Purpose |
|------|---------|
| `categories.json` | Category definitions, keywords, roadmaps |
| `rules.json` | Pre-edit rules (file class, content, skills) |
| `providers.json` | External MCP servers and skill packs |
| `overrides.json` | Manual skill curation |

## User config

`novahiz.config.json` in the Novahiz home directory. Machine-specific, gitignored.

```json
{
  "dbPath": "novahiz.sqlite",
  "skillRoots": ["./skills", "./bundled-skills"],
  "gate": {
    "enabled": true,
    "mode": "block",
    "envEscape": "NOVAHIZ_GATE",
    "tools": ["edit", "write", "patch", "apply_patch", "bash", "shell"],
    "ignoreFiles": ["**/node_modules/**", "**/dist/**", ...],
    "placeholders": true,
    "trace": {
      "enabled": false,
      "categories": ["code", "debug", "audit", "review", "database-supabase"]
    }
  },
  "classify": {
    "minScore": 1,
    "maxCategories": 3,
    "fallbackCategory": "general"
  },
  "providers": {
    "autoRegister": true,
    "autoInstall": false,
    "disabled": []
  },
  "ledger": {
    "enabled": true,
    "review": {
      "edits": 3,
      "todos": 2
    }
  }
}
```

### Config reference

| Key | Default | Purpose |
|-----|---------|---------|
| `dbPath` | `novahiz.sqlite` | SQLite database path |
| `skillRoots` | `["./skills", "./bundled-skills"]` | Directories to scan for skills |
| `gate.enabled` | `true` | Enable/disable the gate |
| `gate.mode` | `block` | `block`, `warn`, or `audit` |
| `gate.envEscape` | `NOVAHIZ_GATE` | Env var to disable the gate |
| `gate.tools` | `[edit, write, patch, ...]` | Tools to intercept |
| `gate.placeholders` | `true` | Block edits with placeholder markers |
| `classify.minScore` | `1` | Minimum score to match a category |
| `classify.maxCategories` | `3` | Maximum categories per prompt |
| `classify.fallbackCategory` | `general` | Fallback when no category matches |
| `providers.autoRegister` | `true` | Auto-register MCP providers |
| `providers.autoInstall` | `false` | Auto-install provider dependencies |
| `providers.disabled` | `[]` | Providers to skip |
| `ledger.enabled` | `true` | Enable the task ledger |
| `ledger.review.edits` | `3` | Force review after N edits |
| `ledger.review.todos` | `2` | Force review after N completed todos |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NOVAHIZ_HOME` | Override Novahiz home directory |
| `NOVAHIZ_GATE` | Set to `off` to disable the gate |
| `NOVAHIZ_NODE` | Override node executable path |
| `NOVAHIZ_DB` | Override database path |
| `OPENCODE_CONFIG_DIR` | Override opencode config directory |

## opencode config

The installer generates `opencode.jsonc` with:

- MCP server registrations (context7, narsil, cron, playwright, supabase, expo)
- Skill paths
- Plugin list
- Compaction settings
- Shell preference

Do not edit `opencode.jsonc` by hand for Novahiz — the plugin handles registration automatically.
