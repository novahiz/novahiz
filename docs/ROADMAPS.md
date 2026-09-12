# Roadmaps

A roadmap is an ordered list of steps attached to a category. The classifier picks the categories for a prompt, and the primary category drives the roadmap that the agent follows.

## Model

Roadmaps live inline in `catalog/categories.json`:

```json
"roadmap": {
  "id": "feature",
  "steps": [
    { "id": "understand", "label": "Lire le code existant", "kind": "advisory" },
    { "id": "plan", "label": "Ecrire un plan", "kind": "skill", "requireSkills": ["novahiz-plan"] },
    { "id": "implement", "label": "Implementer", "kind": "edit" },
    { "id": "test", "label": "Executer les tests", "kind": "verify" }
  ]
}
```

Step kinds:

- `advisory`: guidance only.
- `skill`: the gate requires the listed skills before an edit. Mark a step `optional: true` to guide without blocking. Skills listed on any step also join the injected requirements.
- `edit`: a point where files change. The per-file rules apply here.
- `verify`: a checkpoint such as a test or a build. The agent marks it done with `novahiz step`.
- `approval`: a user decision.

## Enforcement

The chosen level is skill-gate. For the category the classifier ranks first, every `skill` step that is not optional becomes a required skill in the gate, in addition to the content-aware rules. A required skill that is absent from the installed index is reported in `unmatchedRequired` and in `warnings`, and the gate stops requiring it for that edit, so a missing installation never blocks. Run `novahiz sync` after installing or removing a skill so the index matches the disk.

Steps of other kinds do not block. They shape the injected checklist and the report.

## Primary category

When several categories match, the one with the highest score provides the roadmap. Required skills are the union across the selected categories, so a Supabase task that also touches design gets both sets.

## Content-aware rules

`humanizer` and `impeccable` are governed by rules, not by roadmap steps, so they are required only when they matter:

- `humanizer` applies to text and documentation, and to code whose change contains prose.
- `impeccable` applies to style files, to components whose change touches styling, and to a design request that targets a UI file.

Rules express this with `when.contentMatches` (`prose`, `style`, or a regex), `when.contentExcludes`, `when.minChange`, and `when.match` (`any` or `all`) to combine the class, path, and category selectors.

## Exemptions

`gate.ignoreFiles` in `novahiz.config.json` holds globs the gate skips: lockfiles, `dist/`, `build/`, `coverage/`, vendored code, minified files, snapshots, and generated files.

## Tools

- `novahiz roadmap --category code` prints the roadmap.
- `novahiz step --session <id> --done <step>` records progress.
- MCP `novahiz_roadmap` and `novahiz_step` expose the same over stdio.
- `novahiz report` summarizes enforcement and roadmap progress.
