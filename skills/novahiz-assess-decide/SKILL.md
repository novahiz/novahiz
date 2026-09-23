---
name: novahiz-assess-decide
description: |
  novahiz-assess-decide is step 5 of the assessment roadmap: the go / no-go decision.
  Scored decision with rationale, terminal step of the assessment pipeline.
  Use after intake, research, define, and shape are complete.
  Triggers on: "should we build this", "go no-go", "decision", "kill this idea", "approve".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-assess-decide

**Step 5 of 5** in the assessment roadmap. No file changes here. The deliverable is a decision with rationale.

Previous step: `novahiz-assess-shape`. Next step: none, this is terminal.

## Entry

Intake, research, define, and shape are complete. The information needed for a call is on the table. Make the call.

## Decision framework

### 1. Score the dimensions

Rate each from 1 to 5:

| Dimension | Weight | Score | Weighted |
|---|---|---|---|
| Technical feasibility | 25% | ? | ? |
| Market opportunity | 25% | ? | ? |
| User demand | 20% | ? | ? |
| Resource fit | 15% | ? | ? |
| Risk level | 15% | ? | ? |

### 2. Thresholds

- Score at or above 4.0: go, build it.
- Score between 3.0 and 3.9: conditional go, build a prototype first.
- Score between 2.0 and 2.9: reconsider, the idea needs refinement.
- Score below 2.0: no-go, the idea is not viable as stated.

### 3. Present the options

Use the harness `question` tool:

```
question({
  questions: [
    {
      header: "Go / No-Go",
      question: "Based on the assessment, should we build this?",
      options: [
        { label: "Go (Recommended)", description: "Proceed to planning and implementation" },
        { label: "Prototype first", description: "Build a small proof-of-concept before committing" },
        { label: "Reconsider", description: "The idea needs refinement before proceeding" },
        { label: "No-go", description: "The idea is not viable as stated" }
      ]
    }
  ]
})
```

## Output

**Go:** the decision and rationale, the scorecard, the recommended next step (usually `novahiz-plan`), and the risks to watch.

**No-go:** the decision and rationale, the scorecard, what would have to change for a future go, and alternative directions worth exploring.

**Conditional:** the decision and rationale, the scorecard, the prototype scope, and the criteria for upgrading to a full go.

## Pitfalls

- Calling a decision without showing the scorecard.
- Skipping the rationale because a choice "feels right".
- Ignoring the dimensions that scored low.
- Presenting a single option in the question tool.
