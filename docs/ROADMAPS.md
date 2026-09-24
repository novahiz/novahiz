# Roadmaps

A roadmap is an ordered list of steps attached to a category. The classifier picks the categories for a prompt, and the primary category drives the roadmap that the agent follows.

## The six-stage pipeline

Eight categories run the same pipeline: `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`. Every stage is a skill, and `novahiz-planner` is the orchestrator that fixes the order.

`flutter` (`flutter-feature`) follows the same six stages and inserts three non-optional quality skills: `flutter-apply-architecture-best-practices`, `dart-run-static-analysis` before implement, then `dart-add-unit-test` after implement, plus a final self-review. On `lite` and `trivial` tiers those architecture/analyze/test steps are filtered like every other roadmap (lite keeps only implement and converge).

| # | Stage | Skill | Produces |
|---|---|---|---|
| 1 | Plan | `novahiz-plan` | direction, scope, dependency order, slicing strategy, risks |
| 2 | Clarify | `novahiz-clarify` | the open questions, answered, and the decisions they freeze |
| 3 | Tasks | `novahiz-task` | atomic tasks, each with acceptance criteria and proof |
| 4 | Analyse | `novahiz-analyse` | the files and symbols that carry the logic, and the unknowns |
| 5 | Implement | `novahiz-implement` | increments that leave the system working |
| 6 | Converge | `novahiz-converge` | the gap between intent and code, as traceable remaining tasks |

Stages 1 to 4 write no application file; they produce a plan and decisions. Clarify sends you back to plan when an answer changes the architecture, and converge sends you back to tasks when it finds a gap.

`review` runs analyse and then the diff review. `audit` and `test` keep their own steps and end on a converge. `research` drives a single gather step.

## Expo (progressive gate)

`expo` (`expo-feature`, 11 steps) runs the six stages and inserts four **optional** `expo-*` skills between analyse and implement: `expo-router` (routes, links, modals), `expo-module` (native code), `expo-dev-client` (dev client / EAS build), `expo-upgrade` (SDK upgrades). Optional steps guide without blocking — only the pipeline skills are enforced — and `expo-overview` loads through `defaultSkills` as the entry point. `flutter` is excluded through negative keywords, so a prompt naming both picks the right category.

Task-to-skill routing, the full `expo-*` pack (17 skills, `eas-*` paid services excluded):

| Task | Skill |
|------|-------|
| Any Expo request (entry point) | `expo-overview` |
| Routes, links, modals, tabs | `expo-router` |
| Folder structure, file-based layout | `expo-project-structure` |
| Native modules (Swift / Kotlin) | `expo-module` |
| Dev client, EAS build setup | `expo-dev-client` |
| SDK upgrade | `expo-upgrade` |
| Animations, gestures | `expo-animation` |
| Data fetching, caching | `expo-data-fetching` |
| Design system, tokens | `expo-design-system` |
| Native-feeling styling | `expo-native-ui` |
| `@expo/ui` components | `expo-ui` |
| Web → native migration | `expo-web-to-native` |
| DOM components | `expo-dom` |
| Brownfield (existing app) | `expo-brownfield` |
| Example patterns | `expo-examples` |
| App Clip (iOS) | `expo-app-clip` |
| Feedback / telemetry control | `expo-skill-feedback` |

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
- `verify`: a checkpoint such as a test or a build. The agent marks it done with `Novahiz step`.
- `approval`: a user decision.

## Enforcement

The chosen level is skill-gate. For the category the classifier ranks first, every `skill` step that is not optional becomes a required skill in the gate, in addition to the content-aware rules. A required skill that is absent from the installed index is reported in `unmatchedRequired` and in `warnings`, and the gate stops requiring it for that edit, so a missing installation never blocks. Run `Novahiz sync` after installing or removing a skill so the index matches the disk.

Steps of other kinds do not block. They shape the injected checklist and the report.

## Primary category

When several categories match, the one with the highest score provides the roadmap. Required skills are the union across the selected categories, so a Supabase task that also touches design gets both sets.

## Content-aware rules

`novahiz-humanizer` and `ui-slop-remover` load only through `R13-design-craft` on frontend design tasks:

- Both skills are required on design-ui prompts and style file edits (css/scss/less/html).
- Outside frontend design, neither skill is required by the gate.
- The design-ui roadmap also carries an optional `design-craft` step for guidance; it does not block.
- `R14-impeccable` requires the `impeccable` skill on the same design selectors. The design-ui roadmap adds optional `impeccable-critique`, `impeccable-audit`, and `impeccable-polish` steps after implement, and the flutter roadmap an optional `impeccable-critique` step for UI work; optional steps guide without blocking.

Rules express this with `when.contentMatches` (`prose`, `style`, or a regex), `when.contentExcludes`, `when.minChange`, and `when.match` (`any` or `all`) to combine the class, path, and category selectors.

## Exemptions

`gate.ignoreFiles` in `novahiz.config.json` holds globs the gate skips: lockfiles, `dist/`, `build/`, `coverage/`, vendored code, minified files, snapshots, and generated files.

## Tools

- `Novahiz roadmap --category code` prints the roadmap.
- `Novahiz step --session <id> --done <step>` records progress.
- MCP `novahiz_roadmap` and `novahiz_step` expose the same over stdio.
- `Novahiz report` summarizes enforcement and roadmap progress.
