# Cache Anti-Patterns

Detection patterns for cache stampede, avalanche, penetration, cold start, unbounded cache, wrong TTL, and cache inconsistency.

## 1. Cache Stampede

**What:** Many requests simultaneously recalculate the same cache key after it expires, overwhelming the backend.

**Detection patterns:**

```regex
# Cache miss triggering recalculation without coalescing
if.*not in.*cache|if.*cache\.get.*None|if.*!.*cache\[

# No mutex/lock around cache population
set\(|__setitem__|put\(.*\)(?!.*lock|.*mutex|.*atomic)
```

**Code example:**

```python
# BAD — Cache stampede
cache = {}

def get_user(user_id):
    if user_id not in cache:  # ← 1000 requests see miss simultaneously
        cache[user_id] = db.query(f"SELECT * FROM users WHERE id = {user_id}")
    return cache[user_id]

# GOOD — Request coalescing
import threading

_locks = {}
_data = {}

def get_user(user_id):
    if user_id in _data:
        return _data[user_id]

    if user_id not in _locks:
        _locks[user_id] = threading.Lock()

    with _locks[user_id]:
        if user_id in _data:  # Double-check
            return _data[user_id]
        _data[user_id] = db.query("SELECT * FROM users WHERE id = %s", (user_id,))
        return _data[user_id]
```

```javascript
// BAD — Cache stampede
const cache = new Map();

async function getUser(id) {
    if (!cache.has(id)) {
        cache.set(id, await db.query('SELECT * FROM users WHERE id = ?', [id]));
    }
    return cache.get(id);
}

// GOOD — Request coalescing
const cache = new Map();
const pending = new Map();

async function getUser(id) {
    if (cache.has(id)) return cache.get(id);
    if (pending.has(id)) return pending.get(id);

    const promise = db.query('SELECT * FROM users WHERE id = ?', [id]);
    pending.set(id, promise);

    try {
        const result = await promise;
        cache.set(id, result);
        return result;
    } finally {
        pending.delete(id);
    }
}
```

**Severity:** High (backend overload)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 2. Cache Avalanche

**What:** Many cache keys expire at the same time, causing a sudden spike of database queries.

**Detection patterns:**

```regex
# Uniform TTL for all keys
expire\(|setex\(|TTL\s*=\s*\d+(?!.*jitter|.*random|.*vary)

# Bulk cache population with same TTL
mset|set_many|putAll.*TTL
```

**Code example:**

```python
# BAD — Cache avalanche (all keys expire at once)
def cache_users(users):
    for user in users:
        cache.set(f"user:{user.id}", user, ttl=3600)  # All expire at t+3600

# GOOD — Jittered TTL
import random

def cache_users(users):
    for user in users:
        base_ttl = 3600
        jitter = random.randint(0, 300)  # ±5 min spread
        cache.set(f"user:{user.id}", user, ttl=base_ttl + jitter)

# BETTER — Use tiered TTLs
def cache_users(users):
    for user in users:
        tier = hash(user.id) % 3  # 0, 1, or 2
        ttl = 3600 + (tier * 600)  # 1h, 1h10m, 1h20m
        cache.set(f"user:{user.id}", user, ttl=ttl)
```

**Severity:** High (database overload at predictable times)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 3. Cache Penetration

**What:** Queries for non-existent keys bypass the cache and hit the database every time.

**Detection patterns:**

```regex
# No negative caching
if.*not in cache.*\n.*db\.query(?!.*negative|.*null.*cache|.*empty.*cache)

# No bloom filter for existence checks
```

**Code example:**

