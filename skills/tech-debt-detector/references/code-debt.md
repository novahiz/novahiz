# Code Debt — Detection Patterns

Patterns de détection pour la dette de code : duplication, complexité, mauvaise nommation, logique cachée.

## Detection Signals

### Comment Markers
```
# TODO
# FIXME
# HACK
# XXX
# WORKAROUND
# TEMP
# TEMPORARY
# REFACTOR
```

### Suppression Directives
```
// @ts-ignore
// @ts-expect-error
// eslint-disable-next-line
// eslint-disable
/* eslint-disable */
# type: ignore
# noqa
# noinspection
// noinspection
/* tslint:disable */
```

---

## TypeScript / JavaScript

### Complexity Debt

**Long functions (>50 lines)**
```typescript
// BAD: 80-line function doing everything
async function handleUserAction(req, res) {
  // validation (15 lines)
  // database query (10 lines)
  // business logic (25 lines)
  // response formatting (15 lines)
  // error handling (15 lines)
}

// GOOD: Short, focused functions
async function handleUserAction(req, res) {
  const input = validateRequest(req);
  const user = await fetchUser(input.userId);
  const result = applyBusinessLogic(user, input);
  res.json(formatResponse(result));
}
```

**Deep nesting (>4 levels)**
```typescript
// BAD
if (user) {
  if (user.role) {
    if (user.role.permissions) {
      if (user.role.permissions.includes('write')) {
        // deeply nested logic
      }
    }
  }
}

// GOOD: Early returns
if (!user) return unauthorized();
if (!user.role) return forbidden();
if (!user.role.permissions?.includes('write')) return forbidden();
// flat logic
```

**Cyclomatic complexity >10**
Count decision points: `if`, `else if`, `switch case`, `&&`, `||`, `? :`, `for`, `while`, `catch`, `?.`, `??`.

### Duplication Debt

**Copy-paste code blocks** — Same or near-identical code in 2+ places.
Search with: `grep -rn "pattern" --include="*.ts" --include="*.tsx"`

**Duplicate imports** — Same module imported in multiple files without barrel export.

**Duplicate type definitions** — Same interface defined in 3+ files.

### Naming Debt

**Single-letter variables** outside short loops:
```typescript
// BAD
const d = new Date();
const r = await fetch(url);
const x = arr.map(i => i * 2);

// GOOD
const currentDate = new Date();
const response = await fetch(url);
const doubled = arr.map(item => item * 2);
```

**Magic numbers:**
```typescript
// BAD
if (user.age > 18 && retryCount < 3 && timeout > 5000) { }

// GOOD
const MAJORITY_AGE = 18;
const MAX_RETRIES = 3;
const MIN_TIMEOUT_MS = 5000;
if (user.age > MAJORITY_AGE && retryCount < MAX_RETRIES && timeout > MIN_TIMEOUT_MS) { }
```

### Type Safety Debt

**`any` type usage:**
```typescript
// BAD
function processData(data: any) { }
const result = response as any;

// GOOD
function processData(data: ProcessDataInput) { }
const result = response as ProcessedResult;
```

**`!` non-null assertion:**
```typescript
// BAD
const user = getUser()!;
const name = user.name!;

// GOOD
const user = getUser();
if (!user) throw new Error('User not found');
const name = user.name ?? 'Anonymous';
```

**Missing strict mode:**
Check `tsconfig.json` for:
```json
{
  "compilerOptions": {
    "strict": true,           // MUST be true
    "noUncheckedIndexedAccess": true,  // SHOULD be true
    "exactOptionalPropertyTypes": true // NICE to have
  }
}
```

### Dead Code

**Commented-out code:**
```typescript
// BAD: entire blocks commented out
// function oldProcess() {
//   // 20 lines of dead code
// }

// GOOD: Remove it. Git has history.
```

**Unused variables/exports:**
```bash
# Find unused exports
npx tsc --noEmit 2>&1 | grep "is declared but its value is never read"
```

**Unreachable code:**
```typescript
function getData() {
  return fetchFromDB();
  console.log('debug'); // unreachable
}
```

### Function/Module Health

**God function** — does too many things:
- Check function length (>50 lines = suspect)
- Count responsibilities (data fetching + processing + formatting = 3 = bad)

**Barrel export abuse** — re-exports from every file in a directory, creating circular dependency risk:
```typescript
// index.ts barrel file
export * from './file1';
export * from './file2'; // if file2 imports from file1, potential cycle
```

---

## Python

### Complexity Debt

**Long functions** — Same threshold as JS (>50 lines).

**Deep nesting** — Same threshold (>4 levels).

