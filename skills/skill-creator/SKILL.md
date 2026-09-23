---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.
license: Apache-2.0
compatibility: "Novahiz-authored skill; LICENSE.txt in this folder is Apache-2.0. Eval scripts need Python 3."
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Skill Creator

Build a skill from nothing, or sharpen one that already exists.

The loop looks like this:

- Pin down what the skill must do and roughly how
- Write a draft
- Invent a few realistic test prompts and run an agent that has the skill on them
- Review the results with the user, qualitatively and quantitatively
  - While runs are in flight, draft quantitative assertions if none exist yet (reuse or adjust existing ones when they already fit). Explain whatever set ends up in play to the user.
  - Use `eval-viewer/generate_review.py` so the user can flip through outputs and inspect the metrics
- Revise the skill from that feedback (and from any glaring hole the benchmark exposed)
- Repeat until both sides are happy
- Grow the test set and run again at larger scale

Your job is to locate the user somewhere on that loop and move them one step forward. "I want a skill for X" means: narrow the intent, draft, write tests, agree on evaluation, run everything, repeat. "Here's a draft" means jump straight to eval and iterate. "Skip the evals, just work with me" means do that instead.

Once the skill feels done (order stays flexible), offer the description improver: a separate script that tunes trigger accuracy.

Keep the user's vocabulary in mind. "Evaluation" and "benchmark" are usually fine. For "JSON" or "assertion," wait for real cues that the user already knows those words before using them bare. A one-line gloss when you are unsure costs almost nothing.

---

## Creating a skill

### Capture intent

Start from what the user wants. The conversation may already hold the workflow they want to capture ("turn this into a skill"): pull the tools used, the step order, the corrections they made, and the input/output shapes from history first, then fill gaps with them and confirm before moving on.

1. What should this skill let the agent do?
2. When should it fire? Which phrases and contexts?
3. What output shape is expected?
4. Do we want test cases? Skills with objectively checkable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from them. Subjective ones (writing style, art) often do not. Recommend a default that fits the skill type and leave the final call to the user.

### Interview and research

Ask proactively about edge cases, input/output formats, example files, success criteria, and dependencies. Hold off on test prompts until this is solid.

Check available MCPs. If any help with research (doc lookup, similar skills, best practices), run it in parallel via subagents when available, otherwise inline. Show up with context so the user does less work.

### Write the SKILL.md

Fill these fields from the interview:

- **name**: skill identifier
- **description**: what it does plus when to fire. This is the trigger mechanism itself; all "when to use" material belongs here, not in the body. Agents under-trigger on thin descriptions, so lean a little pushy: "How to build a simple fast dashboard to display internal company metrics. Use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, even if they never say 'dashboard.'"
- **compatibility**: required tools, dependencies (optional, rarely needed)
- **the rest of the skill**

### Skill writing guide

#### Anatomy of a skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled resources (optional)
    ├── scripts/    - executable code for deterministic/repetitive work
    ├── references/ - docs pulled into context only when needed
    └── assets/     - files used in output (templates, icons, fonts)
```

#### Progressive disclosure

Three loading layers:

1. **Metadata** (name + description): always in context (~100 words)
2. **SKILL.md body**: in context when the skill fires (under 500 lines ideal)
3. **Bundled resources**: on demand (unlimited; scripts run without loading)

Word counts are soft. Go longer when the content needs it.

**Key patterns:**
- Keep SKILL.md under 500 lines. Near that ceiling, add hierarchy and point clearly at where to go next.
- Reference files must be named from SKILL.md with guidance on when to open them.
- Large reference files (>300 lines) get a table of contents.

**Domain organization**: multi-domain skills split by variant:
```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
The agent reads only the file that matches.

#### No surprises

Skills never carry malware, exploit code, or anything that compromises system security. Their contents must not contradict what the description promises. Refuse requests for deceptive skills or anything that enables unauthorized access, data exfiltration, or other malicious ends. A "roleplay as an XYZ" framing is fine.

#### Writing patterns

Prefer the imperative in instructions.

**Defining output formats**:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern:** include them; when "Input" and "Output" would read stiff, vary the framing:
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### Writing style

Explain *why* things matter instead of stacking heavy MUSTs. Use theory of mind: keep the skill general, not pinned to one narrow example. Draft first, then reread with fresh eyes and tighten.

### Test cases

After the draft, invent 2-3 realistic prompts, the sort a real user would type. Show them: "Here are a few test cases I'd like to try. Do these look right, or do you want to add more?" Then run them.

Store prompts in `evals/evals.json`. No assertions yet, just prompts; those come while the runs are in flight.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

Full schema (including the `assertions` field added later): `references/schemas.md`.

## Running and evaluating test cases

One continuous sequence. Do not stop partway. Do NOT use `/skill-test` or any other testing skill.

