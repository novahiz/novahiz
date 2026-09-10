---
name: anti-pattern-detector
description: "Detects and prevents common performance, concurrency, caching, monitoring, infrastructure, and build anti-patterns in code. Use when reviewing code for reliability issues, debugging race conditions or deadlocks, optimizing cache strategies, auditing monitoring coverage, validating infrastructure configs, or checking build/deploy safety. Triggers on: anti-pattern, race condition, deadlock, cache stampede, retry storm, circuit breaker, log flooding, SPOF, config drift, dependency hell, docker bloat, migration safety, fire-and-forget, TOCTOU, ABA problem, thundering herd, cold start."
---

# Anti-Pattern Detector

Detects and prevents common reliability anti-patterns across performance, concurrency, caching, monitoring, infrastructure, and build/deploy. Complements `clean-code` (quality), `security-reviewer` (security), and `devops-engineer` (Docker/K8s) by covering operational reliability gaps.

## When to Use

- Code review for reliability issues (auto-triggers with `code-review-excellence`)
- Debugging race conditions, deadlocks, or performance regressions
- Auditing cache strategies and invalidation patterns
- Reviewing monitoring, logging, and alerting coverage
- Validating infrastructure configs (Terraform, Docker, K8s manifests)
- Checking build/deploy safety (dependencies, migrations, rollbacks)
- Pre-deployment reliability checks

## Do not use when

- Task is purely about code style or formatting (use `clean-code`)
- Task is purely about security vulnerabilities (use `security-reviewer`)
- Task is purely about Dockerfile optimization (use `docker-expert`)
- Task is purely about Kubernetes manifests (use `kubernetes-specialist`)

## Core Workflow

### Phase 1 — Scan

Try tool-based detection first, fall back to manual analysis.

**Automated tools (run if available):**
```bash
# Concurrency + performance patterns
semgrep --config=auto --include-pattern='*.py' .
semgrep --config=auto --include-pattern='*.js' .
semgrep --config=auto --include-pattern='*.ts' .

# Python-specific
bandit -r ./src
flake8 --select=G,C,N .

# JavaScript/TypeScript
eslint --plugin=sonarjs .
npx eslint-plugin-n eslint .

# Secrets in git
gitleaks detect --source=.
trufflehog git file://./ --only-verified

# Dependency audit
npm audit --audit-level=moderate
pip-audit
cargo audit

# Docker
hadolint Dockerfile
trivy fs .
```

**Manual analysis:** If tools are unavailable or for patterns tools miss, load the relevant `references/` file and scan using the detection patterns.

### Phase 2 — Classify

For each finding, determine:

| Field | Values |
|-------|--------|
| **Category** | `concurrency` · `cache` · `async-network` · `monitoring` · `cloud-infra` · `build-deploy` · `language-specific` |
| **Severity** | `Critical` · `High` · `Medium` · `Low` · `Info` |
| **Confidence** | `High` (clear pattern match) · `Medium` (likely but needs context) · `Low` (possible, needs verification) |
| **Location** | `file:line` reference |

**Severity rules:**

| Severity | Criteria |
|----------|----------|
| **Critical** | Data loss, security breach, production outage, deadlocking under load |
| **High** | Memory leak, performance degradation >10x, missing error handling on critical path |
| **Medium** | Suboptimal pattern, missing best practice, potential issue under specific conditions |
| **Low** | Code smell, minor inefficiency, style-adjacent reliability issue |
| **Info** | Informational, no action required, FYI |

### Phase 3 — Report

Use this output template:

