# Rules

A rule describes a condition and the skills that condition requires before a file edit.

## Shape

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

Condition fields:

- `fileClasses` matches the target file class: `code`, `text`, `design`, `data`, `config`, `other`.
- `pathGlobs` matches the path.
- `promptCategories` matches the categories the classifier found for the message.
- `contentMatches` matches the changed text. Use the named matchers `prose` and `style`, or a regex.
- `contentExcludes` cancels the rule when it matches the changed text.
- `minChange` skips trivial diffs.
- `match` combines the selector fields. `all` (default) requires every selector to match; `any` applies the rule when one selector matches.

Content conditions are combined with AND against the selectors. A rule with `contentMatches` does not apply when no content is provided.

## Default rules

| Id | Condition | Requires |
| --- | --- | --- |
| R3-supabase | a Supabase path or a Supabase prompt | `novahiz-supabase`, `novahiz-postgres` |
| R4-playwright | a browser prompt category, or a browser test path (`**/*.e2e.ts`, `**/e2e/**`, `**/playwright/**`, `**/*.cy.ts`, …) | `novahiz-browser` |
| R6-Novahiz | a prompt in a workflow category | pipeline skills (`novahiz-plan`, `novahiz-clarify`, `novahiz-analyse`, `novahiz-implement`, `novahiz-converge`) |
| R7-assessment | an `assessment` prompt | assessment pipeline skills (`novahiz-assess-intake`, `novahiz-assess-research`, `novahiz-assess-define`, `novahiz-assess-shape`, `novahiz-assess-decide`) |
| R8-docs | a documentation file under `novahiz-docs/` (`**/novahiz-docs/**/*.md`, relative or absolute) | `novahiz-docs` |
| R9-code-review | a review prompt, any code file, or a `.tsx`/`.jsx`/`.vue`/`.svelte`/`.astro` file | `novahiz-code-review` |
| R10-security | an audit prompt | `novahiz-security` |
| R11-accessibility | a design-ui or audit prompt | `novahiz-wcag-audit` |
| R12-web-extract | a research prompt | `novahiz-web-extract` |
| R13-design-craft | a design-ui prompt or a style file (css/scss/less/html) | `novahiz-humanizer`, `ui-slop-remover`, `ui-craft-rules` |
| R14-impeccable | a design-ui prompt or a style file (css/scss/less/html) | `impeccable` |

`novahiz-humanizer` and `ui-slop-remover` are required only by R13, on frontend design tasks. They are not required on ordinary text, docs, or code edits. `impeccable` loads under R14 on the same selectors, so the critique, audit, and polish playbooks stay reachable after UI work.

## Resolution

For an edit, the gate collects skills from two places:

1. Every matching rule.
2. The `skill` steps of the primary category roadmap, skipping `optional` steps.

Duplicates collapse. The result is filtered against the installed skills index:

- When the index is available, a required skill that is not installed is reported in `unmatchedRequired` and in the `warnings` array, and it does not block. This is deliberate: an installation gap should not make a whole category uneditable. A harness that wants the stricter behaviour can treat a non-empty `unmatchedRequired` as a failure.
- When the index is missing or unreadable, the gate fails closed and enforces every required skill. Run `Novahiz sync` to rebuild the index.
- Files that match `gate.ignoreFiles` are skipped entirely.

A required skill that is installed but not loaded in the session blocks the call. In `block` mode the gate exits with code 2. In `warn` and `audit` modes it reports and exits 0.

### What counts as a loaded skill

The harness records the load, not the gate.

- opencode calls the `skill` tool, and the adapter records it by running `Novahiz session-load --session <id> --skill <name>`.
- A harness that reads skills some other way records the load itself, by calling `Novahiz session-load` before its edit.

Anything else leaves the skill unloaded.

A skill whose frontmatter names an `allowed-tools` entry the harness does not recognize fails to launch at all. That is why the bundled `Novahiz-*` skills declare no `allowed-tools`.

## Modes and configuration

The `gate` block in `novahiz.config.json` controls behavior:

- `enabled`: disable the whole gate.
- `mode`: `block`, `warn`, or `audit`.
- `envEscape`: schema field only. The kill-switch variable is hardcoded to `NOVAHIZ_GATE` (not configurable); values `off`, `0`, `false`, `no`, `disabled` disable the gate. Read by the CLI, the hook mode, the MCP gate tool, and the opencode plugin.
- `tools`: the tool names the gate intercepts.
- `ignoreFiles`: globs skipped by the gate.

## Shell writes

The gate intercepts the shell tool when the command writes files. It extracts targets from redirections (`>`, `>>`, `&>`), `tee`, `cp`, `mv`, `rsync`, `robocopy`, `touch`, `truncate`, `sed -i`, `dd`, `rm`, `del`, `erase`, `rd`, and the PowerShell cmdlets `Set-Content`, `Add-Content`, `Out-File`, `New-Item`, `Copy-Item`, `Move-Item`, `Remove-Item`, `Rename-Item`, `Tee-Object`, `mkdir`. It looks through wrappers such as `sudo`, `env`, `timeout`, `nice`, and `cmd /c`, and ignores arguments that only look like a command. Commands that do not appear to write files pass through.

This detection is best-effort. A command that hides its target can still write without passing the gate. To disable shell gating, remove `bash` and `shell` from `gate.tools`.

## Roadmaps

Categories also carry a roadmap. See [ROADMAPS.md](ROADMAPS.md).
