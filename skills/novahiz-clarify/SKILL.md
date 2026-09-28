---
name: novahiz-clarify
description: |
  novahiz-clarify, step 2 of the Novahiz pipeline: resolve ambiguities before the plan locks.
  Two moves run together: a sweep of ten risk families, then batches of questions laid out
  along the dependency frontier, each one carrying a recommended option.
  Use when the request is vague, underspecified, contradictory, or when several readings
  would produce different work.
  Triggers on: "clarify", ambiguous, "not sure yet", fuzzy scope, missing requirements,
  "two possible readings", open questions.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-clarify: remove ambiguities

**Step 2 of 6** in the pipeline. Questions come before anything gets locked.

Previous: `novahiz-plan`. Next: `novahiz-task`.

## When you arrive

The request is contradictory, loose, or broad enough that two readings lead to two different bodies of work.

## Part 1: sweep the ten families

Run the request through these risk families and tag each one `clear`, `partial`, or `missing`:

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

A family still `missing` on scope, data, splitting, tests, UX, or operations becomes a question. Everything else waits.

## Part 2: frontier batches in the interface

Picture the open decisions as a tree: each answer unlocks the choices that hang off it.

The **frontier** holds the decisions whose inputs already exist, so you can ask them without guessing. One batch equals one call to the `question` tool, with one entry per frontier decision.

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

- **Questions never appear as chat prose.** The interactive table is the channel. Chat carries context; the question list stays in the interface.
- Five questions at most, ordered by how far an answer moves the rest of the work while staying uncertain.
- Two to five options per question. They exclude each other, and each one names what choosing it costs.
- The recommended option sits first with the `(Recommended)` suffix. The interface appends a free-response choice on its own, so do not add "Other" or a catch-all.
- Set `multiple: true` only when several answers can hold at once.
- A decision that leans on another still-open one belongs to a later batch.
- Every answer shifts the frontier. Recompute it, then call again.
- Wait for the call to return before moving on.

Without a `question` tool in the harness, ask one question per turn, recommended option first, then wait. Never unload the whole list into chat.

Anything two opened files can settle, you answer yourself.

## You owe a critique

An inconsistent, ambiguous, risky, or weak request gets called out, with a better option put on the table. Silence lets the flaw through.

## Exit

A short account: families still open, questions asked, answers in, decisions fixed. Move to `novahiz-task` when nothing left open would change architecture, data, tasks, tests, UX, or operations.

## Pitfalls

- Asking about something the request already states.
- Six questions when the frontier allows five.
- Quizzing style or execution minutiae.
- Chaining batches without recomputing the frontier from the new answers.
- Pasting the questions into chat instead of opening the table.
