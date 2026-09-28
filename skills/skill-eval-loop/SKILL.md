---
name: "skill-eval-loop"
description: "Measure whether an agent skill actually helps: prompt sets with should/should-not trigger, with/without skill runs, deterministic checks, rubric grading, CI regressions. Use when hardening a SKILL.md, deciding if a rewrite improved quality, or adding a quality gate for skills."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# skill-eval-loop

Skill quality is a measured delta, not a feeling. Define done, run with and without the skill, score, and keep the score across versions.

## What an eval is

`prompt → captured run (trace + artifacts) → checks → score you can compare over time`

Three layers, cheapest first:

1. **Deterministic checks**: files exist, commands ran in order, JSONL events, exit codes.
2. **Rubric / judge**: qualitative structure and style; schema-constrained JSON output; blind to which condition produced the text when comparing A/B.
3. **Regression diff**: baseline snapshot vs current; fail CI when score or trigger rate drops past a threshold.

## Prompt set

Start with 10-20 rows, grow from real failures.

| Column | Meaning |
|---|---|
| id | stable key |
| prompt | user-style request |
| expect_trigger | yes / no |
| must_steps | commands or artifacts that prove success (optional) |
| must_not | failures that count as regression |

Include negative prompts (nearby topics that must not load the skill). Without negatives, a broader description always looks “better” until production noise appears.

## Trigger testing

- Explicit load: invoke the skill directly; fix the **body** if output is wrong.
- Implicit load: paraphrase the user ask without naming the skill; fix the **description** if it never fires.
- Over-trigger: unrelated prompts must not load it; narrow description or add a do-not-use clause.

Description problems look like body problems until you separate these two tests.

## With / without skill

For quality claims, run each prompt twice under the same model and temperature: skill injected vs not. Score both with the same judge and rubric. Report mean, spread, and delta. Overlapping spreads at low N mean “add runs,” not “no effect.”

- Development: 3 runs per prompt.
- Decision-grade: 10+ runs, 1-3 judges, judge temperature near 0.
- Judge sees rubric + output; ideally not which arm is which.

## Deterministic traces

Prefer harnesses that emit JSONL events (command executions, file writes). Assert on:

- required commands present and ordered
- forbidden commands absent
- artifact paths exist
- no extra files outside allowed set

These fail fast and explain themselves without another model call.

## Rubric grading

When checks cannot see “is this good structure,” add a second pass that only reads the repo (or the answer) and returns a fixed schema: `overall_pass`, `score`, per-check ids. Same schema every version so you can diff fields, not prose.

## CI gate

```text
baseline.json  +  current run  →  report diff  →  fail on:
  - trigger rate drop on should-trigger set
  - any must_steps regression
  - composite score drop > agreed epsilon
```

Keep the baseline in-repo or artifact storage. Update baseline only in the PR that intentionally changes behavior, with a note.

## Loop

1. Manual explore: force the skill, list every miss.
2. Turn each miss into a row (should or should-not).
3. Freeze deterministic checks.
4. Add rubric only where rules cannot.
5. Record baseline; wire CI.
6. On every SKILL.md edit, run the set before merge.

## Checklist

- [ ] Definition of done written before prompts.
- [ ] Mix of trigger and non-trigger prompts.
- [ ] With/without arm for quality claims.
- [ ] Deterministic checks cover steps and artifacts.
- [ ] Rubric JSON schema stable across versions.
- [ ] Baseline + diff in CI.
- [ ] New failures always become new rows.

## Sources

OpenAI developer guidance on skill evals (JSONL traces, schema rubrics, small prompt sets); SkillBenchmark / SkillsBench style with-vs-without and blind judging; arXiv framework for skill utility evaluation. Original Novahiz synthesis.
