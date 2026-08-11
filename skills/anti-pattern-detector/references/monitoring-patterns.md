# Monitoring Anti-Patterns

Detection patterns for log flooding, missing structured logging, alert fatigue, missing health checks, no tracing, metric cardinality explosion, and PII in logs.

## 1. Log Flooding

**What:** Excessive logging that overwhelms storage, makes logs unreadable, and degrades performance.

**Detection patterns:**

```regex
# Logging inside tight loops
for.*\{[^}]*log\.|print\(|console\.log|logger\.

# Debug logging without level guard
logger\.debug\(|console\.debug\(|log\.debug\(
(?!.*isDebug|.*level.*debug|.*enabled)

# Logging full objects/array without size limit
log.*JSON\.stringify|log.*repr|log.*str\(.*\)
(?!.*truncat|.*limit|.*slice|.*[:100])
```

**Code example:**

```python
# BAD — Log flooding
def process_items(items):
    for item in items:
        logger.info(f"Processing item {item.id}")  # ← 10,000 log lines
        result = process(item)
        logger.info(f"Processed item {item.id}: {result}")  # ← 10,000 more

# GOOD — Log summary, debug for details
def process_items(items):
    logger.info(f"Processing {len(items)} items")
    for item in items:
        logger.debug(f"Processing item {item.id}")
        result = process(item)
        logger.debug(f"Processed item {item.id}")
    logger.info(f"Completed processing {len(items)} items")

# BETTER — Batch logging
def process_items(items):
    logger.info(f"Processing {len(items)} items")
    errors = []
    for item in items:
        try:
            process(item)
        except Exception as e:
            errors.append((item.id, str(e)))
    if errors:
        logger.warning(f"Failed items: {len(errors)}/{len(items)}", extra={"errors": errors[:10]})
```

**Severity:** Medium (log storage, readability)
**CWE:** CWE-778 (Insufficient Logging)

---

## 2. Missing Structured Logging

**What:** Logs are unstructured text, making them impossible to query, aggregate, or alert on.

**Detection patterns:**

