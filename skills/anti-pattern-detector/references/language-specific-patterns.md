# Language-Specific Anti-Patterns

Detection patterns for JavaScript/TypeScript, Python, Go, Rust, and Java specific pitfalls.

## JavaScript / TypeScript

### 1. Promise/Async Confusion

**What:** Mixing promises and async/await incorrectly, leading to unhandled rejections or sequential execution.

**Detection patterns:**

```regex
# async function returning a promise of a promise
async.*\{[^}]*return\s+await\s+\w+\(

# Missing await on async function call
(?<!await\s)\w+\(.*\)(?!.*\.then|.*\.catch)

# .then() after await (mixed patterns)
await.*\.then\(
```

**Code example:**

```javascript
// BAD — Return await (unnecessary wrapping)
async function getUser() {
    return await fetchUser();  // ← Redundant await
}

// GOOD — Direct return
async function getUser() {
    return fetchUser();
}

// BAD — Missing await
async function process() {
    saveToDatabase(data);  // ← Not awaited, errors lost
}

// GOOD — Always await
async function process() {
    await saveToDatabase(data);
}

// BAD — Mixing .then() and await
async function process() {
    const result = await fetch(url).then(r => r.json());  // ← Inconsistent
}

// GOOD — Consistent async/await
async function process() {
    const response = await fetch(url);
    const result = await response.json();
}
```

### 2. Stale Closure in React

**What:** Closure captures stale state in React hooks.

**Detection patterns:**

```regex
# useEffect with stale dependency
useEffect\(\(\)\s*=>\s*\{[^}]*state[^}]*\},\s*\[\]

# setTimeout/setInterval without cleanup
setTimeout\(|setInterval\((?!.*clearTimeout|.*clearInterval)

# Event listener without cleanup
addEventListener\((?!.*removeEventListener)
```

**Code example:**

```javascript
// BAD — Stale closure
function Counter() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            console.log(count);  // ← Always logs initial value
            setCount(count + 1); // ← Always sets to 1
        }, 1000);
        return () => clearInterval(interval);
    }, []);  // ← Missing dependency
}

// GOOD — Use functional update
function Counter() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCount(prev => prev + 1);  // ← Uses latest state
        }, 1000);
        return () => clearInterval(interval);
    }, []);
}

// BETTER — Use ref for latest value
function Counter() {
    const [count, setCount] = useState(0);
    const countRef = useRef(count);

    useEffect(() => {
        countRef.current = count;
    }, [count]);

    useEffect(() => {
        const interval = setInterval(() => {
            console.log(countRef.current);  // ← Always current
        }, 1000);
        return () => clearInterval(interval);
    }, []);
}
```

### 3. `var` in Loops

**What:** `var` has function scope, causing all iterations to share the same variable.

**Detection patterns:**

```regex
for\s*\(\s*var\s+\w+
```

**Code example:**

```javascript
// BAD — var in loop
for (var i = 0; i < 5; i++) {
    setTimeout(() => console.log(i), 1000);
}
// Output: 5, 5, 5, 5, 5

// GOOD — let (block scope)
for (let i = 0; i < 5; i++) {
    setTimeout(() => console.log(i), 1000);
}
// Output: 0, 1, 2, 3, 4
```

### 4. `==` vs `===`

**What:** Loose equality causes unexpected type coercion.

**Detection patterns:**

```regex
[^!=]==[^=]
```

**Code example:**

```javascript
// BAD — Loose equality
0 == ''      // true
null == undefined  // true
'0' == false  // true

// GOOD — Strict equality
0 === ''      // false
null === undefined  // false
'0' === false  // false
```

---

## Python

### 1. Mutable Default Arguments

**What:** Default arguments are evaluated once at function definition, not at each call.

**Detection patterns:**

```regex
def\s+\w+\(.*=\s*(\[\]|\{\}|set\(\))
```

**Code example:**

```python
# BAD — Mutable default
def append_to(item, target=[]):
    target.append(item)
    return target

append_to(1)  # [1]
append_to(2)  # [1, 2] — NOT [2]!

# GOOD — None default
def append_to(item, target=None):
    if target is None:
        target = []
    target.append(item)
    return target

append_to(1)  # [1]
append_to(2)  # [2] ✓
```

### 2. GIL Contention

