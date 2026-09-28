---
name: novahiz-assess-research
description: |
  novahiz-assess-research is step 2 of the assessment roadmap: investigate feasibility
  and market. Research report covering technical feasibility, competitive landscape, and
  whether the idea should be built. Use after intake, before defining a specification.
  Triggers on: "research this idea", "feasibility", "market research", "competitive landscape",
  "should we build this".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-assess-research

**Step 2 of 5** in the assessment roadmap. No file changes here. The deliverable is a research report.

Previous step: `novahiz-assess-intake`. Next step: `novahiz-assess-define`.

## Entry

The idea is captured. Now find out whether it can be built, whether it should be built, and what the landscape looks like.

## Research dimensions

### 1. Technical feasibility

Can the available tools and skills build it? What technical risks sit in the way? Which integrations are required? What is the rough complexity: trivial, lite, or full?

### 2. Market landscape

Who else ships something similar? What alternatives exist today? What gaps do they leave? Where is the positioning opportunity?

### 3. User validation

Do people actually hit this problem? How do they cope right now? What would make them switch? Where do these users gather: forums, communities, marketplaces?

### 4. Resource requirements

Which skills or people are needed? What is the effort ballpark? What are the dependencies? What can ship incrementally, and what has to exist on day one?

### 5. Risk factors

What could go wrong? What are the blockers? Which external systems does this hang on? Any compliance or regulatory angle?

## Research method

Pull web material through `novahiz-web-extract`. Ask the user about domain knowledge you cannot get elsewhere with the harness `question` tool:

```
question({
  questions: [
    {
      header: "<research gap>",
      question: "<what you need to know and why>",
      options: [
        { label: "<recommended>", description: "<consequence>" },
        { label: "<option>", description: "<consequence>" }
      ]
    }
  ]
})
```

## Output

A report with five sections, one per dimension. Each section states what you found, what you could not determine, and which assumptions you made. Cite sources where you can.

The report stays in the chat. Nothing is written to disk until decide produces a spec.

## Pitfalls

- Researching everything before asking the user a single question.
- Treating "someone built this" as "this problem is solved".
- Skipping the landscape because the idea feels unique.
- Dumping raw findings without a synthesis.
