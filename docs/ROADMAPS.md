# Roadmaps

A roadmap is an ordered list of steps attached to a category. The classifier picks the categories for a prompt, and the primary category drives the roadmap that the agent follows.

## The six-stage pipeline

Eight categories run the same pipeline: `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`. Every stage is a skill, and `skillenforce-planner` is the orchestrator that fixes the order.

| # | Stage | Skill | Produces |
|---|---|---|---|
| 1 | Plan | `skillenforce-plan` | direction, scope, dependency order, slicing strategy, risks |
| 2 | Clarify | `skillenforce-clarify` | the open questions, answered, and the decisions they freeze |
| 3 | Tasks | `skillenforce-task` | atomic tasks, each with acceptance criteria and proof |
| 4 | Analyse | `skillenforce-analyse` | the files and symbols that carry the logic, and the unknowns |
| 5 | Implement | `skillenforce-implement` | increments that leave the system working |
| 6 | Converge | `skillenforce-converge` | the gap between intent and code, as traceable remaining tasks |

Stages 1 to 4 write no application file; they produce a plan and decisions. Clarify sends you back to plan when an answer changes the architecture, and converge sends you back to tasks when it finds a gap.

`review` runs analyse and then the diff review. `audit` and `test` keep their own steps and end on a converge. `research` drives a single gather step.

## Model

Roadmaps live inline in `catalog/categories.json`:

```json
"roadmap": {
  "id": "feature",
  "steps": [
    { "id": "understand", "label": "Lire le code existant", "kind": "advisory" },
    { "id": "plan", "label": "Ecrire un plan", "kind": "skill", "requireSkills": ["skillenforce-plan"] },
    { "id": "implement", "label": "Implementer", "kind": "edit" },
    { "id": "test", "label": "Executer les tests", "kind": "verify" }
  ]
}
```

Step kinds:

- `advisory`: guidance only.
- `skill`: the gate requires the listed skills before an edit. Mark a step `optional: true` to guide without blocking. Skills listed on any step also join the injected requirements.
- `edit`: a point where files change. The per-file rules apply here.
- `verify`: a checkpoint such as a test or a build. The agent marks it done with `skillenforce step`.
- `approval`: a user decision.

## Enforcement

The chosen level is skill-gate. For the category the classifier ranks first, every `skill` step that is not optional becomes a required skill in the gate, in addition to the content-aware rules. A required skill that is absent from the installed index is reported in `unmatchedRequired` and in `warnings`, and the gate stops requiring it for that edit, so a missing installation never blocks. Run `skillenforce sync` after installing or removing a skill so the index matches the disk.

Steps of other kinds do not block. They shape the injected checklist and the report.

## Primary category

When several categories match, the one with the highest score provides the roadmap. Required skills are the union across the selected categories, so a Supabase task that also touches design gets both sets.

## Content-aware rules

`humanizer` and `impeccable` are governed by rules, not by roadmap steps, so they are required only when they matter:

- `humanizer` applies to text and documentation, and to code whose change contains prose.
- `impeccable` applies to style files, to components whose change touches styling, and to a design request that targets a UI file.

Rules express this with `when.contentMatches` (`prose`, `style`, or a regex), `when.contentExcludes`, `when.minChange`, and `when.match` (`any` or `all`) to combine the class, path, and category selectors.

## Exemptions

`gate.ignoreFiles` in `skillenforce.config.json` holds globs the gate skips: lockfiles, `dist/`, `build/`, `coverage/`, vendored code, minified files, snapshots, and generated files.

## Tools

- `skillenforce roadmap --category code` prints the roadmap.
- `skillenforce step --session <id> --done <step>` records progress.
- MCP `skillenforce_roadmap` and `skillenforce_step` expose the same over stdio.
- `skillenforce report` summarizes enforcement and roadmap progress.
