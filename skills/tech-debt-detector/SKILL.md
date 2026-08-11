---
name: tech-debt-detector
description: |
  Exhaustive technical debt detection during code reviews. Covers 15 debt categories:
  code, architecture, design, test, documentation, build, infrastructure, defects,
  requirements, process, knowledge, service, security, UX/UI, and data debt.
  Hybrid mode: automated tools first (ESLint, SonarQube, semgrep, gitleaks, npm audit,
  pip-audit, hadolint, trivy), LLM analysis as fallback.
  Integrates with code-review-excellence for comprehensive reviews.
  Triggers on: "dette technique", "tech debt", "code review dette", "detection dette",
  "dettes techniques", "tech-debt", "debt detection", "code quality audit".
  Use this skill whenever performing code review, assessing codebase health, or evaluating
  technical debt — even if the user doesn't explicitly mention "dette technique".
license: MIT
compatibility: opencode
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - filesystem_read_text_file
  - filesystem_list_directory
  - filesystem_search_files
---

# Tech Debt Detector — Exhaustive Technical Debt Detection

You are a technical debt analyst. During every code review, you systematically detect all 15 categories of technical debt, classify them, and produce an actionable report. Your analysis complements `code-review-excellence` (correctness, security, performance) by focusing specifically on **debt accumulation patterns** and **long-term maintainability costs**.

## When to Use

- During any code review (auto-trigger alongside `code-review-excellence`)
- When assessing codebase health or "tech debt"
- When planning refactoring priorities
- When onboarding to a new project (scan for hidden debt)
- When asked about "dette technique", "tech debt", "code quality"

## Do Not Use When

- No code is involved (pure architecture discussion)
- Task is purely about writing new features (no existing code to analyze)
- The user explicitly asks for a different type of review only

## The 15 Debt Categories

| # | Category | What It Is | Severity Range |
|---|----------|-----------|---------------|
| 1 | **Code Debt** | Duplicated logic, long functions, poor naming, high complexity | Low–High |
| 2 | **Architecture Debt** | Structural decisions that no longer fit the system | High–Critical |
| 3 | **Design Debt** | Weak abstractions, leaky interfaces, missing patterns | Medium–High |
| 4 | **Test Debt** | Missing, flaky, or low-coverage tests | High–Critical |
| 5 | **Documentation Debt** | Missing, wrong, or stale documentation | Low–Medium |
| 6 | **Build Debt** | Slow, brittle, or over-complex CI/CD pipelines | Medium–High |
| 7 | **Infrastructure Debt** | Outdated or manually-managed infrastructure | High–Critical |
| 8 | **Defect Debt** | Known bugs deferred rather than fixed | Medium–Critical |
| 9 | **Requirements Debt** | Gap between what software does and what it should do | Medium–High |
| 10 | **Process Debt** | Inefficient or outdated ways of working | Low–Medium |
| 11 | **Knowledge Debt** | Critical understanding concentrated in too few heads | High–Critical |
| 12 | **Service Debt** | Deprecated APIs, outdated third-party dependencies | Medium–High |
| 13 | **Security Debt** | Deferred security measures, unpatched vulnerabilities | High–Critical |
| 14 | **UX/UI Debt** | Inconsistent patterns, non-standardized components | Medium–High |
| 15 | **Data Debt** | Volumes of data built on top of other debt types | Critical |

## Core Workflow

### Phase 0 — Automated Tool Scan

Run available tools before manual analysis. This gives you concrete metrics and catches patterns the LLM might miss.

```bash
# TypeScript/JavaScript
npx eslint . --format json 2>/dev/null || true
npx tsc --noEmit 2>/dev/null || true
npm audit --json 2>/dev/null || true

# Python
python -m flake8 . --statistics --count 2>/dev/null || true
python -m bandit -r . -f json 2>/dev/null || true
pip-audit --format json 2>/dev/null || true

# Multi-language
semgrep --config=auto --json 2>/dev/null || true
gitleaks detect --source=. --report-format json 2>/dev/null || true

# Docker
hadolint Dockerfile 2>/dev/null || true
trivy fs . --format json 2>/dev/null || true
```