Results live in `<skill-name>-workspace/`, a sibling of the skill directory. Inside: one directory per iteration (`iteration-1/`, `iteration-2/`, …), and inside that, one directory per test case (`eval-0/`, `eval-1/`, …). Create folders as you go, not upfront.

### Step 1: Spawn all runs (with-skill AND baseline) in the same turn

For each test case, spawn two subagents in the same turn: one with the skill, one without. Launch everything together so it finishes around the same time.

**With-skill run:**

```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- Outputs to save: <what the user cares about, e.g., "the .docx file", "the final CSV">
```

**Baseline run** (same prompt; baseline depends on context):
- **Creating a new skill**: no skill at all. Same prompt, no skill path, save to `without_skill/outputs/`.
- **Improving an existing skill**: the old version. Snapshot before editing (`cp -r <skill-path> <workspace>/skill-snapshot/`), point the baseline subagent at the snapshot, save to `old_skill/outputs/`.

Write an `eval_metadata.json` per test case (assertions can be empty for now). Give each eval a descriptive name tied to what it tests, not just "eval-0"; use that name for the directory too. New or modified prompts in a later iteration get fresh metadata files rather than assuming carry-over.

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": []
}
```

### Step 2: While runs are in progress, draft assertions

Do not idle. Draft quantitative assertions per test case and walk the user through them. If assertions already live in `evals/evals.json`, review and explain those.

Good assertions are objectively verifiable and named clearly enough that the benchmark viewer reads without a legend. Subjective skills (writing style, design quality) are better judged by a human; do not force assertions onto judgment calls.

Update `eval_metadata.json` and `evals/evals.json` once drafted. Tell the user what they will see in the viewer: qualitative outputs and quantitative benchmark.

### Step 3: As runs complete, capture timing data

When a subagent task finishes, the notification carries `total_tokens` and `duration_ms`. Save them at once to `timing.json` in the run directory:

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

That notification is the only chance to capture this: it is not persisted anywhere else. Process each one as it arrives.

### Step 4: Grade, aggregate, and launch the viewer

Once all runs are done:

1. **Grade each run**: spawn a grader subagent (or grade inline) that reads `agents/grader.md` and scores each assertion against the outputs. Save to `grading.json` in each run directory. The expectations array must use the fields `text`, `passed`, and `evidence` (not `name`/`met`/`details` or variants); the viewer depends on those exact names. Where a check is programmable, write and run a script instead of eyeballing it: faster, more reliable, reusable next iteration.

2. **Aggregate into benchmark**: run from the skill-creator directory:
   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```
   Produces `benchmark.json` and `benchmark.md` with pass_rate, time, and tokens per configuration, mean ± stddev, and the delta. Hand-built `benchmark.json` must match `references/schemas.md` exactly.
   Put each with_skill version immediately before its baseline counterpart.

3. **Analyst pass**: read the benchmark and surface what aggregates hide. See `agents/analyzer.md` ("Analyzing Benchmark Results"): assertions that always pass regardless of skill (non-discriminating), high-variance evals (possibly flaky), and time/token tradeoffs.

4. **Launch the viewer** with both qualitative and quantitative data:
   ```bash
   nohup python <skill-creator-path>/eval-viewer/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "my-skill" \
     --benchmark <workspace>/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```
   For iteration 2+, also pass `--previous-workspace <workspace>/iteration-<N-1>`.

   **Headless / no-display environments:** when `webbrowser.open()` is unavailable, use `--static <output_path>` to write a standalone HTML file instead of starting a server. Feedback downloads as `feedback.json` when the user clicks "Submit All Reviews"; copy that file into the workspace so the next iteration picks it up.

   Always create the viewer with generate_review.py; do not hand-roll HTML.

5. **Tell the user**, roughly: "I've opened the results in your browser. Two tabs: 'Outputs' walks each test case with feedback fields, 'Benchmark' shows the quantitative comparison. When you're done, come back here and let me know."

### What the user sees in the viewer

The "Outputs" tab shows one test case at a time:
- **Prompt**: the task that was given
- **Output**: the files the skill produced, rendered inline where possible
- **Previous Output** (iteration 2+): collapsed section with last iteration's output
- **Formal Grades** (if grading ran): collapsed assertion pass/fail
- **Feedback**: a textbox that auto-saves as they type
- **Previous Feedback** (iteration 2+): their comments from last time, under the textbox

The "Benchmark" tab holds the stats summary: pass rates, timing, token usage per configuration, with per-eval breakdowns and analyst notes.

Navigation is prev/next or arrow keys. "Submit All Reviews" writes everything to `feedback.json`.

### Step 5: Read the feedback

