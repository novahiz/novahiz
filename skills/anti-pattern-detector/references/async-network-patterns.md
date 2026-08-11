# Async/Network Anti-Patterns

Detection patterns for fire-and-forget, retry storms, missing circuit breaker, stale closures, event listener leaks, zombie processes, missing timeouts, and promise leaks.

## 1. Fire-and-Forget

**What:** An async operation is started but never awaited or caught, leading to unhandled rejections and silent failures.

**Detection patterns:**

```regex
# async function called without await
(?<!await\s)\w+\(.*\)(?!.*\.then|.*\.catch|.*await)

# Promise created but not returned or caught
new Promise\(|async\s+function.*\{[^}]*\}(?!.*await|.*\.catch)

# Event emitter emit without error handler
\.emit\(.*error|\.on\('error'(?!.*handler)
```

**Code example:**

```javascript
// BAD — Fire and forget
function processOrder(order) {
    awaitPayment(order.id);  // ← Not awaited, errors silently lost
    sendEmail(order.user);   // ← Not awaited
    updateInventory(order);  // ← Not awaited
}

// GOOD — Explicit async with error handling
async function processOrder(order) {
    try {
        await awaitPayment(order.id);
    } catch (e) {
        logger.error('Payment failed', { orderId: order.id, error: e });
        throw e;
    }

    try {
        await sendEmail(order.user);
    } catch (e) {
        logger.warn('Email failed (non-critical)', { error: e });
    }

    await updateInventory(order);
}

// BETTER — Use Promise.allSettled for parallel non-critical ops
async function processOrder(order) {
    await awaitPayment(order.id);

    const results = await Promise.allSettled([
        sendEmail(order.user),
        updateInventory(order),
    ]);

    results.forEach((r, i) => {
        if (r.status === 'rejected') {
            logger.error(`Task ${i} failed`, { error: r.reason });
        }
    });
}
```

```python
# BAD — Fire and forget
def process_order(order):
    await_payment(order.id)     # ← If sync, blocks silently
    send_email(order.user)      # ← If async, never awaited
    update_inventory(order)     # ← Errors lost

# GOOD — Explicit error handling
import asyncio

async def process_order(order):
    try:
        await await_payment(order.id)
    except Exception as e:
        logger.error(f"Payment failed: {e}")
        raise

    # Use asyncio.gather for parallel non-critical tasks
    results = await asyncio.gather(
        send_email(order.user),
        update_inventory(order),
        return_exceptions=True,
    )

    for r in results:
        if isinstance(r, Exception):
            logger.error(f"Task failed: {r}")
```

**Severity:** High (silent failures, data loss)
**CWE:** CWE-754 (Improper Check for Unusual or Exceptional Conditions)

---

## 2. Retry Storm

**What:** Retrying failed requests without backoff or limits, amplifying load on a struggling service.

**Detection patterns:**

```regex
# Immediate retry without delay
while.*retry|for.*retry.*\{[^}]*\}(?!.*delay|.*sleep|.*backoff|.*setTimeout)

# Retry without max attempt limit
while.*true.*\{.*try.*catch.*continue

# No exponential backoff
retry.*\{[^}]*\}(?!.*Math\.pow|.*2 \*\*|.*exponential|.*backoff)
```

**Code example:**

```javascript
// BAD — Retry storm
async function fetchWithRetry(url, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fetch(url);
        } catch (e) {
            // Immediately retries — 5 rapid requests
        }
    }
    throw new Error('Max retries exceeded');
}

// GOOD — Exponential backoff with jitter
async function fetchWithRetry(url, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fetch(url);
        } catch (e) {
            const delay = Math.min(1000 * 2 ** i, 30000);
            const jitter = delay * (0.5 + Math.random() * 0.5);
            await new Promise(r => setTimeout(r, jitter));
        }
    }
    throw new Error('Max retries exceeded');
}

// BETTER — Use a library with circuit breaker
const pRetry = require('p-retry');

const result = await pRetry(fetch, {
    retries: 5,
    minTimeout: 1000,
    maxTimeout: 30000,
    factor: 2,
});
```

```python
# BAD — Retry storm
def fetch_with_retry(url, max_retries=5):
    for i in range(max_retries):
        try:
            return requests.get(url)
        except:
            pass  # Immediate retry
    raise Exception("Max retries")

# GOOD — Exponential backoff
import time
import random

def fetch_with_retry(url, max_retries=5):
    for i in range(max_retries):
        try:
            return requests.get(url)
        except:
            delay = min(2 ** i, 30)
            jitter = delay * (0.5 + random.random() * 0.5)
            time.sleep(jitter)
    raise Exception("Max retries")

# BETTER — Use tenacity library
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, max=30))
def fetch_with_retry(url):
    return requests.get(url)
```

