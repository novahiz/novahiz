# Process Debt — Detection Patterns

Patterns de détection pour la dette de processus : workflows manquants, documentation de processus obsolète, pratiques manuelles automatisables.

## Detection Signals

- Manual deployment steps in README
- Missing PR templates
- Missing issue templates
- No contributing guide
- No code review process documented
- Manual release process
- No changelog automation

---

## Missing Workflows

### No PR Template

```bash
ls .github/PULL_REQUEST_TEMPLATE.md .github/pull_request_template.md 2>/dev/null || echo "NO PR TEMPLATE"
```

### No Issue Templates

```bash
ls .github/ISSUE_TEMPLATE/ 2>/dev/null || echo "NO ISSUE TEMPLATES"
```

### No Contributing Guide

```bash
ls CONTRIBUTING.md CONTRIBUTING.rst 2>/dev/null || echo "NO CONTRIBUTING GUIDE"
```

### No Code of Conduct

```bash
ls CODE_OF_CONDUCT.md CODE_OF_CONDUCT.rst 2>/dev/null || echo "NO CODE OF CONDUCT"
```

---

## Manual Processes

### Manual Deployment

```bash
# Check for manual deployment steps
grep -i "manual\|ssh\|scp\|rsync\|console\|dashboard" README.md deploy/ scripts/ 2>/dev/null | head -10
```

### Manual Release

```bash
# Check for release automation
grep -i "release\|publish\|deploy" .github/workflows/*.yml 2>/dev/null | head -10

# Check for semantic versioning
grep -i "semantic-release\|changeset\|lerna" package.json 2>/dev/null
```

### Manual Testing

```bash
# Check for automated testing in CI
grep -i "test\|coverage\|e2e" .github/workflows/*.yml 2>/dev/null | head -10
```

---

## Git Hygiene Debt

### Large Commits

```bash
# Check recent commit sizes
git log --oneline -20 --stat | head -50
```

### Missing Branch Protection

```bash
# Check for branch protection (requires GitHub API)
gh api repos/{owner}/{repo}/branches/main/protection 2>/dev/null || echo "NO BRANCH PROTECTION"
```

### No Conventional Commits

```bash
# Check commit message format
git log --oneline -20 | grep -vE "^(feat|fix|chore|docs|refactor|test|style|perf|ci|build|revert)" | head -10
```

### Missing .gitignore

```bash
ls .gitignore 2>/dev/null || echo "NO .gitignore"

# Check for common patterns
grep -i "node_modules\|\.env\|dist\|build" .gitignore 2>/dev/null | head -10
```

---

## Documentation Process

### No CHANGELOG

```bash
ls CHANGELOG.md CHANGES.md HISTORY.md 2>/dev/null || echo "NO CHANGELOG"
```

### No Release Notes

```bash
# Check for GitHub releases
gh release list --limit 5 2>/dev/null || echo "NO RELEASES"
```

### No ADR Process

```bash
ls docs/adr/ docs/decisions/ 2>/dev/null || echo "NO ADR DIRECTORY"
```

---

## Code Review Process

### No Review Checklist

```bash
# Check for review checklist
grep -i "review\|checklist" .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null | head -10
```

### Missing Required Reviews

```bash
# Check branch protection (requires GitHub API)
gh api repos/{owner}/{repo}/branches/main/protection 2>/dev/null | jq '.required_pull_request_reviews' | head -5
```

### No Automated Checks

```bash
# Check for required status checks
gh api repos/{owner}/{repo}/branches/main/protection 2>/dev/null | jq '.required_status_checks' | head -5
```

---

## Detection Commands

```bash
# Check for PR template
ls .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || echo "MISSING: PR template"

# Check for issue templates
ls .github/ISSUE_TEMPLATE/ 2>/dev/null || echo "MISSING: Issue templates"

# Check for contributing guide
ls CONTRIBUTING.md 2>/dev/null || echo "MISSING: Contributing guide"

# Check for code of conduct
ls CODE_OF_CONDUCT.md 2>/dev/null || echo "MISSING: Code of conduct"

# Check for changelog
ls CHANGELOG.md 2>/dev/null || echo "MISSING: Changelog"

# Check for release automation
grep -i "semantic-release\|changeset\|lerna" package.json 2>/dev/null || echo "MISSING: Release automation"

# Check commit message format
git log --oneline -20 | grep -vE "^(feat|fix|chore|docs|refactor|test|style|perf|ci|build|revert)" | wc -l
```
