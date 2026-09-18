---
name: skillenforce-clarify
description: |
  Step 2 of the skillenforce pipeline: resolve ambiguities before finalizing the plan.
  Two combined mechanisms: an ambiguity sweep by risk families, and ordered question
  batches by dependencies (the frontier), each question numbered with a recommended
  answer.
  Use when the request is vague, underspecified, contradictory, or when several plausible
  readings lead to different work.
  Triggers on: "clarify", ambiguous, "I don't know yet", unclear scope, missing
  requirements, "two possible readings", open questions.
license: MIT
compatibility: opencode
---

# skillenforce-clarify: resolve ambiguities

**Step 2 of 6** in the pipeline. You ask questions before the plan is finalized.

Previous step: `skillenforce-plan`. Next step: `skillenforce-task`.

## Entry

A request that is ambiguous, contradictory, or broad enough that two readings lead to different work.

## A. Sweep by families

Run the request through ten risk families. Note each one as `clear`, `partial`, or `missing`.

1. Behavior and functional scope
2. Domain and data model
3. Pathways and interactions
4. Non-functional qualities: performance, load, availability, security, accessibility, internationalization
5. External integrations and dependencies
6. Edge cases and failure handling
7. Constraints and trade-offs
8. Terminology and consistency
9. Completion signals: what proves it's finished
10. Fill-in areas and provisional values

A family left `missing` on scope, data, splitting, tests, UX, or operations becomes a question. The rest waits.

## B. Frontier batches, asked in the interface

Model decisions as a tree: each decision opens the ones that depend on it.

The **frontier** is the set of decisions whose prerequisites are already settled, so they can be asked now without guessing. A batch is **a single call** to the harness `question` tool, with one entry per frontier decision.

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

- **No prose questions in chat.** The interactive table is the only channel. The chat carries context, never the list of questions.
- At most five questions, ranked by crossed impact with uncertainty.
- Two to five options per question, mutually exclusive, each described by what it implies.
- The option you recommend comes first and carries the `(Recommended)` suffix. The interface adds a free-response field on its own: add neither "Other" nor a catch-all option.
- `multiple: true` only when multiple answers can coexist.
- A question that depends on another still-open question belongs to a later batch.
- Each answer shifts the frontier: recalculate it, then trigger the next call.
- You wait for the call's return before continuing.

If the current harness does not expose a `question` tool, ask **one** question per turn, recommendation first, and wait. Never dump a list of questions at once.

Answer for yourself anything that two read files are enough to settle.

## Duty of criticism

If the request is incoherent, ambiguous, risky, or suboptimal, say so and propose an alternative. Keeping silent lets an error stay in place.

## Output

A short list: open families, questions asked, answers received, settled decisions. You move to `skillenforce-task` when the remaining open items no longer change the architecture, data, tasks, tests, UX, or operations.

## Pitfalls

- Asking a comfort question about something already written in the request.
- Asking six questions where the frontier allows five.
- Asking about style or execution detail.
- Chaining batches without re-reading answers to recalculate the frontier.
- Writing questions in prose instead of opening the interactive table.
