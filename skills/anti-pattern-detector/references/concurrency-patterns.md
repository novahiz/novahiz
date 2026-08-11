# Concurrency Anti-Patterns

Detection patterns for race conditions, deadlocks, livelock, starvation, TOCTOU, ABA problem, and thundering herd.

## 1. Race Condition

**What:** Two or more threads access shared mutable state concurrently without synchronization, leading to non-deterministic behavior.

**Detection patterns:**

```regex
# Python — shared mutable state without lock
# Pattern: global/var modified in function without threading.Lock
global\s+\w+.*\n(?!.*lock|.*Lock|.*atomic)

# JavaScript/TypeScript — shared state in async
# Pattern: let/const mutated across async boundaries without synchronization
await.*\n.*\1\s*[+\-]?=

# Go — goroutine modifying shared variable
go\s+func.*\{[^}]*\w+\s*=\s*
```

**Code example:**

```python
# BAD — Race condition
counter = 0

def increment():
    global counter
    temp = counter      # Read
    # ← Thread switch can happen here
    counter = temp + 1  # Write based on stale value

# GOOD — Atomic operation
import threading
lock = threading.Lock()

def increment():
    global counter
    with lock:
        counter += 1

# BETTER — Use atomic type
from atomic import AtomicLong
counter = AtomicLong(0)

def increment():
    counter.value += 1  # Atomic
```

```javascript
// BAD — Race condition in async
let balance = 0;

async function withdraw(amount) {
    const current = balance;      // Read
    await someAsyncOperation();   // ← Other writes can happen here
    balance = current - amount;   // Write based on stale value
}

// GOOD — Mutex/semaphore pattern
const mutex = new Mutex();

async function withdraw(amount) {
    await mutex.runExclusive(async () => {
        balance -= amount;
    });
}
```

```go
// BAD — Race condition
var counter int

func increment() {
    counter++ // NOT atomic
}

// GOOD — Atomic operation
import "sync/atomic"

func increment() {
    atomic.AddInt64(&counter, 1)
}

// BETTER — Use a channel for synchronization
ch := make(chan int, 1)
ch <- 0

func increment() {
    val := <-ch
    ch <- val + 1
}
```

**Severity:** Critical (data corruption), High (incorrect results)
**CWE:** CWE-362 (Race Condition), CWE-662 (Improper Synchronization)

---

## 2. Deadlock

**What:** Two or more threads wait for each other to release resources, creating a circular dependency that prevents all progress.

**Detection patterns:**

```regex
# Lock ordering violation — acquiring locks in different orders
# Pattern: Two functions acquire the same locks in opposite order
def\s+\w+.*:\s*\n.*lock_a\.acquire\(\).*\n.*lock_b\.acquire\(\)
def\s+\w+.*:\s*\n.*lock_b\.acquire\(\).*\n.*lock_a\.acquire\(\)

# Missing timeout on lock acquisition
\.acquire\(\)(?!.*timeout)

# Missing try/finally for lock release
\.acquire\(\)(?!.*finally)
```

**Code example:**

```python
# BAD — Deadlock (lock ordering violation)
lock_a = threading.Lock()
lock_b = threading.Lock()

def transfer_a():
    with lock_a:
        with lock_b:  # Waits for lock_b
            pass

def transfer_b():
    with lock_b:
        with lock_a:  # Waits for lock_a → DEADLOCK
            pass

# GOOD — Consistent lock ordering
def transfer_a():
    with lock_a:
        with lock_b:
            pass

def transfer_b():
    with lock_a:  # Same order as transfer_a
        with lock_b:
            pass

# BETTER — Use a single lock or lock hierarchy
lock = threading.Lock()

def transfer():
    with lock:
        pass
```

```go
// BAD — Deadlock
var mu1, mu2 sync.Mutex

func goroutine1() {
    mu1.Lock()
    mu2.Lock() // Waits for mu2
    defer mu2.Unlock()
    defer mu1.Unlock()
}

func goroutine2() {
    mu2.Lock()
    mu1.Lock() // Waits for mu1 → DEADLOCK
    defer mu1.Unlock()
    defer mu2.Unlock()
}

// GOOD — Consistent lock ordering
func goroutine1() {
    mu1.Lock()
    mu2.Lock()
    defer mu2.Unlock()
    defer mu1.Unlock()
}

func goroutine2() {
    mu1.Lock() // Same order
    mu2.Lock()
    defer mu2.Unlock()
    defer mu1.Unlock()
}
```

