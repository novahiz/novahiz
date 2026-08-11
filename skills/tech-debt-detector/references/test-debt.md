# Test Debt — Detection Patterns

Patterns de détection pour la dette de tests : couverture insuffisante, tests flaky, tests manquants, patterns de test obsolètes.

## Detection Signals

- Missing test files alongside source files
- Low coverage numbers (<80% line, <75% branch)
- Tests with `skip`, `pending`, `xdescribe`, `xit`, `@pytest.mark.skip`
- Tests with `flaky` annotations
- Tests with `setTimeout` or random delays
- Tests using `sleep` or `wait` with magic numbers
- Test files with `TODO` or `FIXME`
- Missing test configuration

---

## Coverage Gaps

### Source Without Tests

**TypeScript/JavaScript:**
```bash
# Find source files without corresponding test files
find src/ -name "*.ts" -not -name "*.test.ts" -not -name "*.spec.ts" | while read f; do
  basename=$(basename "$f" .ts)
  dir=$(dirname "$f")
  test_file="$dir/$basename.test.ts"
  spec_file="$dir/$basename.spec.ts"
  if [ ! -f "$test_file" ] && [ ! -f "$spec_file" ]; then
    echo "NO TEST: $f"
  fi
done
```

**Python:**
```bash
# Find source files without test files
find src/ -name "*.py" -not -name "test_*" -not -name "*_test.py" | while read f; do
  basename=$(basename "$f" .py)
  dir=$(dirname "$f")
  test_file="$dir/test_$basename.py"
  test_file2="$dir/${basename}_test.py"
  if [ ! -f "$test_file" ] && [ ! -f "$test_file2" ]; then
    echo "NO TEST: $f"
  fi
done
```

### Missing Test Types

| Source Type | Required Test Type | Coverage Target |
|-------------|-------------------|-----------------|
| Business logic | Unit tests | >90% line, >80% branch |
| API endpoints | Integration tests | 100% endpoints |
| UI components | Snapshot + interaction tests | >80% line |
| E2E critical paths | Playwright/Cypress tests | All critical flows |
| Database queries | Integration tests | All queries |
| External API calls | Mocked integration tests | All adapters |

### Uncovered Edge Cases

**Missing test for:**
- Null/undefined inputs
- Empty arrays/objects
- Boundary values (0, MAX_INT, empty string)
- Error paths (try/catch, failure scenarios)
- Concurrent operations
- Rate limiting
- Authentication/authorization failures

```typescript
// BAD: only happy path tested
describe('createUser', () => {
  it('should create a user', async () => {
    const user = await createUser({ name: 'John', email: 'john@test.com' });
    expect(user.name).toBe('John');
  });
});

// GOOD: happy path + edge cases
describe('createUser', () => {
  it('should create a user with valid input', async () => { ... });
  it('should reject missing name', async () => { ... });
  it('should reject invalid email', async () => { ... });
  it('should reject duplicate email', async () => { ... });
  it('should sanitize name', async () => { ... });
  it('should set default role', async () => { ... });
  it('should handle database failure', async () => { ... });
});
```

---

## Flaky Tests

### Detection Patterns

```bash
# Find tests with sleep/wait
grep -rn "sleep\|setTimeout\|\.wait(" src/ --include="*.test.*" --include="*.spec.*"

# Find tests with random data
grep -rn "Math.random\|Date.now\|new Date()" src/ --include="*.test.*" --include="*.spec.*"

# Find tests with network calls (non-mocked)
grep -rn "fetch\|axios\|request" src/ --include="*.test.*" --include="*.spec.*" | grep -v "mock\|stub\|fake"

# Find skipped tests
grep -rn "\.skip\|\.only\|xdescribe\|xit\|xtest\|@pytest.mark.skip\|pytest.mark.xfail" src/
```

### Common Flaky Patterns

**Race conditions in tests:**
```typescript
// BAD: timing-dependent
it('should update UI', async () => {
  await clickButton();
  await new Promise(r => setTimeout(r, 100)); // flaky
  expect(await getText()).toBe('Updated');
});

// GOOD: wait for specific condition
it('should update UI', async () => {
  await clickButton();
  await waitFor(() => expect(getText()).resolves.toBe('Updated'));
});
```

**Shared state between tests:**
```typescript
// BAD: tests depend on execution order
let sharedData = [];
it('should add item', () => {
  sharedData.push('item');
  expect(sharedData).toHaveLength(1);
});
it('should have item', () => {
  expect(sharedData).toContain('item'); // fails if first test skipped
});

// GOOD: isolated tests
it('should add item', () => {
  const data = [];
  data.push('item');
  expect(data).toHaveLength(1);
});
```

**External dependencies not mocked:**
```python
# BAD: hits real API
def test_fetch_users():
    users = api.fetch_users()  # real HTTP call
    assert len(users) > 0

# GOOD: mocked
@patch('api.fetch_users')
def test_fetch_users(mock_fetch):
    mock_fetch.return_value = [{'id': 1}]
    users = api.fetch_users()
    assert len(users) == 0  # mock returns 1
```