**Severity:** Critical (amplifies failures, causes cascading outages)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 3. Missing Circuit Breaker

**What:** Repeated calls to a failing downstream service without circuit breaking, wasting resources and delaying recovery.

**Detection patterns:**

```regex
# Direct downstream calls without circuit breaker pattern
fetch\(|requests\.get\(|http\.get\(|axios\.get\(
(?!.*circuit|.*breaker|.*bulkhead|.*fallback)

# No health check before calling downstream
# Check: does the code verify service health before calling?
```

**Code example:**

```javascript
// BAD — No circuit breaker
async function getUserProfile(userId) {
    const res = await fetch(`https://api UserService/profile/${userId}`);
    // ← If UserService is down, every request hangs/fails
    return res.json();
}

// GOOD — Circuit breaker pattern
class CircuitBreaker {
    constructor(fn, { threshold = 5, timeout = 30000 } = {}) {
        this.fn = fn;
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = Date.now();
    }

    async call(...args) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error('Circuit breaker is OPEN');
            }
            this.state = 'HALF_OPEN';
        }

        try {
            const result = await this.fn(...args);
            this.failures = 0;
            this.state = 'CLOSED';
            return result;
        } catch (e) {
            this.failures++;
            if (this.failures >= this.threshold) {
                this.state = 'OPEN';
                this.nextAttempt = Date.now() + this.timeout;
            }
            throw e;
        }
    }
}

const breaker = new CircuitBreaker(getUserProfile);
```

```python
# BAD — No circuit breaker
def get_user_profile(user_id):
    return requests.get(f"https://api UserService/profile/{user_id}")

# GOOD — Use pybreaker
import pybreaker

breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=30)

@breaker
def get_user_profile(user_id):
    return requests.get(f"https://api UserService/profile/{user_id}")
```

**Severity:** High (cascading failures, delayed recovery)
**CWE:** CWE-754 (Improper Check for Unusual or Exceptional Conditions)

---

## 4. Stale Closure

**What:** A closure captures a variable by reference, but the variable changes before the closure executes.

**Detection patterns:**

```regex
# Closure capturing loop variable
for.*\{.*function.*\{.*\}.*\}|for.*=>.*\{.*\}