**Severity:** Critical (production hang)
**CWE:** CWE-667 (Improper Locking)

---

## 3. TOCTOU (Time-of-Check to Time-of-Use)

**What:** A resource is checked for a condition, then used based on that check — but the condition can change between check and use.

**Detection patterns:**

```regex
# File existence check followed by open
if\s+os\.path\.exists.*:\s*\n.*open\(
# or
if\s+fs\.existsSync.*\n.*fs\.(open|read|write)

# Permission check followed by action
if\s+os\.access.*:\s*\n.*os\.
```

**Code example:**

```python
# BAD — TOCTOU
import os

def read_config(path):
    if os.path.exists(path):      # CHECK
        # ← File could be deleted here by another process
        with open(path) as f:     # USE
            return f.read()

# GOOD — Handle the error
def read_config(path):
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return None

# BETTER — Use atomic operations
def read_config(path):
    fd = os.open(path, os.O_RDONLY | os.O_CREAT, 0o600)
    try:
        return os.read(fd, 1024).decode()
    finally:
        os.close(fd)
```

```javascript
// BAD — TOCTOU
const fs = require('fs');

async function readConfig(path) {
    if (fs.existsSync(path)) {        // CHECK
        // ← File could be deleted here
        return fs.readFileSync(path);  // USE
    }
}

// GOOD — Handle the error
async function readConfig(path) {
    try {
        return fs.readFileSync(path);
    } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }
}
```

**Severity:** High (security + data integrity)
**CWE:** CWE-367 (TOCTOU Race Condition)

---

## 4. ABA Problem

**What:** A value is read as A, changed to B, then changed back to A. A compare-and-swap operation sees A and assumes nothing changed, but the state has changed underneath.

**Detection patterns:**

```regex
# Compare-and-swap without versioning
CAS|compareAndSet|compare_exchange

# Shared variable read-compare-write without version counter
while.*==.*\{.*=.*\}
```

**Code example:**

```java
// BAD — ABA problem
AtomicReference<Node> head = new AtomicReference<>();

void pop() {
    Node oldHead = head.get();
    Node newHead = oldHead.next;
    // ← Between get() and compareAndSet(), another thread
    //   could pop oldHead, pop newHead, push oldHead back
    head.compareAndSet(oldHead, newHead); // Silently succeeds with wrong state
}

// GOOD — Use versioned atomic (AtomicStampedReference)
AtomicStampedReference<Node> head = new AtomicStampedReference<>(null, 0);

void pop() {
    int[] stamp = new int[1];
    Node oldHead = head.get(stamp);
    int oldStamp = stamp[0];
    Node newHead = oldHead.next;
    // Version changes even if value returns to A
    head.compareAndSet(oldHead, newHead, oldStamp, oldStamp + 1);
}
```

```go
// BAD — ABA problem with atomic.Value
var head atomic.Value

func pop() {
    oldHead := head.Load().(*Node)
    newHead := oldHead.next
    head.CompareAndSwap(oldHead, newHead) // ABA possible
}

// GOOD — Use version counter
type versionedHead struct {
    node    *Node
    version uint64
}

var vh atomic.Value

func pop() {
    old := vh.Load().(versionedHead)
    new := versionedHead{node: old.node.next, version: old.version + 1}
    vh.CompareAndSwap(old, new)
}
```

**Severity:** Medium (data corruption in concurrent data structures)
**CWE:** CWE-362 (Race Condition)

---

## 5. Livelock

**What:** Threads are actively executing but making no progress because they keep responding to each other's state changes.

**Detection patterns:**

```regex
# Retry loop that responds to other thread's state
while.*\{.*if.*state.*==.*\{.*state\s*=\s*other\}

# Backoff that always yields to the other party
yield|sleep|backoff.*inside.*while.*contention
```

**Code example:**