```python
# BAD — Cache penetration (non-existent keys always hit DB)
def get_product(product_id):
    if product_id not in cache:
        result = db.query("SELECT * FROM products WHERE id = %s", (product_id,))
        if result:
            cache.set(f"product:{product_id}", result, ttl=3600)
        # ← Non-existent key: next request hits DB again
    return cache.get(product_id)

# GOOD — Negative caching
NULL_SENTINEL = object()

def get_product(product_id):
    cached = cache.get(f"product:{product_id}")
    if cached is NULL_SENTINEL:
        return None  # Cached as non-existent
    if cached is not None:
        return cached

    result = db.query("SELECT * FROM products WHERE id = %s", (product_id,))
    if result:
        cache.set(f"product:{product_id}", result, ttl=3600)
    else:
        cache.set(f"product:{product_id}", NULL_SENTINEL, ttl=300)  # Short TTL for negatives
    return result
```

```javascript
// BAD — Cache penetration
async function getProduct(id) {
    let result = cache.get(`product:${id}`);
    if (!result) {
        result = await db.query('SELECT * FROM products WHERE id = ?', [id]);
        if (result) cache.set(`product:${id}`, result, { ttl: 3600 });
        // ← Non-existent key bypasses cache every time
    }
    return result;
}

// GOOD — Negative caching with bloom filter
const NULL_SENTINEL = '__NULL__';

async function getProduct(id) {
    const cached = cache.get(`product:${id}`);
    if (cached === NULL_SENTINEL) return null;
    if (cached) return cached;

    const result = await db.query('SELECT * FROM products WHERE id = ?', [id]);
    cache.set(`product:${id}`, result || NULL_SENTINEL, { ttl: result ? 3600 : 300 });
    return result;
}
```

**Severity:** Medium (database load from repeated non-existent queries)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 4. Cold Start Problem

**What:** Cache is empty at application startup, causing a thundering herd of database queries.

**Detection patterns:**

```regex
# No cache warming on startup
# Check: is there a warming/preloading step at app init?

# Application start without cache preloading
app\.listen|if __name__|main\(\)|func main\(\)
(?!.*warm|.*preload|.*hydrate|.*prime)
```

**Code example:**

```python
# BAD — Cold start (cache empty at boot)
# Application starts, first 1000 requests all hit DB
app = Flask(__name__)

@app.route('/users/<int:id>')
def get_user(id):
    if id not in cache:
        cache[id] = db.query(...)
    return cache[id]

# GOOD — Cache warming on startup
app = Flask(__name__)

@app.before_first_request
def warm_cache():
    """Preload hot data into cache at startup."""
    top_users = db.query("SELECT * FROM users ORDER BY score DESC LIMIT 1000")
    for user in top_users:
        cache.set(f"user:{user.id}", user, ttl=3600)

# BETTER — Background warming
import threading

def warm_cache_background():
    top_users = db.query("SELECT * FROM users ORDER BY score DESC LIMIT 1000")
    for user in top_users:
        cache.set(f"user:{user.id}", user, ttl=3600)

@app.before_first_request
def start_warming():
    threading.Thread(target=warm_cache_background, daemon=True).start()
```

**Severity:** Medium (degraded startup performance)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 5. Unbounded Cache

**What:** Cache grows indefinitely without eviction, eventually causing out-of-memory errors.

**Detection patterns:**

```regex
# Cache without size limit
cache\s*=\s*\{\}|new Map\(\)|new Dict\(\)|cache\s*=\s*dict\(\)
(?!.*maxsize|.*max_size|.*maxEntries|.*LRU|.*lru)

# Set/add without eviction check
\.set\(|\.put\(|__setitem__|cache\[.*\]\s*=
(?!.*evict|.*trim|.*prune|.*maxsize)
```

**Code example:**

```python
# BAD — Unbounded cache
cache = {}

def get_data(key):
    if key not in cache:
        cache[key] = expensive_query(key)
    return cache[key]

# Memory grows forever

# GOOD — Bounded cache with LRU eviction
from functools import lru_cache

@lru_cache(maxsize=1024)
def get_data(key):
    return expensive_query(key)

# BETTER — Use a proper cache library
from cachetools import LRUCache

cache = LRUCache(maxsize=1024)

def get_data(key):
    if key not in cache:
        cache[key] = expensive_query(key)
    return cache[key]
```