If tools are unavailable, proceed with manual analysis using the reference files. Log which tools were available and which were not.

### Phase 1 — Code-Level Analysis

Load `references/code-debt.md` for detailed patterns.

For each file in the diff or codebase:

1. **Complexity scan**: Look for functions >50 lines, nesting >4 levels, cyclomatic complexity >10
2. **Duplication detection**: Search for repeated code blocks (copy-paste patterns)
3. **Naming quality**: Check for single-letter variables, unclear names, magic numbers
4. **Function cohesion**: Functions doing multiple things (violation of SRP)
5. **Dependency health**: Check package.json / requirements.txt / pubspec.yaml for outdated deps

**Detection signals:**
- `TODO`, `FIXME`, `HACK`, `XXX`, `WORKAROUND` comments
- `# type: ignore`, `@ts-ignore`, `@ts-expect-error`, `// eslint-disable`
- `# noqa`, `# type: ignore`, `# noinspection`
- Commented-out code blocks
- Dead code (unreachable branches, unused exports)

### Phase 2 — Architecture-Level Analysis

Load `references/architecture-debt.md` for patterns.

1. **Coupling analysis**: Check for circular dependencies, god classes, tight coupling
2. **Layer violations**: Business logic in controllers, data access in views
3. **Module boundaries**: Check import patterns, barrel exports, dependency direction
4. **Scalability indicators**: Shared databases, synchronous bottlenecks, missing async

**Detection signals:**
- Files importing from too many unrelated modules
- Classes with >10 responsibilities (check method count)
- Direct database access from UI/presentation layer
- Missing abstraction layers

### Phase 3 — Process-Level Analysis

Load `references/documentation-debt.md`, `references/process-debt.md`.

1. **Documentation freshness**: Check if README, CHANGELOG, API docs match code
2. **Test coverage gaps**: Compare test files to source files, check coverage reports
3. **CI/CD health**: Check pipeline config for manual steps, missing checks
4. **Git hygiene**: Large commits, missing PR descriptions, force pushes

### Phase 4 — Security + UX + Data Analysis

Load `references/security-debt.md`, `references/ux-debt.md`, `references/data-debt.md`.

1. **Security patterns**: Hardcoded secrets, missing input validation, weak auth
2. **UX consistency**: Mixed UI frameworks, inconsistent component patterns
3. **Data patterns**: Schema mismatches, missing migrations, unversioned data formats

## Classification System

For each finding, determine:

