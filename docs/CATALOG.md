# Catalog System

The catalog is the knowledge base of Novahiz. It defines what categories exist, what keywords trigger them, what skills are required, and what execution roadmaps the agent should follow.

## Files

```
catalog/
├── categories.json    # 17 categories with keywords, skills, roadmaps
├── rules.json         # 11 pre-edit rules (file class + content triggers)
├── providers.json     # 10 external providers (7 MCP + 3 skill packs)
└── overrides.json     # Manual skill curation (power, stars, tags)
```

## categories.json

Each category is a JSON object:

```json
{
  "id": "database-supabase",
  "label": "Database / Supabase",
  "priority": 57,
  "keywords": ["supabase", "postgres", "sql", "rls", "migration", ...],
  "negativeKeywords": ["mockup", "landing"],
  "defaultSkills": ["supabase", "supabase-postgres-best-practices"],
  "roadmap": {
    "id": "schema",
    "steps": [
      { "id": "plan", "label": "Set the change direction", "kind": "skill", "requireSkills": ["novahiz-plan"] },
      { "id": "clarify", "label": "Remove ambiguities", "kind": "skill", "requireSkills": ["novahiz-clarify"] },
      ...
    ]
  }
}
```

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Unique identifier |
| `label` | string | Human-readable name |
| `priority` | number | Higher = wins ties in classification |
| `keywords` | string[] | Words that increase the score |
| `negativeKeywords` | string[] | Words that decrease the score |
| `defaultSkills` | string[] | Skills always required for this category |
| `roadmap` | object | Ordered execution steps |

### Roadmap step kinds

| Kind | Blocks? | Purpose |
|------|---------|---------|
| `skill` | Yes (if not loaded) | Load a skill before proceeding |
| `edit` | No | Make code changes |
| `verify` | No | Check that the work is correct |
| `advisory` | No | Informational step |

### Optional steps

A step with `"optional": true` is suggested but not enforced by the gate.

## rules.json

Each rule triggers skill requirements based on file class, path, prompt category, or content:

```json
{
  "id": "R13-design-craft",
  "description": "Load novahiz-humanizer, ui-slop-remover and ui-craft-rules on frontend design tasks only.",
  "when": {
    "match": "any",
    "promptCategories": ["design-ui"],
    "pathGlobs": ["**/*.css", "**/*.scss", "**/*.html"]
  },
  "require": ["novahiz-humanizer", "ui-slop-remover", "ui-craft-rules"]
}
```

### Rule selectors

| Selector | Matches |
|----------|---------|
| `fileClasses` | File extension class (code, design, text, config, data) |
| `pathGlobs` | Glob patterns against the file path |
| `promptCategories` | Classified prompt categories |
| `contentMatches` | Content patterns (prose, style, or regex) |
| `contentExcludes` | Negative content patterns |

### Rule combination

- `when.match: "all"` (default) — ALL selectors must match
- `when.match: "any"` — ANY selector can match

## providers.json

Lists external tools that Novahiz can register as MCP servers:

```json
{
  "id": "narsil",
  "label": "Code intelligence",
  "kind": "mcp",
  "transport": "local",
  "command": ["npx", "-y", "narsil-mcp@1.7.0", "--repos", ".", "--git"],
  "purpose": "Code graph, symbols, taint tracking, dead code, and security scan.",
  "categories": ["code", "debug", "review", "audit"]
}
```

### Provider kinds

| Kind | Registration |
|------|-------------|
| `mcp` | Registered as MCP server in opencode config |
| `skill` | Installed as a skill pack via npm |

## overrides.json

Manual curation for skills. Used to adjust scores, add tags, or assign categories that the automatic parser misses.

## Syncing

Run `Novahiz sync` to rebuild the installed-skills index:

```bash
Novahiz sync
```

This walks all skill roots, parses `SKILL.md` frontmatter, and writes `build/installed-skills.json`.
