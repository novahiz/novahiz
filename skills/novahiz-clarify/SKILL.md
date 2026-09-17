---
name: novahiz-clarify
description: |
  Step 2 of the Novahiz pipeline: remove ambiguities before locking the plan.
  Two combined mechanisms: an ambiguity sweep across risk families, and batches of
  questions ordered by dependencies (the frontier), each question numbered with a
  recommended answer.
  Use when the request is vague, underspecified, contradictory, or when several plausible
  readings lead to different work.
  Triggers on: "clarify", ambiguous, "not sure yet", fuzzy scope, missing requirements,
  "two possible readings", open questions.
license: MIT
compatibility: opencode
---

# novahiz-clarify: remove ambiguities

**Step 2 of 6** in the pipeline. You ask before the plan is locked.

Previous step: `novahiz-plan`. Next step: `novahiz-task`.

## Entry

Ambiguous, contradictory, or broad enough that two readings produce two different works.

## A. Sweep by families

Run the request through ten risk families. Mark each `clear`, `partial`, or `missing`.

1. Behavior and functional scope
2. Domain and data model
3. Flows and interactions
4. Non-functional qualities: performance, load, availability, security, accessibility, internationalization
5. External integrations and dependencies
6. Edge cases and failure handling
7. Constraints and tradeoffs
8. Terminology and consistency
9. Completion signals: what proves it is done
10. Fill zones and placeholder values

Any family left `missing` on scope, data, splitting, tests, UX, or operations becomes a question. The rest waits.

## B. Frontier batches, posed in the interface

Model decisions as a tree: each decision opens the ones that depend on it.

The **frontier** is the set of decisions whose prerequisites are already resolved, so they can be asked now without guessing. A batch is **one call** to the `question` tool, with one entry per frontier decision.

```
question({
  questions: [
    {
      header: "<short title, 30 chars max>",
      question: "<the decision, one sentence, with its stakes>",
      options: [
        { label: "<recommended option> (Recommended)", description: "<concrete consequence>" },
        { label: "<option>", description: "<concrete consequence>" },
        { label: "<option>", description: "<concrete consequence>" }
      ]
    }
  ]
})
```

Batch rules:

- **No prose questions in chat.** The interactive table is the only channel. Chat carries context, never the question list.
- Five questions maximum, ranked by cross-impact with uncertainty.
- Two to five options per question, mutually exclusive, each described by what it implies.
- The recommended option goes first and carries the `(Recommended)` suffix. The interface adds a free-response option automatically: do not add "Other" or a catch-all.
- `multiple: true` only when multiple answers can coexist.
- A question that depends on another still-open question belongs to a later batch.
- Each answer moves the frontier: recalculate it, then issue another call.
- Wait for the call return before continuing.

If the current harness does not expose a `question` tool, ask **one** question per turn, recommended option first, and wait. Never dump a list of questions at once.

Answer everything yourself that two read files can settle.

## Duty of critique

If the request is inconsistent, ambiguous, risky, or suboptimal, say so and propose an alternative. Staying silent leaves an error in place.

## Exit

A short list: open families, questions asked, answers received, decisions locked. Move to `novahiz-task` when the remaining open items no longer change architecture, data, tasks, tests, UX, or operations.

## Pitfalls

- Ask a comfort question about what is already stated in the request.
- Ask six questions when the frontier allows five.
- Ask about style or execution detail.
- Chain batches without re-reading answers to recalculate the frontier.
- Write questions in prose instead of opening the interactive table.
