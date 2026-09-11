# Rules

A rule describes a condition and the skills that condition requires before a file edit.

## Shape

```json
{
  "id": "R2-style",
  "description": "Charger impeccable sur les fichiers de style visuel.",
  "when": {
    "pathGlobs": ["**/*.css", "**/*.scss"]
  },
  "require": ["impeccable"]
}
```

Condition fields:

- `fileClasses` matches the target file class: `code`, `text`, `design`, `data`, `config`, `other`.
- `pathGlobs` matches the path.
- `promptCategories` matches the categories the classifier found for the message.
- `contentMatches` matches the changed text. Use the named matchers `prose` and `style`, or a regex.
- `contentExcludes` cancels the rule when it matches the changed text.
- `minChange` skips trivial diffs.
- `match` combines the selector fields. `any` (default) applies the rule when one selector matches. `all` requires every selector to match.

Content conditions are combined with AND against the selectors. A rule with `contentMatches` does not apply when no content is provided.

## Default rules

| Id | Condition | Requires |
| --- | --- | --- |
| R1-docs | text, data or config file, or a docs-writing prompt | `humanizer` |
| R1-code-prose | code or design file whose change contains prose | `humanizer` |
| R2-style | a style file | `impeccable` |
| R2-styled-component | jsx/tsx whose change touches styling | `impeccable` |
| R2-design-target | design prompt on a UI file | `impeccable` |
| R3-supabase | a Supabase path or a Supabase prompt | `supabase`, `supabase-postgres-best-practices` |

## Resolution

For an edit, the gate collects skills from two places:

1. Every matching rule.
2. The `skill` steps of the primary category roadmap, skipping `optional` steps.

Duplicates collapse. The result is filtered against the installed skills index:

- When the index is available, a required skill that is not installed is reported separately and does not block.
- When the index is missing or unreadable, the gate fails closed and enforces every required skill. Run `novahiz sync` to rebuild the index.
- Files that match `gate.ignoreFiles` are skipped entirely.

A required skill that is installed but not loaded in the session blocks the call. In `block` mode the gate exits with code 2. In `warn` and `audit` modes it reports and exits 0.

## Modes and configuration

The `gate` block in `novahiz.config.json` controls behavior:

- `enabled`: disable the whole gate.
- `mode`: `block`, `warn`, or `audit`.
- `envEscape`: the variable that disables the gate for one session. Defaults to `NOVAHIZ_GATE`; values `off`, `0`, `false`, `no`, `disabled` disable it. Read by the CLI, the hook mode, the MCP gate tool, and the opencode plugin.
- `tools`: the tool names the gate intercepts.
- `ignoreFiles`: globs skipped by the gate.

## Shell writes

The gate intercepts the shell tool when the command writes files. It extracts targets from redirections (`>`, `>>`, `&>`), `tee`, `cp`, `mv`, `touch`, `sed -i`, `dd`, and the PowerShell cmdlets `Set-Content`, `Add-Content`, `Out-File`, `New-Item`, `Tee-Object`. Commands that do not appear to write files pass through.

This detection is best-effort. A command that hides its target can still write without passing the gate. To disable shell gating, remove `bash` and `shell` from `gate.tools`.

## Roadmaps

Categories also carry a roadmap. See [ROADMAPS.md](ROADMAPS.md).
