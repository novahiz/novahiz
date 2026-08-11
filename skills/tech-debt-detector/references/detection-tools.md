# Detection Tools — Automated Tool Guide

Guide des outils automatisés pour la détection de dette technique, organisés par langage et type de dette.

## Tool Selection Matrix

| Tool | Languages | Detects | Install | Command |
|------|-----------|---------|---------|---------|
| ESLint + plugins | JS/TS | Code smells, complexity, patterns | `npm i -D eslint` | `npx eslint . --format json` |
| SonarQube/SonarLint | Multi | All code-level debt | IDE plugin or server | `sonar-scanner` |
| semgrep | Multi | Security, anti-patterns | `pip install semgrep` | `semgrep --config=auto --json` |
| gitleaks | Multi | Secrets in git | `brew install gitleaks` | `gitleaks detect --source=.` |
| npm audit | JS/TS | Dependency vulnerabilities | Built-in | `npm audit --json` |
| pip-audit | Python | Dependency vulnerabilities | `pip install pip-audit` | `pip-audit --format json` |
| hadolint | Docker | Dockerfile issues | `brew install hadolint` | `hadolint Dockerfile` |
| trivy | Multi | Container + deps vulns | `brew install trivy` | `trivy fs . --format json` |
| madge | JS/TS | Circular dependencies | `npm i -D madge` | `npx madge --circular src/` |
| flake8 | Python | Code smells | `pip install flake8` | `flake8 . --statistics --count` |
| bandit | Python | Security issues | `pip install bandit` | `bandit -r . -f json` |
| mypy | Python | Type safety | `pip install mypy` | `mypy src/ --strict` |
| pylint | Python | Code quality | `pip install pylint` | `pylint src/` |
| ktlint | Kotlin | Code style | `brew install ktlint` | `ktlint "**/*.kt"` |
| swiftlint | Swift | Code style | `brew install swiftlint` | `swiftlint lint` |
| dart analyze | Dart | Code analysis | Built-in | `dart analyze` |
| flutter analyze | Flutter | Code analysis | Built-in | `flutter analyze` |
| sonarcloud | Multi | Cloud-hosted analysis | CI integration | `sonar-scanner` |

---

## TypeScript / JavaScript

### ESLint

```bash
# Install
npm i -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin

# Run
npx eslint . --format json 2>/dev/null

# Key rules for debt detection
# @typescript-eslint/no-explicit-any
# @typescript-eslint/no-unused-vars
# @typescript-eslint/explicit-function-return-type
# @typescript-eslint/no-non-null-assertion
# complexity
# max-depth
# max-lines-per-function
# no-duplicate-imports
```

### TypeScript Compiler

```bash
# Type checking
npx tsc --noEmit 2>/dev/null

# Strict mode check
npx tsc --noEmit --strict 2>/dev/null
```

### npm audit

```bash
# Dependency vulnerabilities
npm audit --json 2>/dev/null

# Summary
npm audit 2>/dev/null | tail -20
```

### madge (Circular Dependencies)

```bash
# Install
npm i -D madge

# Check circular dependencies
npx madge --circular src/

# Check dependency graph
npx madge --image graph.svg src/
```

---

## Python

### flake8

```bash
# Install
pip install flake8

# Run
flake8 . --statistics --count --format=json 2>/dev/null

# Key plugins
pip install flake8-bugbear flake8-comprehensions flake8-docstrings
```

### bandit (Security)

```bash
# Install
pip install bandit

# Run
bandit -r . -f json 2>/dev/null

# Summary
bandit -r . 2>/dev/null | tail -20
```

### mypy (Type Safety)

```bash
# Install
pip install mypy

# Run with strict mode
mypy src/ --strict --json 2>/dev/null

# Check pyproject.toml config
grep -A 10 "\[tool.mypy\]" pyproject.toml 2>/dev/null
```

### pylint

```bash
# Install
pip install pylint

# Run
pylint src/ --output-format=json 2>/dev/null

# Summary
pylint src/ 2>/dev/null | tail -20
```

---

## Kotlin

### ktlint

```bash
# Install
brew install ktlint

# Run
ktlint "**/*.kt" --reporter=json 2>/dev/null

# Auto-format
ktlint "**/*.kt" -F
```

### detekt

```bash
# Install (Gradle plugin)
# build.gradle.kts
plugins {
  id("io.gitlab.arturbosch.detekt") version "1.23.0"
}

# Run
./gradlew detekt
```

---

## Swift