```javascript
// BAD — Unbounded cache
const cache = new Map();

function getData(key) {
    if (!cache.has(key)) {
        cache.set(key, expensiveQuery(key));
    }
    return cache.get(key);
}

// GOOD — Bounded cache with LRU
class LRUCache {
    constructor(maxSize = 1024) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value); // Move to end (most recent)
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value); // Evict oldest
        }
        this.cache.set(key, value);
    }
}
```

**Severity:** High (memory leak in long-running processes)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 6. Cache Inconsistency

**What:** Cache is not invalidated when the underlying data changes, serving stale data.

**Detection patterns:**

```regex
# Write without cache invalidation
INSERT|UPDATE|DELETE|\.create\(|\.update\(|\.delete\(
(?!.*cache\.delete|.*cache\.invalidate|.*cache\.clear|.*evict)

# Cache set without version/timestamp check
cache\.set|cache\[.*\]\s*=|__setitem__
(?!.*version|.*etag|.*last_modified|.*updated_at)
```

**Code example:**

```python
# BAD — Cache inconsistency
def update_user(user_id, data):
    db.execute("UPDATE users SET name = %s WHERE id = %s", (data['name'], user_id))
    # ← Cache still holds old data

def get_user(user_id):
    if user_id not in cache:
        cache[user_id] = db.query("SELECT * FROM users WHERE id = %s", (user_id,))
    return cache[user_id]  # May return stale data

# GOOD — Invalidate on write
def update_user(user_id, data):
    db.execute("UPDATE users SET name = %s WHERE id = %s", (data['name'], user_id))
    cache.delete(f"user:{user_id}")  # Invalidate

def get_user(user_id):
    cached = cache.get(f"user:{user_id}")
    if cached is not None:
        return cached
    result = db.query("SELECT * FROM users WHERE id = %s", (user_id,))
    cache.set(f"user:{user_id}", result, ttl=3600)
    return result

# BETTER — Write-through cache
def update_user(user_id, data):
    db.execute("UPDATE users SET name = %s WHERE id = %s", (data['name'], user_id))
    user = db.query("SELECT * FROM users WHERE id = %s", (user_id,))
    cache.set(f"user:{user_id}", user, ttl=3600)  # Update cache immediately
```

**Severity:** High (stale data served to users)
**CWE:** CWE-711 (Improper Resolution of Path Equivalence)

---

## 7. Wrong TTL

**What:** TTL too short (constant recalculation) or too long (stale data).

**Detection patterns:**

```regex
# Very short TTL (< 10s for non-realtime data)
TTL\s*[=:]\s*[0-9]{1,2}\b|ttl\s*[=:]\s*[0-9]{1,2}\b

# Very long TTL (> 24h for mutable data)
TTL\s*[=:]\s*[0-9]{5,}|ttl\s*[=:]\s*[0-9]{5,}

# No TTL at all
cache\.set\(|\.put\(|__setitem__
(?!.*ttl|.*expire|.*TTL|.*EX)
```

**Severity:** Low-Medium (performance or freshness tradeoff)
**CWE:** CWE-711 (Improper Resolution of Path Equivalence)

---

## Severity Quick Reference

| Pattern | Typical Severity | Impact |
|---------|-----------------|--------|
| Cache stampede | High | Backend overload, timeout cascade |
| Cache avalanche | High | Database spike at predictable times |
| Cache penetration | Medium | Unnecessary DB load from non-existent keys |
| Cold start | Medium | Degraded startup, thundering herd at boot |
| Unbounded cache | High | Memory leak, OOM crash |
| Cache inconsistency | High | Stale data, incorrect business logic |
| Wrong TTL | Low-Medium | Performance or freshness degradation |

## Detection Checklist

- [ ] Cache population without request coalescing (stampede)
- [ ] Uniform TTL without jitter (avalanche)
- [ ] No negative caching for non-existent keys (penetration)
- [ ] No cache warming at startup (cold start)
- [ ] Cache without size limits or eviction (unbounded)
- [ ] Database writes without cache invalidation (inconsistency)
- [ ] TTL missing, too short, or too long (wrong TTL)
