# Rules

A rule describes a condition and the skills that condition requires before a file edit.

## Shape

```json
{
  "id": "R2",
  "description": "Charge impeccable avant toute modification de design.",
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
| R1 | any code or text file | `humanizer` |
| R2 | any design file | `impeccable` |
| R3 | a Supabase path or a Supabase prompt | `supabase`, `supabase-postgres-best-practices` |

## Resolution

For a given edit, the gate collects the skills from every matching rule, removes duplicates, and drops skills that are not installed. A missing installed skill blocks the call. The gate reports skipped skills separately so a missing installation never makes the workspace unusable.

## Categories

Categories are the second source of required skills. Each category in `catalog/categories.json` has a `defaultSkills` list. When the classifier selects a category, its skills join the session requirements. A category can list skills that also appear in a rule. Duplicates collapse.

## Tuning

- Change keywords in `catalog/categories.json` to shift classification.
- Add a rule in `catalog/rules.json` to gate a new file type or path.
- Raise `power` in `catalog/overrides.json` to move a skill up in `novahiz skills`.