**What:** Python's Global Interpreter Lock prevents true parallelism for CPU-bound tasks.

**Detection patterns:**

```regex
# Threading for CPU-bound work
threading\.Thread|concurrent\.futures\.ThreadPoolExecutor
(?!.*I/O|.*network|.*http|.*file)

# CPU-intensive work in async context
async\s+def.*for.*in.*range\(|async\s+def.*while.*\{
```

**Code example:**

```python
# BAD — Threading for CPU-bound work
import threading

def cpu_intensive():
    return sum(i * i for i in range(10_000_000))

threads = [threading.Thread(target=cpu_intensive) for _ in range(4)]
# ← GIL prevents parallel execution

# GOOD — Use multiprocessing
from multiprocessing import Pool

def cpu_intensive():
    return sum(i * i for i in range(10_000_000))

with Pool(4) as p:
    results = p.map(cpu_intensive, range(4))

# BETTER — Use concurrent.futures
from concurrent.futures import ProcessPoolExecutor

with ProcessPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(cpu_intensive, range(4)))
```

### 3. Unclosed Resources

**What:** Files, connections, or sockets not properly closed.

**Detection patterns:**

```regex
open\((?!.*with\s|.*as\s|.*\.close\(\))
# or
open\([^)]*\)(?!.*with|.*as |.*\.close)
```

**Code example:**

```python
# BAD — Unclosed file
f = open('file.txt', 'r')
data = f.read()
# ← f never closed

# GOOD — Context manager
with open('file.txt', 'r') as f:
    data = f.read()
# ← Automatically closed

# BAD — Unclosed database connection
conn = psycopg2.connect(DATABASE_URL)
cursor = conn.cursor()
cursor.execute("SELECT 1")
# ← conn never closed

# GOOD — Context manager
with psycopg2.connect(DATABASE_URL) as conn:
    with conn.cursor() as cursor:
        cursor.execute("SELECT 1")
```

### 4. Late Binding Closure

**What:** Closure captures variable reference, not value, in list comprehensions.

**Detection patterns:**

```regex
\[.*lambda.*for.*in.*\]|\[.*lambda.*for.*in.*\(
```

**Code example:**

```python
# BAD — Late binding
funcs = [lambda: i for i in range(5)]
[f() for f in funcs]  # [4, 4, 4, 4, 4] — all use final i

# GOOD — Early binding
funcs = [lambda i=i: i for i in range(5)]
[f() for f in funcs]  # [0, 1, 2, 3, 4] ✓
```

---

## Go

### 1. Goroutine Leak

**What:** Goroutines that never terminate, consuming memory and threads.

**Detection patterns:**

```regex
go\s+func\(\)\s*\{[^}]*\}(?!.*done|.*cancel|.*ctx\.Done|.*quit|.*stop)

# Channel without close
make\(chan\s+\w+\)(?!.*close\(|.*<-done)
```

**Code example:**

```go
// BAD — Goroutine leak
func worker(data chan int) {
    for {
        val := <-data  // ← Blocks forever if channel closed
        process(val)
    }
}

// GOOD — Use context for cancellation
func worker(ctx context.Context, data chan int) {
    for {
        select {
        case <-ctx.Done():
            return  // ← Exits when context cancelled
        case val := <-data:
            process(val)
        }
    }
}

// BAD — Goroutine leak on error
func fetch(urls []string) []Result {
    results := make(chan Result)
    for _, url := range urls {
        go func(u string) {
            results <- fetchURL(u)  // ← If fetchURL blocks, goroutine leaks
        }(url)
    }
    var out []Result
    for range urls {
        out = append(out, <-results)
    }
    return out
}

// GOOD — Timeout and buffer
func fetch(urls []string) []Result {
    results := make(chan Result, len(urls))  // Buffered
    for _, url := range urls {
        go func(u string) {
            ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
            defer cancel()
            results <- fetchURL(ctx, u)
        }(url)
    }
    var out []Result
    for range urls {
        out = append(out, <-results)
    }
    return out
}
```

### 2. Nil Pointer Dereference

**What:** Accessing a method or field on a nil pointer, causing panic.

**Detection patterns:**

```regex
# Error check after pointer dereference (too late)
\*ptr|ptr\.\w+\n.*if.*err.*!=.*nil

# Missing nil check on interface/type assertion
\.\(type\)(?!.*ok|.*,\s*ok)
```