When the user says they are done, read `feedback.json`:

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "the chart is missing axis labels", "timestamp": "..."},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..."},
    {"run_id": "eval-2-with_skill", "feedback": "perfect, love this", "timestamp": "..."}
  ],
  "status": "complete"
}
```

Empty feedback means fine. Focus on the cases with real complaints.

Kill the viewer when finished:

```bash
kill $VIEWER_PID 2>/dev/null
```

---

## Improving the skill

Tests have run, the user has reviewed, now the skill has to get better.

### How to think about improvements

1. **Generalize from the feedback.** The skill will be invoked across many prompts, not only the handful under test. Those few exist because the user knows them cold and can judge them fast. A skill that only works for them is useless. When something stubborn resists a fix, branch into different metaphors or working patterns instead of stacking fiddly overfitted rules or oppressive MUSTs. Cheap to try; may land somewhere better.

2. **Keep the prompt lean.** Cut what is not pulling weight. Read the transcripts, not just final outputs: if the skill is steering the model into unproductive loops, remove the parts causing it and retest.

3. **Explain the why.** LLMs have solid theory of mind. Given a good harness they go past rote steps. Even when feedback is terse or frustrated, understand the real task and the user's intent, then carry that understanding into the instructions. All-caps ALWAYS/NEVER and rigid scaffolding are a yellow flag; reframe with the reasoning instead. More humane, more powerful, more effective.

4. **Look for repeated work across test cases.** If every subagent independently wrote a `create_docx.py` or `build_chart.py`, that is a strong signal the skill should bundle the script. Write it once under `scripts/` and tell the skill to use it; every future invocation stops reinventing it.

Thinking time is not the bottleneck here. Draft a revision, reread it fresh, improve again. Get into the user's head and understand what they actually need.

### The iteration loop

After improving:

1. Apply the changes to the skill
2. Rerun all test cases into `iteration-<N+1>/`, baselines included. New-skill baselines stay `without_skill` across iterations. When improving an existing skill, choose the baseline deliberately: the version the user arrived with, or the previous iteration.
3. Launch the reviewer with `--previous-workspace` pointing at the previous iteration
4. Wait for the user's review
5. Read the new feedback, improve, repeat

Stop when: the user is happy, feedback is all empty, or progress has stalled.

---

## Advanced: blind comparison

For a harder question ("is the new version actually better?"), use blind comparison. Read `agents/comparator.md` and `agents/analyzer.md` for the mechanics: hand two outputs to an independent agent without saying which is which, let it judge quality, then analyze why the winner won.

Optional, needs subagents, most users will not need it. The human loop usually suffices.

---

## Description optimization

The description field in frontmatter decides whether the agent loads the skill at all. After creating or improving a skill, offer to tune it for trigger accuracy.

### Step 1: Generate trigger eval queries

Twenty queries: a mix of should-trigger and should-not-trigger. Save as JSON:

```json
[
  {"query": "the user prompt", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

Queries must sound like something a real user would type: concrete, detailed, with file paths, job context, column names, company names, URLs, a little backstory. Some lowercase, some abbreviated, some typo-ridden. Mix lengths; favor edge cases over clean-cut ones (the user signs off anyway).

Bad: `"Format this data"`, `"Extract text from PDF"`, `"Create a chart"`

Good: `"ok so my boss just sent me this xlsx file (its in my downloads, called something like 'Q4 sales final FINAL v2.xlsx') and she wants me to add a column that shows the profit margin as a percentage. The revenue is in column C and costs are in column D i think"`

**Should-trigger** (8-10): coverage across phrasings of the same intent, formal and casual; cases where the user never names the skill or file type but clearly needs it; uncommon use cases; contests with a sibling skill this one should win.

**Should-not-trigger** (8-10): the valuable ones are near-misses sharing keywords or concepts with the skill but needing something else. Adjacent domains, ambiguous phrasings where naive keyword matching would fire wrongly, cases where the skill touches the topic but another tool fits better.

Avoid trivial negatives. `"Write a fibonacci function"` as a negative for a PDF skill tests nothing. Genuinely tricky negatives only.

### Step 2: Review with user

Present the eval set with the HTML template:

1. Read `assets/eval_review.html`
2. Replace the placeholders:
   - `__EVAL_DATA_PLACEHOLDER__` → the JSON array of eval items (JS variable assignment, no extra quotes)
   - `__SKILL_NAME_PLACEHOLDER__` → the skill's name
   - `__SKILL_DESCRIPTION_PLACEHOLDER__` → the current description
3. Write to a temp file (e.g. `/tmp/eval_review_<skill-name>.html`) and open it: `open /tmp/eval_review_<skill-name>.html`
4. The user edits queries, toggles should-trigger, adds/removes entries, clicks "Export Eval Set"
5. The file downloads to `~/Downloads/eval_set.json`; take the newest if there are several (e.g. `eval_set (1).json`)

Bad queries produce bad descriptions. This step earns its keep.

### Step 3: Run the optimization loop

Warn the user: this takes a while and runs in the background with periodic updates.

Save the eval set to the workspace, then:

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```

Use the model ID from your own system prompt so the trigger test matches what the user experiences.

While it runs, tail the output and report iteration numbers and scores.

The loop handles everything: splits 60% train / 40% held-out test, evaluates the current description (3 runs per query for a reliable rate), asks the model to propose improvements from the failures, re-evaluates each candidate on both splits, up to 5 iterations. Finishes by opening an HTML report and returning JSON with `best_description`, selected by *test* score to avoid overfitting.

### How skill triggering works

Skills appear in `available_skills` with name + description; the agent decides whether to consult one purely from that text. Important: the agent only consults skills for tasks it cannot easily handle alone. Simple one-step queries like "read this PDF" may never fire a skill even on a perfect description. Complex, multi-step, specialized queries fire reliably when the description matches.

So eval queries must be substantive enough that a skill would actually help. "read file X" is a poor test case regardless of description quality.

### Step 4: Apply the result

Take `best_description` from the JSON and update SKILL.md frontmatter. Show before/after and report the scores.

---

### Package and Present (only if `present_files` tool is available)

Check for the `present_files` tool. If absent, skip. If present:

```bash
python -m scripts.package_skill <path/to/skill-folder>
```

Point the user at the resulting `.skill` file so they can install it.

---

## Environment-specific notes

The core workflow (draft → test → review → improve → repeat) holds everywhere. Adapt mechanics when the environment lacks pieces:

**No subagents (single-threaded chat):** for each test case, read the skill's SKILL.md and follow its instructions yourself, one at a time. Less rigorous (you wrote the skill and you are running it), but useful as a sanity check; the human review step compensates. Skip baselines; just complete the task with the skill.

**No browser / no display:** skip the browser reviewer. Present results in conversation: prompt and output per test case. For files the user needs (`.docx`, `.xlsx`), save to the filesystem and say where. Ask inline: "How does this look? Anything you'd change?"

**No baseline comparison:** quantitative benchmarking leans on baselines; without subagents it is not meaningful. Lean on qualitative user feedback.

**Iteration loop without a viewer:** same loop, feedback collected in-conversation or from files on disk.

**Description optimization:** needs the `claude` CLI (`claude -p`). Skip when it is unavailable.

**Blind comparison:** needs subagents. Skip.

**Packaging:** `package_skill.py` only needs Python and a filesystem; run it and hand the user the `.skill` file.

**Updating an existing skill:**
- **Preserve the original name.** Note the directory name and `name` frontmatter and reuse them unchanged. An installed `research-helper` packages as `research-helper.skill`, never `research-helper-v2`.
- **Copy to a writable location before editing.** Installed paths may be read-only. Copy to `/tmp/skill-name/`, edit there, package from the copy.
- **Stage in `/tmp/` first** when packaging manually, then copy to the output directory; direct writes may fail on permissions.

---

## Headless / remote environments

- Subagents present: main workflow (parallel tests, baselines, grading) all works. On severe timeouts, serial is acceptable.
- No display: generate the eval viewer with `--static <output_path>` and hand the user a link to open the HTML themselves.
- After running tests, always generate the eval viewer with `generate_review.py` *before* grading inputs yourself; get examples in front of the human first. Do not hand-write boutique HTML.
- Feedback without a running server: "Submit All Reviews" downloads `feedback.json`; read it from there (request access if prompted).
- Packaging works: `package_skill.py` needs only Python and a filesystem.
- Description optimization (`run_loop.py` / `run_eval.py`) works headless via `claude -p` subprocess, no browser required. Save it until the skill itself is finished and the user agrees it is in shape.
- **Updating an existing skill**: same guidance as above.

---

## Reference files

The agents/ directory holds instructions for specialized subagents. Read them when spawning one:

- `agents/grader.md`: how to evaluate assertions against outputs
- `agents/comparator.md`: how to do blind A/B comparison between two outputs
- `agents/analyzer.md`: how to analyze why one version beat another

The references/ directory has more documentation:
- `references/schemas.md`: JSON structures for evals.json, grading.json, and friends

---

The core loop, one more time:

- Figure out what the skill is about
- Draft or edit the skill
- Run an agent with the skill on test prompts
- With the user, evaluate the outputs:
  - Create benchmark.json and run `eval-viewer/generate_review.py` so they can review
  - Run quantitative evals
- Repeat until you and the user are satisfied
- Package the final skill and hand it back

Track steps in your TodoList so nothing slips. In headless environments, put "Create evals JSON and run `eval-viewer/generate_review.py` so human can review test cases" in the list explicitly so it cannot be skipped.
