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

- When the index is available, a required skill that is not installed is reported in `unmatchedRequired` and in the `warnings` array, and it does not block. This is deliberate: an installation gap should not make a whole category uneditable. A harness that wants the stricter behaviour can treat a non-empty `unmatchedRequired` as a failure.
- When the index is missing or unreadable, the gate fails closed and enforces every required skill. Run `novahiz sync` to rebuild the index.
- Files that match `gate.ignoreFiles` are skipped entirely.

A required skill that is installed but not loaded in the session blocks the call. In `block` mode the gate exits with code 2. In `warn` and `audit` modes it reports and exits 0.

### What counts as a loaded skill

The harness records the load, not the gate. Two signals exist:

- A tool named `skill` (opencode). The adapter also calls `novahiz session-load` on every such call.
- A read of `<...>/skills/<name>/SKILL.md` (Claude Code, Codex). Those harnesses have no skill tool: the agent loads a skill by opening the file. The Novahiz hook therefore treats that read as the load, which is why the Claude `PreToolUse` matcher includes `Read`.

Anything else leaves the skill unloaded. A harness that reads skills some other way has to call `novahiz session-load --session <id> --skill <name>` itself.

## Modes and configuration

The `gate` block in `novahiz.config.json` controls behavior:

- `enabled`: disable the whole gate.
- `mode`: `block`, `warn`, or `audit`.
- `envEscape`: the variable that disables the gate for one session. Defaults to `NOVAHIZ_GATE`; values `off`, `0`, `false`, `no`, `disabled` disable it. Read by the CLI, the hook mode, the MCP gate tool, and the opencode plugin.
- `tools`: the tool names the gate intercepts.
- `ignoreFiles`: globs skipped by the gate.

## Shell writes

The gate intercepts the shell tool when the command writes files. It extracts targets from redirections (`>`, `>>`, `&>`), `tee`, `cp`, `mv`, `rsync`, `robocopy`, `touch`, `truncate`, `sed -i`, `dd`, `rm`, `del`, `erase`, `rd`, and the PowerShell cmdlets `Set-Content`, `Add-Content`, `Out-File`, `New-Item`, `Copy-Item`, `Move-Item`, `Remove-Item`, `Rename-Item`, `Tee-Object`, `mkdir`. It looks through wrappers such as `sudo`, `env`, `timeout`, `nice`, and `cmd /c`, and ignores arguments that only look like a command. Commands that do not appear to write files pass through.

This detection is best-effort. A command that hides its target can still write without passing the gate. To disable shell gating, remove `bash` and `shell` from `gate.tools`.

## Roadmaps

Categories also carry a roadmap. See [ROADMAPS.md](ROADMAPS.md).