**Code example:**

```go
// BAD — Nil pointer dereference
func getFirst(items []string) string {
    return items[0]  // ← Panics if empty
}

// GOOD — Check before access
func getFirst(items []string) (string, error) {
    if len(items) == 0 {
        return "", errors.New("empty slice")
    }
    return items[0], nil
}

// BAD — Type assertion without ok check
func process(i interface{}) {
    s := i.(string)  // ← Panics if not string
    fmt.Println(s)
}

// GOOD — Type assertion with ok check
func process(i interface{}) {
    if s, ok := i.(string); ok {
        fmt.Println(s)
    }
}
```

### 3. Missing `defer` for Cleanup

**What:** Resources not released due to missing defer.

**Detection patterns:**

```regex
# File open without defer close
os\.Open\(|os\.Create\(|os\.OpenFile\(
(?!.*defer.*\.Close\(\))

# Lock without defer unlock
\.Lock\(\)(?!.*defer.*\.Unlock\(\))
```

**Code example:**

```go
// BAD — Missing defer
func readFile(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    data, err := io.ReadAll(f)
    // ← f never closed
    return data, err
}

// GOOD — Defer close
func readFile(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    return io.ReadAll(f)
}

// BAD — Missing defer unlock
func criticalSection() {
    mu.Lock()
    // ← If panic occurs, lock never released
    doWork()
    mu.Unlock()
}

// GOOD — Defer unlock
func criticalSection() {
    mu.Lock()
    defer mu.Unlock()
    doWork()
}
```

---

## Rust

### 1. Unwrap Panic

**What:** Using `.unwrap()` on `Result` or `Option` causes panic on error.

**Detection patterns:**

```regex
\.unwrap\(\)|\.expect\(
```

**Code example:**

```rust
// BAD — Unwrap panic
fn read_file(path: &str) -> String {
    let content = std::fs::read_to_string(path).unwrap();  // ← Panics if file missing
    content
}

// GOOD — Proper error handling
fn read_file(path: &str) -> Result<String, std::io::Error> {
    std::fs::read_to_string(path)
}

// BETTER — With context
fn read_file(path: &str) -> Result<String, anyhow::Error> {
    let content = std::fs::read_to_string(path)
        .context(format!("Failed to read {}", path))?;
    Ok(content)
}
```

### 2. Clone Abuse

**What:** Using `.clone()` everywhere to avoid borrowing issues, hurting performance.

**Detection patterns:**

```regex
\.clone\(\)(?!.*//.*necessary|.*//.*required)
```

**Code example:**

```rust
// BAD — Clone abuse
fn process(data: Vec<String>) -> Vec<String> {
    let cloned = data.clone();  // ← Unnecessary clone
    cloned.iter().map(|s| s.clone()).collect()
}

// GOOD — Borrowing
fn process(data: &[String]) -> Vec<String> {
    data.iter().map(|s| s.to_string()).collect()
}

// Accept references, not owned values
fn process(data: &[String]) -> Vec<String> {
    data.iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect()
}
```

### 3. Lifetime Issues

**What:** Incorrect lifetime annotations causing borrow checker errors.

**Detection patterns:**

```regex
# Multiple references without clear lifetime
&\w+.*&\w+(?!.*'a|.*'static|.* lifetime)

# Returning reference to local variable
return\s+&\w+(?!.*'static)
```

**Code example:**

```rust
// BAD — Returning reference to local variable
fn get_name() -> &str {
    let name = String::from("Alice");
    &name  // ← Dangling reference after function returns
}

// GOOD — Return owned value
fn get_name() -> String {
    String::from("Alice")
}

// Or return &'static str for string literals
fn get_name() -> &'static str {
    "Alice"
}
```

---

## Java

### 1. Boxing/Unboxing Overhead

**What:** Automatic boxing/unboxing in loops causing performance degradation.

**Detection patterns:**

```regex
# List<Integer> with autoboxing in loop
List<Integer>.*for.*\+\+|ArrayList<Integer>.*for.*\+\+

# Comparing boxed types with ==
Integer\s+\w+.*==\s*\d+|Long\s+\w+.*==\s*\d+
```

**Code example:**