```markdown
## Anti-Pattern Report

### Executive Summary
- **Critical:** X | **High:** Y | **Medium:** Z | **Low:** W
- **Categories affected:** concurrency, cache, ...
- **Files scanned:** N

### Findings

| # | Severity | Category | File:Line | Pattern | Confidence |
|---|----------|----------|-----------|---------|------------|
| 1 | Critical | concurrency | src/api.py:42 | Race condition on shared counter | High |
| 2 | High | cache | src/cache.py:15 | Missing cache invalidation | Medium |

### Detailed Findings

#### FIND-001: Race condition on shared counter
- **Severity:** Critical (CVSS-like: availability impact)
- **File:** `src/api.py:42`
- **Pattern:** Concurrent increment without atomicity
- **Impact:** Counter corruption under concurrent requests, incorrect data
- **Remediation:**
  - Minimal: Add threading.Lock around increment
  - Better: Use atomic operations (threading.atomic, AtomicInteger)
  - Complete: Use lock-free data structure or database atomic counter
- **References:** CWE-362, CWE-662
```

### Phase 4 — Remediate

For each finding, provide three levels of fix:

1. **Minimal fix** — Quick win, mergeable immediately, addresses the symptom
2. **Better fix** — Recommended, covers edge cases, addresses the cause
3. **Complete fix** — Best practice, production-ready, prevents recurrence

## Reference Guide

Load the relevant reference file based on the finding category:

| Category | Reference | Load When |
|----------|-----------|-----------|
| Concurrency | `references/concurrency-patterns.md` | Race conditions, deadlocks, TOCTOU, ABA, thundering herd |
| Cache | `references/cache-patterns.md` | Cache stampede, avalanche, penetration, cold start, TTL issues |
| Async/Network | `references/async-network-patterns.md` | Fire-and-forget, retry storms, circuit breaker, event listener leaks |
| Monitoring | `references/monitoring-patterns.md` | Log flooding, missing structured logging, PII in logs, alert fatigue |
| Cloud/Infra | `references/cloud-infra-patterns.md` | SPOF, auto-scaling, costs, config drift, secrets in git |
| Build/Deploy | `references/build-deploy-patterns.md` | Dependency hell, docker bloat, migration safety, unpinned deps |
| Language-specific | `references/language-specific-patterns.md` | JS/Python/Go/Rust/Java specific pitfalls |

## Novahiz Integration

This skill auto-triggers during `code-review-excellence`. The workflow:

1. `novahiz-gate` checks that `anti-pattern-detector` is loaded
2. During code review, findings are added to the review output
3. Critical/High findings are flagged in the Todo as blockers
4. `novahiz-audit` verifies all Critical findings were addressed

## Tool Availability Matrix

| Tool | What it detects | Install |
|------|-----------------|---------|
| `semgrep` | Concurrency, performance, security patterns | `pip install semgrep` |
| `bandit` | Python security + anti-patterns | `pip install bandit` |
| `eslint-plugin-sonarjs` | JS/TS code smells + anti-patterns | `npm i -D eslint-plugin-sonarjs` |
| `gitleaks` | Secrets in git history | `brew install gitleaks` |
| `hadolint` | Dockerfile best practices | `brew install hadolint` |
| `trivy` | Container + dependency vulnerabilities | `brew install trivy` |
| `pip-audit` | Python dependency vulnerabilities | `pip install pip-audit` |
| `cargo audit` | Rust dependency vulnerabilities | `cargo install cargo-audit` |

When tools are not available, proceed with manual analysis using the reference files.

## Constraints

### MUST DO
- Run automated tools before manual analysis when available
- Provide specific file/line locations for every finding
- Include CWE/OWASP references where applicable
- Offer three levels of remediation (minimal/better/complete)
- Classify severity consistently using the criteria above
- Check for secrets in code (gitleaks or manual scan)
- Flag Critical findings immediately

### MUST NOT DO
- Skip manual review when tools report zero findings (tools miss context)
- Report false positives without noting confidence level
- Suggest fixes that introduce new anti-patterns
- Mix security findings with reliability findings (use `security-reviewer` for security)
- Override existing skills' domain (don't rewrite Dockerfiles — use `docker-expert`)

## Limitations
- Use this skill only when the task clearly matches the scope described above.
- Do not treat the output as a substitute for environment-specific validation, testing, or expert review.
- Stop and ask for clarification if required inputs, permissions, safety boundaries, or success criteria are missing.
