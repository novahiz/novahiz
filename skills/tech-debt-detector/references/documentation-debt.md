# Documentation Debt — Detection Patterns

Patterns de détection pour la dette de documentation : docs manquantes, obsolètes, inexactes, ou incomplètes.

## Detection Signals

- Missing README.md at project root
- Missing CHANGELOG.md
- Missing or outdated API documentation
- Missing JSDoc/TSDoc on public functions
- Missing type documentation
- Comments explaining non-obvious code
- Missing architecture decision records (ADRs)

---

## README Debt

### Missing README

```bash
# Check for README at project root
ls README.md README.rst README 2>/dev/null || echo "NO README FOUND"
```

### Incomplete README

Check for these sections:
- [ ] Project description
- [ ] Installation instructions
- [ ] Usage examples
- [ ] API documentation (if applicable)
- [ ] Configuration guide
- [ ] Contributing guide
- [ ] License
- [ ] Environment variables
- [ ] Deployment instructions

### Outdated README

```bash
# Check last modification time
stat README.md 2>/dev/null | grep Modify
# If older than 6 months, likely outdated

# Compare README claims vs reality
grep "npm install" README.md  # does it match package.json?
grep "python" README.md  # does it match requirements.txt/pyproject.toml?
```

---

## API Documentation Debt

### Missing API Docs

```bash
# Check for OpenAPI/Swagger
ls swagger.* openapi.* 2>/dev/null || echo "NO API DOCS"

# Check for doc generation in package.json
grep -i "doc\|swagger\|openapi" package.json 2>/dev/null
```

### Outdated API Docs

```bash
# Compare API routes vs documented routes
grep -rn "app\.\(get\|post\|put\|patch\|delete\)\|router\.\(get\|post\|put\|patch\|delete\)" src/ --include="*.ts" --include="*.js" | wc -l

# Compare with OpenAPI spec paths
grep -c "path:" openapi.yaml 2>/dev/null
```

### Missing Endpoint Documentation

For each API endpoint, check:
- [ ] Request method and path
- [ ] Request body schema
- [ ] Query parameters
- [ ] Response schema
- [ ] Error responses
- [ ] Authentication requirements
- [ ] Rate limiting info

---

## Code Documentation Debt

### Missing JSDoc/TSDoc

```bash
# Find public functions without JSDoc
grep -n "export.*function\|export.*class\|export.*interface" src/ -r | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  prevline=$((linenum - 1))
  prev=$(sed -n "${prevline}p" "$file")
  if ! echo "$prev" | grep -q "///\|/\*\*"; then
    echo "MISSING JSDOC: $file:$linenum"
  fi
done
```

### Missing Python Docstrings

```bash
# Find public functions without docstrings
grep -n "def " src/ -r --include="*.py" | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  nextline=$((linenum + 1))
  next=$(sed -n "${nextline}p" "$file")
  if ! echo "$next" | grep -q '"""'; then
    echo "MISSING DOCSTRING: $file:$linenum"
  fi
done
```

### Comments Explaining Code (Code Smell)

```bash
# Find comments that explain WHAT instead of WHY
grep -rn "// this\|// that\|// it\|// the" src/ --include="*.ts" --include="*.js" | grep -v "node_modules" | head -20

# Good comments explain WHY
# "Why" comments: // because, // due to, // workaround for, // temporary
# Bad comments: // this function does X, // returns Y
```

---

## CHANGELOG Debt

### Missing CHANGELOG

```bash
ls CHANGELOG.md CHANGES.md HISTORY.md 2>/dev/null || echo "NO CHANGELOG FOUND"
```

### Outdated CHANGELOG

```bash
# Check last modification
stat CHANGELOG.md 2>/dev/null | grep Modify

# Compare git log vs changelog entries
git log --oneline -20 | head -5
# Are these commits reflected in CHANGELOG.md?
```

### CHANGELOG Format

Check for:
- [ ] Follows Keep a Changelog format
- [ ] Entries for recent releases
- [ ] Categorized: Added, Changed, Deprecated, Removed, Fixed, Security
- [ ] Version numbers match git tags

---

## Architecture Decision Records

### Missing ADRs

```bash
ls docs/adr/ docs/decisions/ 2>/dev/null || echo "NO ADR DIRECTORY"

# Check for ADR references in code
grep -rn "ADR\|Decision\|RFC" src/ --include="*.md" | head -10
```

### ADR Template

Each ADR should contain:
- Title
- Status (proposed, accepted, deprecated, superseded)
- Context (why this decision was needed)
- Decision (what was decided)
- Consequences (positive and negative impact)

---

## Type Documentation Debt

### TypeScript

```bash
# Find exported types without documentation
grep -n "export.*type\|export.*interface" src/ -r | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  prevline=$((linenum - 1))
  prev=$(sed -n "${prevline}p" "$file")
  if ! echo "$prev" | grep -q "///\|/\*\*"; then
    echo "MISSING TYPE DOC: $file:$linenum"
  fi
done
```

### Complex Types

```typescript
// BAD: complex type without explanation
type Config = {
  [key: string]: {
    value: any;
    meta?: Record<string, unknown>;
  }[];
};

// GOOD: documented type
/**
 * Application configuration schema.
 * Each key is a namespace (e.g., 'auth', 'database').
 * Each namespace contains an array of config entries.
 * - value: The configuration value (type varies by entry)
 * - meta: Optional metadata (description, sensitivity, source)
 */
type Config = {
  [key: string]: ConfigEntry[];
};
```

---

## Cross-Language Documentation

### Python

```bash
# Check for pydoc coverage
pydocstyle src/ 2>/dev/null | head -20

# Check for type stubs
ls *.pyi 2>/dev/null || echo "NO TYPE STUBS"
```

### Kotlin/Swift

```kotlin
// BAD: no KDoc
fun processUser(user: User): UserResult {
    // ...
}

// GOOD: KDoc
/**
 * Processes a user entity through the validation pipeline.
 *
 * @param user The user to process
 * @return UserResult containing either the validated user or validation errors
 * @throws DatabaseException if database connection fails
 */
fun processUser(user: User): UserResult {
    // ...
}
```

```swift
// BAD: no documentation
func processUser(_ user: User) -> UserResult {
    // ...
}

// GOOD: documentation
/// Processes a user entity through the validation pipeline.
///
/// - Parameter user: The user to process
/// - Returns: UserResult containing either the validated user or validation errors
/// - Throws: DatabaseException if database connection fails
func processUser(_ user: User) -> UserResult {
    // ...
}
```

---

## Detection Commands

```bash
# Check README existence
ls README.md README.rst README 2>/dev/null || echo "MISSING: README"

# Check CHANGELOG existence
ls CHANGELOG.md CHANGES.md HISTORY.md 2>/dev/null || echo "MISSING: CHANGELOG"

# Check LICENSE existence
ls LICENSE LICENSE.md LICENSE.txt 2>/dev/null || echo "MISSING: LICENSE"

# Check CONTRIBUTING existence
ls CONTRIBUTING.md CONTRIBUTING.rst 2>/dev/null || echo "MISSING: CONTRIBUTING"

# Count documented vs undocumented functions
# TypeScript
grep -c "export.*function" src/ -r 2>/dev/null || echo "0"
# Python
grep -c "def " src/ -r --include="*.py" 2>/dev/null || echo "0"

# Check for TODO in docs
grep -rn "TODO\|FIXME\|WIP\|PLACEHOLDER" docs/ 2>/dev/null
```