```java
// BAD — Autoboxing in loop
List<Integer> list = new ArrayList<>();
for (int i = 0; i < 1000000; i++) {
    list.add(i);  // ← Autoboxing: int → Integer (1M allocations)
}

// GOOD — Use primitive-specialized collections or arrays
int[] array = new int[1000000];
for (int i = 0; i < 1000000; i++) {
    array[i] = i;  // ← No boxing
}

// BETTER — Use Eclipse Collections or HPPC
IntArrayList list = new IntArrayList();
for (int i = 0; i < 1000000; i++) {
    list.add(i);  // ← No boxing
}

// BAD — Comparing with ==
Integer a = 127;
Integer b = 127;
System.out.println(a == b);  // true (cached)

Integer c = 128;
Integer d = 128;
System.out.println(c == d);  // false! (not cached)

// GOOD — Use .equals()
System.out.println(c.equals(d));  // true
```

### 2. String Concatenation in Loop

**What:** Using `+` in loops creates O(n²) string allocations.

**Detection patterns:**

```regex
# String += in loop
\w+\s*\+=\s*".*".*for|String.*\+=.*for

# StringBuilder not used for loop concatenation
```

**Code example:**

```java
// BAD — String concatenation in loop
String result = "";
for (String item : items) {
    result += item + ", ";  // ← Creates new String each iteration
}

// GOOD — StringBuilder
StringBuilder sb = new StringBuilder();
for (String item : items) {
    sb.append(item).append(", ");
}
String result = sb.toString();

// BETTER — String.join (Java 8+)
String result = String.join(", ", items);
```

### 3. Missing try-with-resources

**What:** Resources not closed properly in exception paths.

**Detection patterns:**

```regex
# Connection/Stream without try-with-resources
getConnection\(\)|openConnection\(\)|new FileInputStream
(?!.*try\s*\(|.*try\s*\{
```

**Code example:**

```java
// BAD — Resource leak
Connection conn = DriverManager.getConnection(url);
PreparedStatement stmt = conn.prepareStatement(sql);
ResultSet rs = stmt.executeQuery();
// ← If exception before close, resources leak

// GOOD — Try-with-resources
try (Connection conn = DriverManager.getConnection(url);
     PreparedStatement stmt = conn.prepareStatement(sql);
     ResultSet rs = stmt.executeQuery()) {
    while (rs.next()) {
        process(rs);
    }
}
// ← Automatically closed even on exception
```

---

## Severity Quick Reference by Language

| Pattern | Language | Severity | Impact |
|---------|----------|----------|--------|
| Promise/async confusion | JS/TS | Medium | Unhandled rejections, sequential execution |
| Stale closure in React | JS/TS | Medium | Incorrect state, re-render loops |
| var in loops | JS/TS | Medium | Unexpected behavior |
| == vs === | JS/TS | Low | Type coercion bugs |
| Mutable default arguments | Python | High | Shared state between calls |
| GIL contention | Python | Medium | No parallelism for CPU-bound |
| Unclosed resources | Python | High | Resource leaks |
| Late binding closure | Python | Medium | Unexpected values |
| Goroutine leak | Go | High | Memory leak |
| Nil pointer dereference | Go | Critical | Panic |
| Missing defer | Go | High | Resource leaks |
| Unwrap panic | Rust | Critical | Panic on error |
| Clone abuse | Rust | Medium | Performance degradation |
| Lifetime issues | Rust | Medium | Compilation errors |
| Boxing/Unboxing overhead | Java | Medium | Performance degradation |
| String concat in loop | Java | Medium | O(n²) performance |
| Missing try-with-resources | Java | High | Resource leaks |

## Detection Checklist

- [ ] No `.unwrap()` on Result/Option in Rust
- [ ] No mutable default arguments in Python
- [ ] No `var` in loops in JavaScript
- [ ] No `==` (use `===`) in JavaScript
- [ ] No goroutine leaks (missing context/cancel) in Go
- [ ] No nil pointer dereference without check in Go
- [ ] All resources have `defer` (Go) or `with` (Python) for cleanup
- [ ] No string concatenation in loops (Java)
- [ ] No autoboxing in hot loops (Java)
- [ ] All Resources in try-with-resources (Java)
- [ ] No clone abuse (Rust)
- [ ] Proper lifetime annotations (Rust)
- [ ] All closures capture correct values (Python/JS)