### Flaky Test Indicators

| Pattern | Risk |
|---------|------|
| `setTimeout` in test | High |
| `sleep` in test | High |
| Network calls without mock | High |
| Shared mutable state | High |
| `Date.now()` in assertions | Medium |
| Random data in tests | Medium |
| `Math.random()` in tests | Medium |
| Order-dependent tests | High |
| Tests that modify global state | High |

---

## Test Quality Debt

### Assertion Quality

**Weak assertions:**
```typescript
// BAD: no meaningful assertion
it('should work', () => {
  const result = doSomething();
  expect(result).toBeTruthy(); // what does this verify?
});

// BAD: snapshot-only testing
it('should render correctly', () => {
  const tree = renderer.create(<Component />).toJSON();
  expect(tree).toMatchSnapshot(); // doesn't verify behavior
});

// GOOD: specific assertions
it('should calculate total price with tax', () => {
  const result = calculateTotal(100, 0.2);
  expect(result).toBe(120);
  expect(typeof result).toBe('number');
});

// GOOD: behavior-focused
it('should display error when form is submitted empty', () => {
  render(<Form />);
  fireEvent.click(submitButton);
  expect(screen.getByText('Name is required')).toBeInTheDocument();
});
```

### Test Structure

**Missing Arrange-Act-Assert:**
```typescript
// BAD: unclear structure
it('should do things', () => {
  const user = { name: 'John' };
  const result = processUser(user);
  expect(result.name).toBe('JOHN');
  const other = transform(result);
  expect(other).toBeDefined();
});

// GOOD: clear AAA structure
it('should uppercase user name and add timestamp', () => {
  // Arrange
  const user = { name: 'John' };
  
  // Act
  const result = processUser(user);
  
  // Assert
  expect(result.name).toBe('JOHN');
  expect(result.createdAt).toBeDefined();
});
```

### Missing Test Configuration

**TypeScript:**
```bash
# Check for test config files
ls jest.config.* vitest.config.* .mocharc.* 2>/dev/null

# Check for test setup
ls setupTests.* setup.ts setup.js test-setup.* 2>/dev/null
```

**Python:**
```bash
# Check for test config
ls pytest.ini setup.cfg pyproject.toml tox.ini 2>/dev/null

# Check pytest sections
grep -n "\[tool.pytest" pyproject.toml 2>/dev/null
```

---

## Skipped Tests

### Detection

```bash
# Find all skipped tests
grep -rn "\.skip\|\.only\|xdescribe\|xit\|xtest\|@pytest.mark.skip\|pytest.mark.xfail\|@unittest.skip" src/

# Find TODO/FIXME in tests
grep -rn "TODO\|FIXME\|HACK" src/ --include="*.test.*" --include="*.spec.*"
```

### Classification

| Type | Action |
|------|--------|
| `.skip` (temporary) | Fix within current sprint |
| `.skip` (long-term) | Flag as debt, create ticket |
| `.only` (development leftover) | Remove immediately |
| `xfail` (expected failure) | Create ticket for fix |
| `TODO` in test | Create ticket for completion |

---

## Test Infrastructure Debt

### Missing Test Isolation

```python
# BAD: tests share database state
@pytest.fixture(autouse=True)
def setup_database():
    db.create_tables()  # shared across all tests

# GOOD: transaction rollback
@pytest.fixture(autouse=True)
def isolated_database():
    db.begin()
    yield
    db.rollback()
```

### Missing Mock Patterns

```typescript
// BAD: manual mock creation
jest.spyOn(module, 'function').mockImplementation(() => {});

// GOOD: structured mocking with MSW or similar
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

server.use(
  http.get('/api/users', () => {
    return HttpResponse.json([{ id: 1, name: 'Test' }]);
  })
);
```

### Missing Test Data Factories

```python
# BAD: hardcoded test data
def test_user():
    user = User(name='John', email='john@test.com', age=25, role='admin')
    # same data every test

# GOOD: factory pattern
def test_user():
    user = UserFactory()  # random valid data each time
    user2 = UserFactory(role='admin')  # override specific field
```

---

## Detection Commands

```bash
# TypeScript: find test coverage report
npx jest --coverage 2>/dev/null | tail -20

# Python: find test coverage
python -m pytest --cov=src --cov-report=term-missing 2>/dev/null | tail -20

# Find all test files
find . -name "*.test.*" -o -name "*.spec.*" -o -name "test_*.py" -o -name "*_test.py" | wc -l

# Find skipped tests
grep -rn "\.skip\|\.only\|xdescribe\|xit\|xtest\|@pytest.mark.skip\|pytest.mark.xfail" --include="*.test.*" --include="*.spec.*" .

# Count test assertions
grep -rn "expect\|assert\|assertThat" --include="*.test.*" --include="*.spec.*" . | wc -l
```
