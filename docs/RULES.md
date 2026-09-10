# Rules

A rule describes a condition and the skills that condition requires before a file edit.

## Shape

```json
{
  "id": "R2",
  "description": "Charger impeccable avant toute modification de design.",
  "when": {
    "fileClasses": ["design"]
  },
  "require": ["impeccable"]
}
```

- `id` is unique.
- `when.fileClasses` matches the file class of the target path. Classes are `code`, `text`, `design`, `data`, `config`, and `other`.
- `when.pathGlobs` matches the path against globs. `**/supabase/**` matches a Supabase folder at any depth.
- `when.promptCategories` matches the categories the classifier found for the current message.
- A rule applies when any of its conditions match. Conditions inside `when` are OR-ed.
- `require` lists skill ids.

## Global rules

The default set mirrors the global instructions:

| Id | Condition | Requires |
| --- | --- | --- |
| R1 | code, text, design, data or config file | `humanizer` |
| R2 | design file | `impeccable` |
| R3 | a Supabase path or a Supabase prompt | `supabase`, `supabase-postgres-best-practices` |

## Resolution

For a given edit, the gate collects skills from two sources:

1. Every matching rule in `rules.json`.
2. The `defaultSkills` of every category the classifier selected for the current message.

Duplicates collapse. The result is then filtered against the installed skills index:

- When the index is available, a required skill that is not installed is reported separately and does not block. A missing installation never makes the workspace unusable.
- When the index is missing or unreadable, the gate fails closed: every required skill is enforced. This protects the guarantee instead of silently disabling it. Run `novahiz sync` to rebuild the index.

A required skill that is installed but not loaded in the session blocks the call. In `block` mode the gate exits with code 2. In `warn` and `audit` modes it reports the missing skills and exits 0.

## Modes and configuration

The `gate` block in `novahiz.config.json` controls behavior:

- `enabled`: set to `false` to disable the gate entirely.
- `mode`: `block`, `warn`, or `audit`. Only `block` stops the edit.
- `envEscape`: the environment variable that disables the gate for one session. Defaults to `NOVAHIZ_GATE`. Values `off`, `0`, `false`, `no`, and `disabled` disable it.
- `tools`: the tool names the gate intercepts.

## Categories

Categories are the second source of required skills. Each category in `catalog/categories.json` has a `defaultSkills` list. When the classifier selects a category, its skills join the session requirements. A category can list skills that also appear in a rule. Duplicates collapse.

## Tuning

- Change keywords in `catalog/categories.json` to shift classification.
- Add a rule in `catalog/rules.json` to gate a new file type or path.
- Raise `power` in `catalog/overrides.json` to move a skill up in `novahiz skills`.