### swiftlint

```bash
# Install
brew install swiftlint

# Run
swiftlint lint --reporter json 2>/dev/null

# Auto-fix
swiftlint lint --fix
```

---

## Dart / Flutter

### dart analyze

```bash
# Run
dart analyze 2>/dev/null

# Flutter
flutter analyze 2>/dev/null
```

### dart fix

```bash
# Auto-fix issues
dart fix --apply
```

---

## Docker

### hadolint

```bash
# Install
brew install hadolint

# Run
hadolint Dockerfile 2>/dev/null

# JSON output
hadolint Dockerfile --format json 2>/dev/null
```

### trivy

```bash
# Install
brew install trivy

# Scan filesystem
trivy fs . --format json --severity HIGH,CRITICAL 2>/dev/null

# Scan Docker image
trivy image myapp:latest --format json 2>/dev/null
```

---

## Multi-Language

### semgrep

```bash
# Install
pip install semgrep

# Run with auto config
semgrep --config=auto --json 2>/dev/null

# Security rules
semgrep --config=p/security-audit --json 2>/dev/null

# TypeScript rules
semgrep --config=p/typescript --json 2>/dev/null

# Python rules
semgrep --config=p/python --json 2>/dev/null
```

### gitleaks (Secrets)

```bash
# Install
brew install gitleaks

# Run
gitleaks detect --source=. --report-format json --report-path=gitleaks-report.json

# Summary
gitleaks detect --source=.
```

---

## CI Integration

### GitHub Actions Example

```yaml
name: Tech Debt Detection
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npx eslint . --format json --output-file eslint-report.json
    - run: npx tsc --noEmit
    - run: npm audit --audit-level=high

  security:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - run: pip install semgrep
    - run: semgrep --config=auto --json --output semgrep-report.json
    - uses: gitleaks/gitleaks-action@v2
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  analysis:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - run: pip install bandit
    - run: bandit -r . -f json -o bandit-report.json
    - run: npx madge --circular src/
```

---

## Fallback: Manual LLM Analysis

When tools are unavailable, use these patterns for LLM-based detection:

### Code Complexity

```bash
# Find long functions
find src/ -name "*.ts" -exec awk '/function|=> \{/{start=NR} /\}/{if(start && NR-start>50) print FILENAME":"start"-"NR" ("NR-start" lines)"; start=0}' {} \;

# Find deep nesting
grep -rn "if\|for\|while" src/ --include="*.ts" | awk -F: '{print $1":"$2}' | while read loc; do
  file=$(echo $loc | cut -d: -f1)
  line=$(echo $loc | cut -d: -f2)
  indent=$(sed -n "${line}p" "$file" | grep -o "^\s*" | wc -c)
  if [ "$indent" -gt 20 ]; then
    echo "DEEP NESTING: $loc"
  fi
done
```

### Dead Code

```bash
# Find unused exports
npx tsc --noEmit 2>&1 | grep "is declared but its value is never read" | head -10

# Find commented-out code
grep -rn "^\s*//" src/ --include="*.ts" | grep -E "function|class|return|if|for" | head -10
```

### Magic Numbers

```bash
# Find numbers > 999
grep -rn "\b[0-9]\{3,\}\b" src/ --include="*.ts" | grep -v "test\|spec\|mock\|\.d\.ts" | head -20
```

---

## Tool Availability Check Script

```bash
#!/bin/bash
# check-tools.sh — Check which tools are available

echo "=== Tool Availability ==="

tools=(
  "eslint:ESLint:JS/TS"
  "tsc:TypeScript Compiler:JS/TS"
  "npm:npm audit:JS/TS"
  "madge:Madge (circular deps):JS/TS"
  "flake8:Flake8:Python"
  "bandit:Bandit:Python"
  "mypy:mypy:Python"
  "pylint:Pylint:Python"
  "pip-audit:pip-audit:Python"
  "semgrep:Semgrep:Multi"
  "gitleaks:Gitleaks:Multi"
  "hadolint:Hadolint:Docker"
  "trivy:Trivy:Multi"
  "ktlint:ktlint:Kotlin"
  "swiftlint:SwiftLint:Swift"
  "dart:Dart analyzer:Dart"
)

for tool_info in "${tools[@]}"; do
  IFS=: read -r cmd name lang <<< "$tool_info"
  if command -v "$cmd" &>/dev/null; then
    echo "✅ $name ($lang) — available"
  else
    echo "❌ $name ($lang) — not found"
  fi
done
```