# var in loop (function scope, not block scope)
for\s*\(\s*var\s+\w+
```

**Code example:**

```javascript
// BAD — Stale closure
for (var i = 0; i < 5; i++) {
    setTimeout(() => console.log(i), 1000);
}
// Output: 5, 5, 5, 5, 5 (not 0, 1, 2, 3, 4)

// GOOD — Use const/let (block scope)
for (let i = 0; i < 5; i++) {
    setTimeout(() => console.log(i), 1000);
}
// Output: 0, 1, 2, 3, 4

// BETTER — Capture explicitly
for (var i = 0; i < 5; i++) {
    ((captured) => {
        setTimeout(() => console.log(captured), 1000);
    })(i);
}
```

```python
# BAD — Stale closure
def create_processors():
    processors = []
    for name in ['a', 'b', 'c']:
        processors.append(lambda: process(name))  # ← All use 'c'
    return processors

# GOOD — Capture explicitly
def create_processors():
    processors = []
    for name in ['a', 'b', 'c']:
        processors.append(lambda n=name: process(n))  # Default arg captures
    return processors
```

**Severity:** Medium (incorrect behavior, hard to debug)
**CWE:** CWE-672 (Operation on Resource after Expiration)

---

## 5. Event Listener Leak

**What:** Event listeners are added but never removed, causing memory leaks and duplicate handler execution.

**Detection patterns:**

```regex
# addEventListener without removeEventListener
\.addEventListener\((?!.*removeEventListener)

# on() without off()
\.on\(.*\)(?!.*\.off\(|.*removeListener)

# React useEffect without cleanup
useEffect\(\(\)\s*=>\s*\{[^}]*addEventListener(?!.*return.*\(\)\s*=>)
```

**Code example:**

```javascript
// BAD — Event listener leak
useEffect(() => {
    window.addEventListener('resize', handleResize);
    // ← Never removed on unmount
}, []);

// GOOD — Cleanup in useEffect
useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
}, []);

// BAD — Node.js listener leak
const emitter = new EventEmitter();
emitter.on('data', handler);  // ← Never removed

// GOOD — Track and remove
function setup() {
    const handler = (data) => process(data);
    emitter.on('data', handler);
    return () => emitter.removeListener('data', handler);
}
```

**Severity:** High (memory leak, duplicate execution)
**CWE:** CWE-404 (Improper Resource Shutdown or Release)

---

## 6. Zombie Process

**What:** Child processes are spawned but never reaped, consuming system resources.

**Detection patterns:**

```regex
# spawn/exec without wait/reap
spawn\(|exec\(|child_process(?!.*\.kill|.*\.on\('exit'|.*wait|.*reap)

# Python subprocess without wait
subprocess\.Popen(?!.*\.wait\(\)|.*\.communicate\(\)|.*with\s)
```

**Code example:**

```python
# BAD — Zombie process
import subprocess

def run_command(cmd):
    proc = subprocess.Popen(cmd, shell=True)
    # ← Never waited, zombie process created

# GOOD — Wait for completion
def run_command(cmd):
    proc = subprocess.Popen(cmd, shell=True)
    proc.wait()

# BETTER — Use context manager
def run_command(cmd):
    with subprocess.Popen(cmd, shell=True) as proc:
        stdout, stderr = proc.communicate()
```

```javascript
// BAD — Zombie process
const { spawn } = require('child_process');

function runCommand(cmd) {
    const child = spawn('sh', ['-c', cmd]);
    // ← Never killed or waited on
}

// GOOD — Handle exit
function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', cmd]);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Exit code ${code}`));
        });
        child.on('error', reject);
    });
}
```

**Severity:** Medium (resource exhaustion)
**CWE:** CWE-404 (Improper Resource Shutdown or Release)

---

## 7. Missing Timeout

**What:** Network calls without timeouts can hang indefinitely, blocking threads/resources.

**Detection patterns:**

```regex
# fetch/requests without timeout
fetch\(|requests\.get\(|axios\.get\(|http\.get\(
(?!.*timeout|.*AbortController|.*signal|.*cancel)

# Database query without timeout
\.query\(|\.execute\(|\.find\(
(?!.*timeout|.*statement_timeout|.*maxTimeMS)
```

**Code example:**

```javascript
// BAD — Missing timeout
async function getData() {
    const res = await fetch('https://api.example.com/data');
    return res.json();
}

// GOOD — AbortController with timeout
async function getData() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const res = await fetch('https://api.example.com/data', {
            signal: controller.signal,
        });
        return res.json();
    } finally {
        clearTimeout(timeout);
    }
}
```

```python
# BAD — Missing timeout
def get_data():
    return requests.get('https://api.example.com/data')

# GOOD — Timeout
def get_data():
    return requests.get('https://api.example.com/data', timeout=5)
```

**Severity:** High (thread blocking, resource exhaustion)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 8. Promise Leak

**What:** Promises are created but never resolved or rejected, accumulating in memory.

**Detection patterns:**

```regex
# Promise constructor without resolve/reject calls in all paths
new Promise\((?!.*resolve|.*reject)

# Missing .catch() on promise chains
\.then\(.*\)(?!.*\.catch|.*try|.*await)

# Promise stored but never awaited
const\s+\w+\s*=\s*new Promise|let\s+\w+\s*=\s*new Promise
(?!.*await|.*\.then|.*\.catch)
```

**Code example:**

```javascript
// BAD — Promise leak
function doWork() {
    return new Promise((resolve) => {
        if (someCondition) {
            resolve('done');
        }
        // ← If !someCondition, promise never resolves
    });
}

// GOOD — All paths resolve/reject
function doWork() {
    return new Promise((resolve, reject) => {
        if (someCondition) {
            resolve('done');
        } else {
            reject(new Error('Condition not met'));
        }
    });
}

// BETTER — Use async/await
async function doWork() {
    if (someCondition) return 'done';
    throw new Error('Condition not met');
}
```

**Severity:** Medium (memory leak, dangling promises)
**CWE:** CWE-404 (Improper Resource Shutdown or Release)

---

## Severity Quick Reference

| Pattern | Typical Severity | Impact |
|---------|-----------------|--------|
| Fire-and-forget | High | Silent failures, data loss |
| Retry storm | Critical | Cascading outages, amplification |
| Missing circuit breaker | High | Cascading failures, delayed recovery |
| Stale closure | Medium | Incorrect behavior, hard to debug |
| Event listener leak | High | Memory leak, duplicate execution |
| Zombie process | Medium | Resource exhaustion |
| Missing timeout | High | Thread blocking, hanging |
| Promise leak | Medium | Memory leak, dangling state |

## Detection Checklist

- [ ] Async function called without await or .catch()
- [ ] Retry without exponential backoff or jitter
- [ ] Retry without max attempt limit
- [ ] No circuit breaker for downstream calls
- [ ] Closure captures loop variable (stale closure)
- [ ] addEventListener without removeEventListener
- [ ] useEffect with side effects but no cleanup function
- [ ] Child process spawned without wait/reap
- [ ] Network call without timeout or AbortController
- [ ] Promise constructor with conditional resolve/reject
