---
name: novahiz-plan
description: |
  Step 1 of the Novahiz pipeline: decide the direction before writing any code.
  Read-only phase that produces a plan: definition of "done", scope, chosen approach,
  dependency order, splitting strategy, risks, and checkpoint positions.
  Use when starting a feature, a refactor, a migration, or any change that spans several
  files or whose approach is not obvious.
  Triggers on: "plan this", "how to approach", "where to start", feature, architecture,
  migration, refactoring, multi-file change.
license: MIT
compatibility: opencode
---

# novahiz-plan: decide the direction

**Step 1 of 6** in the `novahiz-planner` pipeline. No application file is modified here. The deliverable is a plan.

Next steps: `novahiz-clarify`, then `novahiz-task`.

## Entry

The request is classified. Nothing has been written yet.

## Open the ledger

Trace the plan in the execution ledger, not in a local note:

```
novahiz_task action="new"  title="<the request in one sentence>"
novahiz_task action="plan" todos=[...]
```

`todowrite` provides visible tracking; `novahiz_task` provides the durable ledger that survives compaction.

## What the plan contains

- **Done, what it means**: a single sentence describing the final observable state.
- **Scope**: what goes in, what stays out.
- **Chosen approach**: the decision, plus rejected options and why.
- **Dependency order**: what must exist before what.
- **Splitting strategy**: vertical by default, contract-first if a shared interface is involved, risk-first if an unknown dominates.
- **Risks**: impact and mitigation.
- **Checkpoint positions**.

## Read-only

Read the affected code, the manifests, the conventions in place. You write no code during this phase, and you do not "prepare the ground" with minor modifications. A plan is judged by the rewrites it avoids.

## Implementation order

Walk the dependency graph bottom-up: foundations first, then surface. An API written before its schema gets rewritten; a screen written before its API gets thrown away.

## Splitting strategies

**Vertical (default).** A slice crosses the necessary layers to be observable end-to-end. Shipping all the database, then all the API, then all the screen leaves three unusable workstreams.

**Contract-first.** When multiple consumers share an interface: freeze the types and signatures, then parallelize both sides.

**Risk-first.** When an unknown dominates: prove the least certain piece before investing elsewhere.

## Eight categories require this step

The gate requires `novahiz-plan` for `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`.

## Validate before executing

A complex plan does not go into execution on assumed agreement. Present the structuring decision through the `question` tool:

```
question({
  questions: [
    {
      header: "Validate the plan",
      question: "Does the plan hold? <summary in one sentence>",
      options: [
        { label: "Validate and execute (Recommended)", description: "<what starts immediately>" },
        { label: "Adjust scope", description: "<what would be removed or added>" },
        { label: "Abort", description: "nothing is written" }
      ]
    }
  ]
})
```

The plan content lives in the chat. The validation question lives in the interface. Never replace one with the other.

## Next step

If choices remain open on architecture, data, scope, or tests, go to `novahiz-clarify` first. Otherwise, `novahiz-task` converts the plan into atomic tasks.

## Guardrails

- Start with the target and the constraint, not with the files.
- A plan without dependency order remains an intention.
- Never replace a still-open plan: same work, update in place; different work, stop and ask.
- A plan where every slice is XL is not a plan.
- A plan without checkpoints does not say when to stop.
- Never promise anything you have not verified. A direction announced without reading the code is a guess.
