---
name: novahiz-assess-shape
description: |
  novahiz-assess-shape is step 4 of the assessment roadmap: shape the solution concept.
  Solution concept covering architecture, experience, and differentiation.
  Use after the specification is defined, before the go / no-go decision.
  Triggers on: "shape the solution", "solution concept", "how should this work",
  "design the approach".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-assess-shape

**Step 4 of 5** in the assessment roadmap. No file changes here. The deliverable is a solution concept.

Previous step: `novahiz-assess-define`. Next step: `novahiz-assess-decide`.

## Entry

The spec is set. Shape the concept: what it looks like, how it works, and what sets it apart.

## What to shape

### 1. Solution architecture

How does it hang together at a high level? Which main components, and how do they interact?

### 2. Key design decisions

Which three to five choices move the outcome the most? For each, list the options and the recommended pick.

### 3. Differentiation

What does this do that existing alternatives do not? What is the unique value?

### 4. MVP scope

What is the smallest version that still delivers value? What can be cut without losing the core benefit?

### 5. Build strategy

Incremental or big bang? What is the first slice that proves the approach?

## Shape method

Settle design decisions through the harness `question` tool, following the `novahiz-plan` pattern: target first, then approach, then risks.

```
question({
  questions: [
    {
      header: "<design decision>",
      question: "<what you need to decide and why>",
      options: [
        { label: "<recommended>", description: "<consequence>" },
        { label: "<option>", description: "<consequence>" }
      ]
    }
  ]
})
```

## Output

A solution concept with all five sections. Specific enough for decide to call go or no-go, abstract enough that implementation stays flexible.

The concept stays in the chat. Nothing is written to disk until decide produces the final version.

## Pitfalls

- Shaping before the spec is defined.
- Taking the first architecture that comes to mind.
- Skipping MVP scope with "we need everything".
- Making design calls without showing the alternatives.