```regex
# Unstructured log messages
print\(f"|console\.log\(`|logger\.info\(f"|log\(`.*\$\{

# String concatenation in logs
log\(\s*["'].*\+\s*\w+|print\(\s*["'].*\+\s*\w+

# Missing context in logs
logger\.error\(["']Error occurred["']\)(?!.*exc_info|.*extra|.*context|.*stacktrace)
```

**Code example:**

```python
# BAD — Unstructured logging
logger.error(f"Failed to process order {order_id} for user {user_id}")
logger.info(f"User {user.email} logged in from {request.remote_addr}")

# GOOD — Structured logging
logger.error("order_processing_failed",
    extra={
        "order_id": order_id,
        "user_id": user_id,
        "error_type": type(e).__name__,
    }
)

logger.info("user_login",
    extra={
        "user_id": user.id,
        "ip_address": request.remote_addr,
        "user_agent": request.user_agent.string,
    }
)

# BETTER — Use structlog or python-json-logger
import structlog

logger = structlog.get_logger()

logger.error("order_processing_failed", order_id=order_id, user_id=user_id)
```

```javascript
// BAD — Unstructured
console.log(`User ${user.email} performed action ${action}`);

// GOOD — Structured
logger.info('user_action', {
    userId: user.id,
    action: action,
    timestamp: new Date().toISOString(),
});
```

**Severity:** Medium (impossible to query/debug in production)
**CWE:** CWE-778 (Insufficient Logging)

---

## 3. Alert Fatigue

**What:** Too many alerts cause teams to ignore all of them, including critical ones.

**Detection patterns:**

```regex
# Alert on every error (no threshold/frequency)
alert.*error|notify.*error|pager.*error
(?!.*threshold|.*count|.*rate|.*consecutive|.*percentile)

# Alert on non-actionable conditions
alert.*warning|notify.*info
(?!.*action|.*runbook|.*remediation)

# No severity differentiation
alert\(|notify\(|send_alert\(
(?!.*severity|.*priority|.*critical|.*warning|.*info)
```

**Code example:**

```python
# BAD — Alert on every error (fatigue)
def handle_request(request):
    try:
        return process(request)
    except Exception as e:
        pagerduty.alert(f"Error: {e}")  # ← Alerts on every single error
        raise

# GOOD — Rate-limited, severity-based alerting
error_counts = defaultdict(int)

def handle_request(request):
    try:
        return process(request)
    except Exception as e:
        error_counts[type(e).__name__] += 1

        if error_counts[type(e).__name__] > 10:  # Threshold
            pagerduty.alert(
                severity="critical" if is_critical(e) else "warning",
                message=f"Repeated {type(e).__name__}: {error_counts[type(e).__name__]} occurrences",
                runbook="https://wiki/runbook/error-type",
            )
        raise

# BETTER — Use a proper alerting library with dedup
from prometheus_client import Counter

errors_total = Counter('errors_total', 'Total errors', ['type', 'severity'])

def handle_request(request):
    try:
        return process(request)
    except Exception as e:
        severity = "critical" if is_critical(e) else "warning"
        errors_total.labels(type=type(e).__name__, severity=severity).inc()
        raise
```

**Severity:** High (critical alerts missed)
**CWE:** CWE-778 (Insufficient Logging)

---

## 4. Missing Health Check

**What:** Service has no health check endpoint, making it impossible to detect failures.

**Detection patterns:**

```regex
# No /health or /healthz endpoint
# Check: does the app expose a health check?

# No readiness/liveness probes (Kubernetes)
# Check: are probes defined in deployment manifest?

# Health check that doesn't verify dependencies
health.*\{[^}]*return.*200|health.*\{[^}]*return.*ok
(?!.*database|.*redis|.*downstream|.*dependency)
```

**Code example:**

```python
# BAD — No health check or trivial health check
@app.route('/health')
def health():
    return {"status": "ok"}  # ← Doesn't verify anything

# GOOD — Health check with dependency verification
@app.route('/health')
def health():
    checks = {}

    try:
        db.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"

    try:
        redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    code = 200 if status == "ok" else 503

    return {"status": status, "checks": checks}, code

# BETTER — Separate readiness and liveness
@app.route('/healthz')  # Liveness: is the process alive?
def liveness():
    return {"status": "ok"}

@app.route('/readyz')  # Readiness: can it serve traffic?
def readiness():
    checks = check_dependencies()
    status = "ok" if all_ok(checks) else "not ready"
    return {"status": status, "checks": checks}, 200 if status == "ok" else 503
```

**Severity:** High (undetected outages)
**CWE:** CWE-693 (Protection Mechanism Failure)

---

## 5. No Distributed Tracing

**What:** Requests crossing service boundaries cannot be traced, making debugging impossible.

**Detection patterns:**

```regex
# HTTP calls without trace context propagation
fetch\(|requests\.get\(|axios\.get\(|http\.get\(
(?!.*traceparent|.*X-Request-ID|.*X-Trace-ID|.*opentelemetry)

# No span creation for important operations
# Check: are critical operations wrapped in tracing spans?
```

**Code example:**

```javascript
// BAD — No tracing
async function handleRequest(req, res) {
    const user = await getUser(req.userId);      // ← No trace context
    const orders = await getOrders(user.id);     // ← Can't correlate
    res.json(orders);
}

// GOOD — OpenTelemetry tracing
const { trace, context } = require('@opentelemetry/api');

async function handleRequest(req, res) {
    const tracer = trace.getTracer('my-service');

    const user = await tracer.startActiveSpan('getUser', async (span) => {
        try {
            const result = await getUser(req.userId);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (e) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
            throw e;
        } finally {
            span.end();
        }
    });

    const orders = await tracer.startActiveSpan('getOrders', async (span) => {
        try {
            return await getOrders(user.id);
        } finally {
            span.end();
        }
    });

    res.json(orders);
}
```

**Severity:** Medium (debugging difficulty in microservices)
**CWE:** CWE-778 (Insufficient Logging)

---

## 6. Metric Cardinality Explosion

**What:** High-cardinality labels in metrics cause memory and storage explosion in monitoring systems.

**Detection patterns:**

```regex
# User ID or request ID as metric label
Counter|Histogram|Gauge.*labels.*user_id|labels.*request_id|labels.*session_id
Counter|Histogram|Gauge.*label.*email|label.*ip_address

# Unbounded string values as labels
labels.*\{[^}]*\w+_id\s*:
(?!.*enum|.* whitelist|.* fixed_set)
```

**Code example:**

```python
# BAD — High cardinality labels
from prometheus_client import Counter

request_count = Counter('requests', 'Request count', ['user_id', 'path'])

# user_id has millions of values → millions of time series

# GOOD — Low cardinality labels
request_count = Counter('requests', 'Request count', ['method', 'status_code', 'endpoint'])

# Use user_id only in logs, not metrics
logger.info("request", extra={"user_id": user_id, "path": path})
```

```javascript
// BAD — High cardinality
const histogram = prometheus.register.getHistogram('request_duration');
histogram.observe({ userId: user.id, path: req.path }, duration);

// GOOD — Low cardinality
const histogram = prometheus.register.getHistogram('request_duration');
histogram.observe({ method: req.method, status: res.statusCode }, duration);
```

**Severity:** High (monitoring system crash)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 7. PII in Logs

**What:** Personal data (emails, names, IPs, tokens) logged in plaintext, violating privacy regulations.

**Detection patterns:**

```regex
# Email in logs
log.*email|log.*\.email|print.*email|logger.*email

# IP address in logs
log.*ip|log.*remote_addr|log.*request\.ip
(?!.*hash|.*mask|.*anonymize)

# Token/secret in logs
log.*token|log.*password|log.*secret|log.*api_key
(?!.*redact|.*mask|.*sanitize|.*filter)

# Name in logs
log.*user\.name|log.*full_name|log.*first_name
```

**Code example:**

```python
# BAD — PII in logs
logger.info(f"User {user.email} logged in from {request.remote_addr}")
logger.error(f"Payment failed for card {card_number}")

# GOOD — Masked PII
def mask_email(email):
    name, domain = email.split('@')
    return f"{name[0]}***@{domain}"

def mask_ip(ip):
    parts = ip.split('.')
    return f"{parts[0]}.{parts[1]}.*.*"

logger.info(f"User {mask_email(user.email)} logged in from {mask_ip(request.remote_addr)}")
logger.error(f"Payment failed for card ****-****-****-{card_number[-4:]}")

# BETTER — Use a PII filtering logging handler
import logging

class PIIFilter(logging.Filter):
    PATTERNS = {
        'email': r'\b[\w.-]+@[\w.-]+\.\w+\b',
        'ip': r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b',
        'ssn': r'\b\d{3}-\d{2}-\d{4}\b',
    }

    def filter(self, record):
        import re
        for name, pattern in self.PATTERNS.items():
            record.msg = re.sub(pattern, f'[{name}_REDACTED]', record.msg)
        return True

logger.addFilter(PIIFilter())
```

**Severity:** Critical (GDPR/CCPA violation, data breach)
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

---

## Severity Quick Reference

| Pattern | Typical Severity | Impact |
|---------|-----------------|--------|
| Log flooding | Medium | Storage exhaustion, unreadable logs |
| Missing structured logging | Medium | Impossible to query/debug |
| Alert fatigue | High | Critical alerts missed |
| Missing health check | High | Undetected outages |
| No distributed tracing | Medium | Debugging impossible in microservices |
| Metric cardinality explosion | High | Monitoring system crash |
| PII in logs | Critical | Regulatory violation, data breach |

## Detection Checklist

- [ ] Logs inside tight loops without level guard
- [ ] Unstructured log messages (f-strings, template literals)
- [ ] Alert on every error without threshold/rate limiting
- [ ] No /health or /healthz endpoint
- [ ] Health check doesn't verify dependencies
- [ ] HTTP calls without trace context propagation
- [ ] User IDs, emails, IPs as metric labels
- [ ] PII (email, IP, token, name) in log messages
- [ ] No log level differentiation (everything is INFO)
- [ ] Missing exc_info/stacktrace on error logs
