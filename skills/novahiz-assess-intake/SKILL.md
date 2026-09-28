---
name: novahiz-assess-intake
description: |
  novahiz-assess-intake is step 1 of the assessment roadmap: capture the idea before
  judging it. Read-only structured capture of a feature request, product concept, or vague idea.
  Use when the user presents a new idea, feature request, or product concept that needs
  to be captured cleanly before research or specification.
  Triggers on: "new idea", "capture this feature", "assess", "intake", "product concept".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-assess-intake

**Step 1 of 5** in the assessment roadmap. No file changes here. The deliverable is a clean capture of the idea.

Previous step: none, this is the entry. Next step: `novahiz-assess-research`.

## Entry

The user brings an idea, a feature request, or a product concept. It may be vague, partial, or self-contradictory. Capture it cleanly. Judging comes later.

## What to capture

### 1. Core statement

One sentence: what it does, for whom, and why it matters.

### 2. Problem statement

What pain, gap, or opportunity does it address? What happens if nothing is built?

### 3. Target audience

Who benefits? "Developers" is too broad. "React developers who deploy to Vercel" is actionable.

### 4. Initial scope boundaries

Clearly in, clearly out, and still uncertain.

### 5. Constraints known so far

Timeline, budget, and people. Platform, stack, and integrations. Compliance and market timing.

### 6. Success signals

Concrete, measurable outcomes that would prove the idea works.

## Capture method

Use the harness `question` tool. One batch, ranked by impact on the later spec:

```
question({
  questions: [
    {
      header: "<what's missing>",
      question: "<why it matters for the assessment>",
      options: [
        { label: "<recommended>", description: "<consequence>" },
        { label: "<option>", description: "<consequence>" }
      ]
    }
  ]
})
```

Batch rules: at most five questions, two to five mutually exclusive options each, recommended option first with the `(Recommended)` suffix, `multiple: true` only when answers can coexist.

## Duty of criticism

If the idea is incoherent, contradictory, or clearly unviable, say so now rather than at the decide step. A rough idea captured cleanly still has a chance. A bad idea polished into shape does not.

## Output

A structured capture with all six sections. When the user already supplied everything, the output is a summary to confirm. When questions are needed, they flow through the question tool.

The capture stays in the chat. Nothing is written to disk until decide produces a spec.

## Pitfalls

- Capturing the words instead of the intent.
- Asking a pile of questions before confirming the core idea.
- Inventing technical detail the user never mentioned.
- Skipping the problem statement because the user already named a feature.
- Treating the intake as the final spec.
