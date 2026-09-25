---
name: novahiz-plan
description: |
  novahiz-plan, step 1 of the Novahiz pipeline: settle the direction before any code moves.
  Read-only work that yields a plan: what "done" means, the scope, the approach chosen,
  dependency order, how the work splits, the risks, and where the checkpoints sit.
  Use when opening a feature, a refactor, a migration, or any change that touches several
  files or whose approach is not obvious.
  Triggers on: "plan this", "how to approach", "where to start", feature, architecture,
  migration, refactoring, multi-file change.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-plan: decide the direction

**Step 1 of 6** in the `novahiz-planner` pipeline. Nothing in the application changes here. The product of this step is a plan.

Next: `novahiz-clarify`, then `novahiz-task`.

## When you arrive

The request already has a category. No file has been touched yet.

## Record the plan in the ledger

Log it where it survives context loss:

```
novahiz_task action="new"  title="<the request in one sentence>"
novahiz_task action="plan" todos=[...]
```

`todowrite` keeps the list visible on screen; `novahiz_task` keeps the durable record.

## What belongs in the plan

- **Done**: one sentence describing the final state anyone can observe.
- **Scope**: what you include, what you leave out.
- **Approach**: the route you picked, plus the routes you dropped and why each one lost.
- **Dependency order**: what has to exist before what.
- **Splitting strategy**: vertical slices by default; freeze contracts first when several consumers share an interface; attack the riskiest unknown first when one dominates.
- **Risks**: what each one costs and how you blunt it.
- **Checkpoints**: where you stop to prove progress.

## Stay read-only

Open the code, the manifests, the conventions already in the repo. You write nothing in this phase, not even a small fix to prepare the ground. A plan earns its keep by the rewrites it prevents.

## Order of work

Walk the dependency graph from the bottom up: foundations first, then the surface. An API sketched before its schema gets rewritten. A screen built before its API gets thrown away.

## Splitting strategies

**Vertical (default).** One slice crosses the layers you need and shows up working end to end. Shipping the whole database, then the whole API, then the whole screen leaves three streams nobody can use.

**Contract-first.** Several consumers share an interface: freeze the types and signatures, then let both sides move in parallel.

**Risk-first.** One unknown dominates: prove the shakiest piece before spending elsewhere.

## Ten categories require this step

The gate demands `novahiz-plan` for `code`, `flutter`, `expo`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops`, and `data`.

## Validate before you execute

A plan of any complexity does not start on assumed agreement. Put the load-bearing decision in front of the user with the `question` tool:

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

The plan itself lives in chat. The validation lives in the interface. They never replace each other.

## Next step

Choices still open on architecture, data, scope, or tests? Run `novahiz-clarify` first. Otherwise `novahiz-task` converts the plan into atomic tasks.

## Guardrails

- Begin with the target and the constraint; the files come later.
- No dependency order means the plan is still a wish.
- An open plan is never swapped in silence: same work gets updated in place, different work stops and asks.
- If every slice reads XL, the plan has not been cut.
- No checkpoints means nothing says when to stop.
- Announce nothing you have not verified. A direction given without reading the code is a guess.
