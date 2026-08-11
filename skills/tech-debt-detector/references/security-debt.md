# Security Debt — Detection Patterns

Patterns de détection pour la dette de sécurité : secrets hardcodés, validation manquante, auth faible, dépendances vulnérables.

## Detection Signals

- Hardcoded credentials, API keys, tokens
- Missing input validation
- Weak authentication patterns
- SQL injection vectors
- XSS vulnerabilities
- Insecure dependencies
- Missing security headers
- Insecure cryptography

---

## Hardcoded Secrets

### Detection Patterns

```bash
# Generic secret patterns
grep -rn "password\|secret\|api_key\|apikey\|token\|credentials\|auth" src/ \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.kt" --include="*.swift" \
  | grep -v "test\|spec\|mock\|\.d\.ts" \
  | grep -i "= ['\"]" | head -30

# AWS keys
grep -rn "AKIA[0-9A-Z]\{16\}" src/ --include="*.ts" --include="*.js" --include="*.py"

# Private keys
grep -rn "BEGIN.*PRIVATE KEY" src/ --include="*.ts" --include="*.js" --include="*.pem"

# Connection strings with passwords
grep -rn "://.*:.*@" src/ --include="*.ts" --include="*.js" --include="*.py" --include="*.env*"
```

### gitleaks

```bash
gitleaks detect --source=. --report-format json --report-path=gitleaks-report.json
```

### Hardcoded URL with Credentials

```typescript
// BAD
const API_URL = 'https://user:password@api.example.com';
const DB_URL = 'postgresql://admin:secret@localhost:5432/mydb';

// GOOD
const API_URL = process.env.API_URL;
const DB_URL = process.env.DATABASE_URL;
```

### Hardcoded Tokens

```typescript
// BAD
const STRIPE_KEY = 'sk_live_xxxxxxxxxxxxxxxx';
const JWT_SECRET = 'super-secret-jwt-key-123';

// GOOD
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
```

---

## Input Validation Debt

### Missing Validation

```typescript
// BAD: no validation
app.post('/users', async (req, res) => {
  const { email, name } = req.body; // no validation
  await db.insert('users', { email, name });
  res.json({ success: true });
});

// GOOD: schema validation
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100).trim(),
});

app.post('/users', async (req, res) => {
  const input = CreateUserSchema.parse(req.body);
  await db.insert('users', input);
  res.json({ success: true });
});
```

### SQL Injection Vectors

```typescript
// BAD: string concatenation
const query = `SELECT * FROM users WHERE id = '${userId}'`;
await db.query(query);

// GOOD: parameterized query
const query = 'SELECT * FROM users WHERE id = $1';
await db.query(query, [userId]);
```

```python
# BAD: string formatting
cursor.execute(f"SELECT * FROM users WHERE id = '{user_id}'")

# GOOD: parameterized query
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

### XSS Vectors

```typescript
// BAD: dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// GOOD: sanitize first
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />
```

---

## Authentication Debt

### Weak Password Policy

```typescript
// BAD: no password validation
const password = req.body.password;

// GOOD: strong password policy
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');
```

### Missing Rate Limiting

```typescript
// BAD: no rate limiting
app.post('/login', async (req, res) => {
  // unlimited login attempts
});

// GOOD: rate limiting
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many login attempts',
});

app.post('/login', loginLimiter, async (req, res) => {
  // limited to 5 attempts per 15 minutes
});
```

### Missing MFA

```bash
# Check for MFA implementation
grep -rn "totp\|mfa\|2fa\|authenticator" src/ --include="*.ts" --include="*.py"
```

### Insecure Session Management

```typescript
// BAD: insecure session config
app.use(session({
  secret: 'hardcoded-secret',
  cookie: {
    secure: false, // HTTP only
    httpOnly: false, // JS accessible
    sameSite: 'none', // CSRF vulnerable
  },
}));

// GOOD: secure session config
app.use(session({
  secret: process.env.SESSION_SECRET,
  cookie: {
    secure: true, // HTTPS only
    httpOnly: true, // JS inaccessible
    sameSite: 'strict', // CSRF protected
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));
```

---

## Dependency Vulnerabilities

### npm audit

```bash
npm audit --json 2>/dev/null | jq '.vulnerabilities | length'
npm audit --json 2>/dev/null | jq '.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high")'
```

### pip-audit

```bash
pip-audit --format json 2>/dev/null | jq '.vulnerabilities | length'
```

### Trivy

```bash
trivy fs . --format json --severity HIGH,CRITICAL 2>/dev/null
```

### Outdated Dependencies

```bash
# Check for outdated packages
npm outdated 2>/dev/null | head -20
pip list --outdated 2>/dev/null | head -20
```

---

## Security Headers

### Missing Headers

```typescript
// BAD: no security headers
app.use((req, res, next) => {
  next();
});

// GOOD: comprehensive security headers
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
```

### Missing CSP

```typescript
// Check for CSP configuration
grep -rn "content-security-policy\|Content-Security-Policy\|CSP" src/ --include="*.ts" --include="*.js" --include="*.html"
```

---

## Insecure Cryptography

### Weak Hashing

```typescript
// BAD: MD5 or SHA1 for passwords
import { createHash } from 'crypto';
const hash = createHash('md5').update(password).digest('hex');

// GOOD: bcrypt or argon2
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 12);
```

```python
# BAD: MD5 or SHA1
import hashlib
hash = hashlib.md5(password.encode()).hexdigest()

# GOOD: bcrypt or argon2
import bcrypt
hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12))
```

### Insecure Random

```typescript
// BAD: Math.random() for security
const token = Math.random().toString(36).substring(2);

// GOOD: crypto.randomBytes
import { randomBytes } from 'crypto';
const token = randomBytes(32).toString('hex');
```

---

## Detection Commands

```bash
# Find hardcoded secrets
gitleaks detect --source=. --report-format json

# npm audit
npm audit 2>/dev/null

# pip-audit
pip-audit 2>/dev/null

# Check for SQL injection patterns
grep -rn "query.*+\|execute.*f\"" src/ --include="*.ts" --include="*.py" | head -20

# Check for XSS patterns
grep -rn "dangerouslySetInnerHTML\|innerHTML\|document\.write" src/ | head -20

# Check for missing input validation
grep -rn "req\.body\|request\.body" src/ --include="*.ts" --include="*.js" | head -20

# Check for weak crypto
grep -rn "md5\|sha1\|createCipher\b" src/ --include="*.ts" --include="*.js" --include="*.py" | head -20
```