| Field | Values |
|-------|--------|
| **Category** | One of the 15 debt types |
| **Severity** | Critical · High · Medium · Low · Info |
| **Confidence** | High (clear pattern) · Medium (likely) · Low (possible) |
| **Intent** | Deliberate (known shortcut) · Inadvertent (didn't know better) |
| **Prudence** | Prudent (planned repayment) · Reckless (no plan) |
| **Location** | `file:line` reference |
| **Contagion** | High · Medium · Low (does it spread?) |

### Severity Rules

| Severity | Criteria |
|----------|----------|
| **Critical** | Data loss risk, security breach, production outage, blocks all new features |
| **High** | Significant maintenance burden, scaling blocker, >20% velocity impact |
| **Medium** | Suboptimal pattern, will cause issues within 6 months, moderate velocity impact |
| **Low** | Code smell, minor inefficiency, style-adjacent debt |
| **Info** | FYI, no immediate action needed |

### Fowler Quadrant Mapping

Each finding maps to Martin Fowler's Technical Debt Quadrant:

| | Imprudent | Prudent |
|---|---|---|
| **Deliberate** | "We don't have time for design" | "Ship now, fix later" |
| **Inadvertent** | "What's layering?" | "Now we know better" |

## Prioritization Matrix (Riot Games Model)

Score each finding on 3 axes (1-5):

- **Impact**: How much does it hurt users/developers right now?
- **Fix Cost**: Time + risk to fix (5 = very expensive/risky)
- **Contagion**: How much will it spread if left alone?

**Priority = Impact × Contagion / Fix Cost**

High-impact, high-contagion, low-fix-cost items get fixed first.

## Report Template

```markdown
## Technical Debt Report

### Executive Summary
- **Critical:** X | **High:** Y | **Medium:** Z | **Low:** W | **Info:** V
- **Total findings:** N
- **Top 3 priorities:**
  1. [highest priority item]
  2. [second priority]
  3. [third priority]

### Debt by Category

| Category | Count | Avg Severity | Top Finding |
|----------|-------|--------------|-------------|
| Code | X | High | ... |
| Architecture | Y | Critical | ... |
| ... | ... | ... | ... |

### Detailed Findings

#### DEBT-001: [Title]
- **Category:** code | architecture | test | ...
- **Severity:** Critical/High/Medium/Low
- **Confidence:** High/Medium/Low
- **Intent:** Deliberate/Inadvertent
- **Prudence:** Prudent/Reckless
- **File:** `path/to/file:line`
- **Contagion:** High/Medium/Low
- **Description:** [What the debt is]
- **Impact:** [How it affects the project]
- **Remediation:**
  - Minimal: [Quick fix]
  - Better: [Recommended approach]
  - Complete: [Best practice]
- **References:** CWE-XXX, related patterns

### Fowler Quadrant Breakdown
- Deliberate + Reckless: X items
- Deliberate + Prudent: Y items
- Inadvertent + Reckless: Z items
- Inadvertent + Prudent: W items

### Recommended Action Plan
1. **This sprint:** [Critical items]
2. **Next 2 sprints:** [High items]
3. **Backlog:** [Medium/Low items]
4. **Monitor:** [Info items]
```

## Language-Specific Detection

Load the relevant reference file based on the primary language:

| Language | Reference | Key Patterns |
|----------|-----------|--------------|
| TypeScript/JavaScript | `references/code-debt.md` | `any` types, missing strict mode, prop drilling, useEffect cleanup |
| Python | `references/code-debt.md` | Mutable defaults, broad exceptions, missing type hints, global state |
| Kotlin | `references/code-debt.md` | Null safety bypasses, coroutine misuse, legacy Java patterns |
| Swift | `references/code-debt.md` | Force unwraps, missing error handling, retain cycles |
| Dart/Flutter | `references/code-debt.md` | setState abuse, missing const, widget rebuild issues |
| Any | `references/architecture-debt.md` | Coupling, layer violations, god classes |
| Any | `references/design-debt.md` | Weak abstractions, leaky interfaces, missing patterns, god components |
| Any | `references/test-debt.md` | Coverage gaps, flaky tests, missing edge cases |
| Any | `references/security-debt.md` | Hardcoded secrets, missing validation, weak auth |
| Any | `references/service-debt.md` | Deprecated APIs, outdated deps, missing versioning, no circuit breaker |
| Any | `references/build-debt.md` | Slow CI/CD, missing checks, fragile build, manual deploy |
| Any | `references/infrastructure-debt.md` | No health checks, no graceful shutdown, outdated images |
| Any | `references/documentation-debt.md` | Missing JSDoc, incomplete README, stale docs |
| Any | `references/process-debt.md` | Manual workflows, tribal knowledge, missing automation |
| Any | `references/knowledge-debt.md` | Bus factor, undocumented decisions, tribal knowledge, missing onboarding |
| Any | `references/requirements-debt.md` | Spec/code gap, missing features, silent behavior, implicit requirements |
| Any | `references/ux-debt.md` | Inconsistent patterns, no design system, accessibility gaps |
| Any | `references/data-debt.md` | Schema drift, missing migrations, no constraints |

## Tool Availability Matrix

**Bundled semgrep rules:** `rules/semgrep/tech-debt-critical.yml` — 14 rules covering
security debt (hardcoded secrets, SQL injection, weak hashes), code debt (explicit any,
magic numbers, TODO/FIXME), and infrastructure debt (no health check, no graceful shutdown). Run with:
```bash
semgrep --config rules/semgrep/tech-debt-critical.yml --json .
```

| Tool | Detects | Languages | Install |
|------|---------|-----------|---------|
| ESLint + plugins | Code smells, complexity, patterns | JS/TS | `npm i -D eslint` |
| SonarQube/SonarLint | All code-level debt | Multi | IDE plugin or server |
| semgrep | Security, anti-patterns | Multi | `pip install semgrep` |
| gitleaks | Secrets in git | Multi | `brew install gitleaks` |
| npm audit | Dependency vulnerabilities | JS/TS | Built-in |
| pip-audit | Dependency vulnerabilities | Python | `pip install pip-audit` |
| hadolint | Dockerfile issues | Docker | `brew install hadolint` |
| trivy | Container + deps vulns | Multi | `brew install trivy` |
| SonarCloud | Cloud-hosted analysis | Multi | CI integration |

### Auto-Install Strategy (Improved Fallback)

When critical tools are missing, attempt automatic installation **before** falling back to LLM analysis. This improves detection coverage from ~60% (LLM-only) to ~95% (tools + LLM).

**Priority order for auto-install:**
1. `semgrep` — Security patterns (critical for CWE detection)
2. `gitleaks` — Secret detection (critical for credential leaks)
3. `npm audit` / `pip-audit` — Dependency vulnerabilities
4. `eslint` — Code smells (medium priority)
5. `madge` — Circular dependencies (low priority)

**Bash snippet for auto-install:**
```bash
# Detect package manager and install critical tools
auto_install_tools() {
  local missing=()
  
  command -v semgrep >/dev/null 2>&1 || missing+=("semgrep")
  command -v gitleaks >/dev/null 2>&1 || missing+=("gitleaks")
  
  if [ ${#missing[@]} -gt 0 ]; then
    echo "Installing missing critical tools: ${missing[*]}"
    # Try pip first (semgrep, gitleaks available via pip)
    # NOTE: use `python` not `python3` — on Windows `python3` is a broken
    # Microsoft Store alias. After install, add Scripts dir to PATH:
    #   export PATH="$PATH:$(python -c 'import site; print(site.getusersitepackages())')/../../Scripts"
    python -m pip install --quiet "${missing[@]}" 2>/dev/null \
      || echo "WARNING: auto-install failed, falling back to LLM analysis"
  fi
}

auto_install_tools
```

**Fallback decision tree:**
```
Critical tools available?
├── Yes → Run full automated analysis (semgrep + gitleaks + npm/pip-audit)
│         └── Supplement with LLM for architecture/design debt
└── No  → Attempt auto-install
         ├── Success → Run tools + LLM
         └── Failed → LLM-only mode
                     ├── Mark report: "PARTIAL DETECTION — tools unavailable"
                     ├── Lower security findings confidence by 0.2
                     └── Recommend user install tools for full coverage
```

**Report annotation when tools unavailable:**
```markdown
> ⚠️ **Partial Detection Mode**: Automated tools (semgrep, gitleaks) were not available
> and auto-install failed. Security findings below are LLM-inferred with reduced
> confidence. Run `pip install semgrep gitleaks` for full coverage.
```

**NEVER skip detection** — even in LLM-only mode, produce a report. The goal is always actionable output, not a blank slate.

## Integration with code-review-excellence

Both skills run during code review but focus on different dimensions:

| Dimension | code-review-excellence | tech-debt-detector |
|-----------|----------------------|-------------------|
| Focus | Correctness, security, performance | Debt accumulation, maintainability |
| Timeframe | Immediate issues | Long-term costs |
| Output | Fix suggestions | Debt inventory + prioritization |
| Severity | Bug/vulnerability focused | Maintenance burden focused |

**Workflow during code review:**
1. `code-review-excellence` runs first (correctness, security, performance)
2. `tech-debt-detector` runs second (debt patterns, long-term health)
3. Findings are merged into a single review report
4. Critical items from either skill are flagged as blockers

## Novahiz Integration

### Gate Check
When code review is scheduled in the Todo, verify `tech-debt-detector` is loaded alongside `code-review-excellence`.

### Audit
At session end, `novahiz-audit` checks that:
- Tech debt findings were included in the code review
- Critical/High items were flagged
- Remediation suggestions were provided

## Constraints

### MUST DO
- Run automated tools before manual analysis when available
- Classify every finding with category, severity, confidence, intent, prudence
- Provide file:line references for every finding
- Include three levels of remediation (minimal/better/complete)
- Map findings to Fowler's quadrant
- Score findings using the Riot Games impact/contagion/cost model
- Prioritize findings for an action plan
- Check for `TODO`/`FIXME`/`HACK`/`WORKAROUND` markers
- Check for `@ts-ignore`/`eslint-disable`/`# noqa` suppressions
- Detect dead code and commented-out code

### MUST NOT DO
- Duplicate findings already caught by `code-review-excellence` (security bugs, race conditions)
- Report false positives without noting confidence level
- Suggest fixes that introduce new debt
- Override `code-review-excellence` domain (correctness, security)
- Skip automated tools when they're available
- Produce a report without actionable prioritization

## Limitations

- Tool availability varies by project; fallback to LLM analysis when needed
- Architecture debt requires broader codebase context than a single diff
- Knowledge debt requires git history analysis (check blame/log)
- Data debt requires understanding of data volume and usage patterns
- Some debt types (process, requirements) require business context beyond code

## Performance Optimization

### Parallel Execution

Run all automated tools in parallel to minimize total execution time:

```bash
# Example: Parallel execution for TypeScript projects
(
  eslint . --format json > /tmp/eslint.json 2>&1 &
  tsc --noEmit > /tmp/tsc.json 2>&1 &
  npm audit --json > /tmp/npm-audit.json 2>&1 &
  wait
)
```

**Performance gains:**
- Small projects (<100 files): ~5s sequential → ~3s parallel (-40%)
- Medium projects (100-1000 files): ~30s sequential → ~12s parallel (-60%)
- Large projects (>1000 files): ~60s sequential → ~20s parallel (-67%)

### Caching Strategy

Cache results based on file hashes to avoid re-analyzing unchanged code:

```bash
# Generate cache key from source files
HASH=$(find src/ -name "*.ts" -o -name "*.tsx" | xargs md5sum 2>/dev/null | md5sum)
CACHE_FILE=".tech-debt-cache-${HASH:0:8}.json"

if [ -f "$CACHE_FILE" ]; then
  cat "$CACHE_FILE"
else
  # Run analysis and cache results
  RESULT=$(run_analysis)
  echo "$RESULT" > "$CACHE_FILE"
fi
```

**Cache hit rates:**
- First run: 0% (full analysis)
- Subsequent runs (no changes): 95-100%
- Partial changes: 50-80% (incremental analysis)

### Incremental Mode

For PR reviews, analyze only changed files:

```bash
# Analyze only files changed in the last commit
git diff --name-only HEAD~1 | while read file; do
  case "$file" in
    *.ts|*.tsx) npx eslint "$file" ;;
    *.py) flake8 "$file" && bandit "$file" ;;
  esac
done
```

### Tool Selection Matrix

| Project Size | Tools to Run | Parallel? | Cache? |
|--------------|--------------|-----------|--------|
| Tiny (<10 files) | Manual only | No | No |
| Small (10-100 files) | Linting + types | Yes | No |
| Medium (100-1000 files) | All available | Yes | Yes |
| Large (>1000 files) | Incremental | Yes | Yes |

### Performance Thresholds

| Metric | Target | Acceptable | Critical |
|--------|--------|------------|----------|
| Total time | <5s | <15s | >30s |
| Per tool | <2s | <5s | >10s |
| Cache hit rate | >80% | >50% | <20% |
| False positive rate | <5% | <15% | >30% |
