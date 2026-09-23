---
name: novahiz-assess-define
description: |
  novahiz-assess-define is step 3 of the assessment roadmap: define the specification.
  Specification draft covering user-facing behavior, constraints, and success criteria.
  Use after research, before shaping the solution concept.
  Triggers on: "define the spec", "write a specification", "spec draft", "requirements".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-assess-define

**Step 3 of 5** in the assessment roadmap. No file changes here. The deliverable is a specification draft.

Previous step: `novahiz-assess-research`. Next step: `novahiz-assess-shape`.

## Entry

Research is done. Define what the solution does for its users, not how the code will be written.

## What to define

### 1. User-facing behavior

What does the user see, do, and experience? Write stories or scenarios.

### 2. Core capabilities

What must the solution do? List the essential features and leave the nice-to-haves out.

### 3. Success criteria

How do you know it works? Concrete outcomes tied back to the success signals from intake.

### 4. Scope boundaries

In scope, out of scope, and future.

### 5. Non-functional requirements

Performance, security, accessibility, scalability.

## Define method

Resolve remaining ambiguity with the harness `question` tool, following the `novahiz-clarify` pattern: sweep the risk families, then ask frontier batches.

```
question({
  questions: [
    {
      header: "<ambiguity>",
      question: "<why it matters for the spec>",
      options: [
        { label: "<recommended>", description: "<consequence>" },
        { label: "<option>", description: "<consequence>" }
      ]
    }
  ]
})
```

## Output

A specification draft with all five sections. Someone else should be able to read it and know exactly what to build, while implementation choices stay open.

The spec stays in the chat. Nothing is written to disk until decide produces the final version.

## Pitfalls

- Defining implementation detail instead of behavior.
- Listing every possible feature instead of the essential ones.
- Leaving out the "out of scope" section.
- Writing in jargon the user cannot check.