```python
# BAD — Livelock
class Worker:
    def __init__(self):
        self.active = True

    def work(self, other):
        while self.active:
            if other.active:
                self.active = False  # Yield to other
                other.active = False  # Other also yields
                self.active = True   # Both retry simultaneously
                other.active = True
                continue
            # Do work
            break

# GOOD — Random backoff
import random

class Worker:
    def __init__(self):
        self.active = True

    def work(self, other):
        while self.active:
            if other.active:
                time.sleep(random.uniform(0.01, 0.1))
                continue
            # Do work
            break
```

**Severity:** High (system appears alive but does nothing)
**CWE:** CWE-835 (Infinite Loop)

---

## 6. Starvation

**What:** A thread never gets access to a resource because other threads always acquire it first.

**Detection patterns:**

```regex
# Priority inversion without priority inheritance
# Thread with high priority waits on thread with low priority

# Unfair lock usage
Lock\(\)(?!.*fair=True|.*FairLock)
ReentrantLock\(\)(?!.*fair.*true)
```

**Code example:**

```python
# BAD — Starvation possible with unfair lock
lock = threading.Lock()

def high_priority_work():
    while True:
        with lock:
            process()

def low_priority_work():
    with lock:
        process()

# Thread pool may starve low_priority_work

# GOOD — Use fair lock or FIFO queue
import queue

work_queue = queue.Queue()

def worker():
    while True:
        task = work_queue.get()
        task()
        work_queue.task_done()

# Or in Python 3.12+
lock = threading.RLock()  # Fair by default in some impls
```

**Severity:** Medium (degraded responsiveness)
**CWE:** CWE-835 (Infinite Loop)

---

## 7. Thundering Herd

**What:** Many threads/processes wake up simultaneously to handle a single event, causing resource contention and degraded performance.

**Detection patterns:**

```regex
# Cache key expiration triggering multiple recalculations
notify_all|notifyAll|broadcast.*\n.*recalc|refresh|recompute

# Single lock with many waiters
condition\.wait.*\n.*notify_all

# No request coalescing
```

**Code example:**

```python
# BAD — Thundering herd on cache miss
cache = {}

def get_data(key):
    if key not in cache:
        # ← 1000 threads all see cache miss simultaneously
        cache[key] expensive_computation(key)
    return cache[key]

# GOOD — Request coalescing with lock per key
import threading

locks = {}
data = {}

def get_data(key):
    if key in data:
        return data[key]

    if key not in locks:
        locks[key] = threading.Lock()

    with locks[key]:
        if key in data:  # Double-check after acquiring lock
            return data[key]
        data[key] = expensive_computation(key)
        return data[key]

# BETTER — Use a caching library with built-in coalescing
from functools import lru_cache

@lru_cache(maxsize=128)
def get_data(key):
    return expensive_computation(key)
```

```javascript
// BAD — Thundering herd
let cached = null;

async function getData() {
    if (!cached) {
        // ← N requests all compute simultaneously
        cached = await expensiveComputation();
    }
    return cached;
}

// GOOD — Request coalescing
let pending = null;

async function getData() {
    if (cached) return cached;
    if (pending) return pending;  // Reuse in-flight request

    pending = expensiveComputation();
    try {
        cached = await pending;
        return cached;
    } finally {
        pending = null;
    }
}
```

**Severity:** High (performance cliff under load)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## Severity Quick Reference

| Pattern | Typical Severity | Impact |
|---------|-----------------|--------|
| Race condition | Critical/High | Data corruption, incorrect results |
| Deadlock | Critical | Production hang, service outage |
| TOCTOU | High | Security bypass, data integrity |
| ABA | Medium | Concurrent data structure corruption |
| Livelock | High | System alive but non-functional |
| Starvation | Medium | Degraded responsiveness |
| Thundering herd | High | Performance cliff under load |

## Detection Checklist

- [ ] Shared mutable state accessed without synchronization
- [ ] Locks acquired in inconsistent order across code paths
- [ ] Lock acquisition without timeout
- [ ] Lock acquired without try/finally for release
- [ ] File/resource check followed by separate open (TOCTOU)
- [ ] Compare-and-swap without version counter
- [ ] Retry loops that always yield to the same party
- [ ] Single lock with many concurrent waiters
- [ ] No request coalescing for expensive operations
- [ ] Missing circuit breaker for downstream calls