**Broad exception catching:**
```python
# BAD
try:
    risky_operation()
except Exception:
    pass

# GOOD
try:
    risky_operation()
except SpecificError as e:
    logger.warning("Operation failed: %s", e)
    raise
```

### Naming Debt

**Mutable default arguments:**
```python
# BAD
def add_item(item, items=[]):
    items.append(item)
    return items

# GOOD
def add_item(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items
```

**Snake_case violations, unclear abbreviations.**

### Type Safety Debt

**Missing type hints:**
```python
# BAD
def process(data):
    return data['key']

# GOOD
def process(data: dict[str, Any]) -> str:
    return data['key']
```

**Missing `mypy` strict mode:**
```toml
# pyproject.toml
[tool.mypy]
strict = true
```

### Import Debt

**Wildcard imports:**
```python
# BAD
from module import *

# GOOD
from module import specific_function
```

**Circular imports** — Module A imports B, B imports A.

---

## Kotlin

### Null Safety Debt

**`!!` non-null assertion:**
```kotlin
// BAD
val name = user!!.name!!

// GOOD
val name = user?.name ?: "Anonymous"
```

**Unsafe cast with `as`:**
```kotlin
// BAD
val config = rawConfig as AppConfig

// GOOD
val config = rawConfig as? AppConfig ?: defaultConfig()
```

### Coroutine Debt

**Blocking calls in coroutines:**
```kotlin
// BAD: blocks the thread
val data = runBlocking { fetchFromDB() }

// GOOD: suspend properly
suspend fun getData(): Data = fetchFromDB()
```

**Missing structured concurrency:**
```kotlin
// BAD: launches without scope
GlobalScope.launch { /* leaked coroutine */ }

// GOOD: scoped to lifecycle
viewModelScope.launch { /* cancelled on ViewModel clear */ }
```

### Legacy Java Patterns

**`!!` force unwraps** — Kotlin-specific but caused by Java interop.

**Java-style verbose patterns** — Could use Kotlin idioms (data classes, sealed classes, extension functions).

---

## Swift

### Force Unwrap Debt

```swift
// BAD
let name = user.name!
let url = URL(string: urlString)!

// GOOD
guard let name = user.name else { return }
guard let url = URL(string: urlString) else { return }
// or: let url = URL(string: urlString) ?? defaultURL
```

### Error Handling Debt

```swift
// BAD: force try
let data = try! fetchData()

// GOOD: proper handling
do {
    let data = try fetchData()
} catch {
    handleError(error)
}
```

### Retain Cycle Debt

```swift
// BAD: strong reference in closure
closure = { self.doSomething() }

// GOOD: weak capture
closure = { [weak self] in self?.doSomething() }
```

---

## Dart / Flutter

### setState Abuse

```dart
// BAD: setState for everything
setState(() {
  _counter++;
  _lastUpdated = DateTime.now();
  _items = fetchItems(); // side effect in setState!
});

// GOOD: split concerns
_counter++;
_lastUpdated = DateTime.now();
setState(() {}); // only UI state
_items = await fetchItems(); // side effect outside setState
```

### Missing const

```dart
// BAD: rebuilds every frame
Text('Hello')  // not const

// GOOD: compile-time constant
const Text('Hello')
```

### Widget Rebuild Issues

```dart
// BAD: parent rebuilds entire tree
build() {
  return Column(
    children: [
      ExpensiveWidget(),  // rebuilt unnecessarily
      OtherWidget(),
    ],
  );
}

// GOOD: extract to separate widget
// Each widget rebuilds only when its own state changes
```

---

## Cross-Language Patterns

### Commented-Out Code
Search: `grep -rn "^\s*//" --include="*.{ts,tsx,js,jsx,py,kt,swift,dart}" | head -20`
Then verify with: `grep -rn "^\s*//" file | grep -E "(function|class|return|if|for|while)"`

### Dead Code
```bash
# Find unused files (no imports)
find src/ -name "*.ts" | while read f; do
  basename=$(basename "$f" .ts)
  count=$(grep -r "$basename" src/ --include="*.ts" | grep -v "import" | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "UNUSED: $f"
  fi
done
```

### Magic Numbers
Search: `\b\d{3,}\b` in code (numbers >999 are usually suspicious as raw values).

### Long Parameter Lists (>4 params)
```typescript
// BAD
function createUser(name, email, age, role, department, manager, startDate) { }

// GOOD
interface CreateUserInput {
  name: string;
  email: string;
  age: number;
  role: string;
  department: string;
  manager?: string;
  startDate?: Date;
}
function createUser(input: CreateUserInput) { }
```
