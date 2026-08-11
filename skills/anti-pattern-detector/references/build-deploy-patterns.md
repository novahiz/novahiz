# Build/Deploy Anti-Patterns

Detection patterns for dependency hell, works on my machine, missing .env, unpinned dependencies, Docker image bloat, no rollback plan, DB migration without backup, and config drift.

## 1. Dependency Hell

**What:** Conflicting or incompatible dependency versions across packages, causing runtime errors.

**Detection patterns:**

```regex
# Version conflicts in package files
# Check: do dependencies have overlapping version ranges?

# Duplicate dependencies with different versions
# Check: are there multiple versions of the same package?

# Peer dependency warnings
# Check: are peer dependencies satisfied?
```

**Code example:**

```json
// BAD — Dependency conflict
{
  "dependencies": {
    "package-a": "^2.0.0",  // Requires lodash ^4.0.0
    "package-b": "^1.0.0"   // Requires lodash ^3.0.0 → CONFLICT
  }
}

// GOOD — Lock file + resolution
{
  "dependencies": {
    "package-a": "^2.0.0",
    "package-b": "^1.0.0"
  },
  "resolutions": {
    "lodash": "^4.17.21"  // Force single version
  }
}
```

```python
# BAD — Dependency hell
# requirements.txt
flask==2.0.0
django==4.0.0  # Both depend on different Jinja2 versions

# GOOD — Use poetry/pip-tools with lock file
# pyproject.toml
[tool.poetry.dependencies]
flask = "^2.0.0"
django = "^4.0.0"

# poetry.lock pins exact versions
```

**Severity:** High (build failures, runtime errors)
**CWE:** CWE-1104 (Use of Unmaintained Third Party Components)

---

## 2. Works on My Machine

**What:** Code works in development but fails in production due to environment differences.

**Detection patterns:**

```regex
# Hardcoded paths
/usr/local/|C:\\|/Users/|/home/\w+/

# OS-specific code without platform check
os\.name|process\.platform|sys\.platform
(?!.*if.*==|.*switch|.*match)

# Missing environment parity
# Check: do dev and prod use the same OS/runtime versions?
```

**Code example:**

```python
# BAD — Hardcoded path
LOG_PATH = "/Users/john/logs/app.log"

# GOOD — Environment-based configuration
import os
LOG_PATH = os.environ.get("LOG_PATH", "/var/log/app.log")

# BETTER — Use 12-factor app principles
LOG_PATH = os.environ["LOG_PATH"]  # Required, fails fast
```

```dockerfile
# BAD — Works on my machine
FROM node:18
# Assumes specific Node version installed locally

# GOOD — Explicit version + multi-stage
FROM node:18.17.0-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18.17.0-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN npm run build
```

**Severity:** Medium (deployment failures)
**CWE:** CWE-710 (Improper Adherence to Coding Standards)

---

## 3. Missing .env Variables

**What:** Environment variables required in production are not documented or validated.

**Detection patterns:**

```regex
# process.env / os.environ without validation
process\.env\.\w+|os\.environ\[|os\.getenv\(
(?!.*required|.*validate|.*check|.*schema)

# No .env.example file
# Check: is there a .env.example documenting all required vars?

# Missing required env validation at startup
# Check: does the app fail fast if required vars are missing?
```

**Code example:**

```python
# BAD — Silent fallback to wrong defaults
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///dev.db')
API_KEY = os.environ.get('API_KEY', 'dev-key')  # ← Runs with dev key in prod

# GOOD — Fail fast on missing required vars
REQUIRED_VARS = ['DATABASE_URL', 'API_KEY', 'SECRET_KEY']

missing = [v for v in REQUIRED_VARS if v not in os.environ]
if missing:
    raise RuntimeError(f"Missing required environment variables: {missing}")

DATABASE_URL = os.environ['DATABASE_URL']
API_KEY = os.environ['API_KEY']

# BETTER — Use pydantic for validation
from pydantic import BaseSettings

class Settings(BaseSettings):
    database_url: str
    api_key: str
    secret_key: str

    class Config:
        env_file = ".env"
```

```javascript
// BAD — No validation
const dbUrl = process.env.DATABASE_URL || 'sqlite:///dev.db';

// GOOD — Zod validation
import { z } from 'zod';

const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    API_KEY: z.string().min(1),
    SECRET_KEY: z.string().min(32),
});

const env = envSchema.parse(process.env);
```

**Severity:** High (production runs with wrong config)
**CWE:** CWE-1188 (Insecure Default Initialization of Resource)

---

## 4. Unpinned Dependencies

**What:** Dependencies installed without version pins, leading to unexpected breaking changes.

**Detection patterns:**

```regex
# npm install without lock file
npm install(?!.*--package-lock|.*--frozen-lockfile)

# pip install without version pin
pip install\s+\w+(?!.*==|.*>=|.*~=)

# Latest tag in Dockerfile
FROM\s+\w+:latest

# No lock file committed
# Check: is package-lock.json / poetry.lock / yarn.lock committed?
```

**Code example:**

```dockerfile
# BAD — Unpinned base image
FROM node:latest  # ← Could be 18, 20, or 22 tomorrow

# GOOD — Pinned version with digest
FROM node:18.17.0-slim@sha256:abc123...
```

```python
# BAD — Unpinned dependency
# requirements.txt
requests
flask

# GOOD — Pinned with hash verification
# requirements.txt
requests==2.31.0 --hash=sha256:abc123...
flask==3.0.0 --hash=sha256:def456...

# BETTER — Use poetry with lock file
# pyproject.toml
[tool.poetry.dependencies]
requests = "^2.31.0"
flask = "^3.0.0"

# poetry.lock pins exact versions
```

```json
// BAD — Unpinned package.json
{
  "dependencies": {
    "express": "^4.18.0"  // ← Minor version could introduce breaking changes
  }
}

// GOOD — Pinned
{
  "dependencies": {
    "express": "4.18.2"  // ← Exact version
  },
  "devDependencies": {
    "@types/express": "4.17.21"
  }
}
```

**Severity:** High (unpredictable builds)
**CWE:** CWE-1104 (Use of Unmaintained Third Party Components)

---

## 5. Docker Image Bloat

**What:** Docker images are unnecessarily large, slowing deploys and increasing attack surface.

**Detection patterns:**

```regex
# Single-stage build
FROM.*(?!.*AS\s+\w+)$

# Copying everything
COPY\s+\.\s+\.|COPY\s+\*\.

# Not using multi-stage build
# Check: is there a multi-stage Dockerfile?

# Not using .dockerignore
# Check: is .dockerignore configured?
```

**Code example:**

```dockerfile
# BAD — Bloated image (~1.5GB)
FROM node:18
WORKDIR /app
COPY . .
RUN npm install  # Dev dependencies included
RUN npm run build
# Dev tools, source code, node_modules all in final image

# GOOD — Multi-stage build (~100MB)
FROM node:18-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:18-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER node
CMD ["node", "dist/index.js"]

# BETTER — Even smaller with distroless
FROM gcr.io/distroless/nodejs18-debian12
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["dist/index.js"]
```

```dockerfile
# BAD — .dockerignore missing
# Everything gets sent to Docker daemon, including .git, node_modules, etc.

# GOOD — .dockerignore
.git
node_modules
*.md
.env
.env.*
dist
coverage
.nyc_output
```

**Severity:** Medium (slow deploys, large attack surface)
**CWE:** CWE-1104 (Use of Unmaintained Third Party Components)

---

## 6. No Rollback Plan

**What:** Deployments have no rollback mechanism, making failed deploys catastrophic.

**Detection patterns:**

```regex
# Deploy script without rollback
deploy|release|ship
(?!.*rollback|.*revert|.*previous|.*undo)

# Database migration without rollback
ALTER|DROP|CREATE|INSERT
(?!.*rollback|.*reversible|.*down|.*reverse)

# No versioned releases
# Check: are releases tagged/versioned?
```

**Code example:**

```bash
#!/bin/bash
# BAD — No rollback plan
docker pull myapp:$VERSION
docker stop myapp
docker run -d myapp:$VERSION

# GOOD — Rollback-capable deploy
#!/bin/bash
PREVIOUS=$(docker inspect myapp --format='{{.Config.Image}}')
docker pull myapp:$VERSION
docker stop myapp || true
docker run -d --name myapp myapp:$VERSION

# If health check fails, rollback
if ! curl -sf http://localhost:3000/health; then
    echo "Deploy failed, rolling back to $PREVIOUS"
    docker stop myapp
    docker run -d --name myapp $PREVIOUS
    exit 1
fi
```

```python
# BAD — Irreversible migration
def upgrade():
    op.drop_column('users', 'old_field')  # ← Data lost forever

# GOOD — Reversible migration
def upgrade():
    op.alter_column('users', 'old_field', new_column_name='archived_field')

def downgrade():
    op.alter_column('users', 'archived_field', new_column_name='old_field')
```

**Severity:** High (inability to recover from failed deploys)
**CWE:** CWE-693 (Protection Mechanism Failure)

---

## 7. Database Migration Without Backup

**What:** Database migrations run without backups, risking data loss on failure.

**Detection patterns:**

```regex
# Destructive migration without backup check
DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE
(?!.*backup|.*snapshot|.*before)

# Migration without transaction
ALTER|CREATE|DROP
(?!.*BEGIN|.*transaction|.*TRANSACTION)

# No migration testing
# Check: are migrations tested in staging before production?
```

**Code example:**

```python
# BAD — Destructive migration without backup
def upgrade():
    op.drop_column('users', 'email')  # ← Data lost

# GOOD — Backup before destructive migration
def upgrade():
    # Backup table first
    op.execute("CREATE TABLE users_backup AS SELECT * FROM users")
    op.drop_column('users', 'email')

def downgrade():
    op.add_column('users', sa.Column('email', sa.String))
    op.execute("""
        UPDATE users SET email = (
            SELECT email FROM users_backup WHERE users_backup.id = users.id
        )
    """)
    op.execute("DROP TABLE users_backup")
```

```yaml
# BAD — Migration job without backup
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
spec:
  template:
    spec:
      containers:
      - name: migrate
        image: myapp:latest
        command: ["python", "manage.py", "migrate"]

# GOOD — Backup before migration
apiVersion: batch/v1
kind: Job
metadata:
  name: backup-then-migrate
spec:
  template:
    spec:
      initContainers:
      - name: backup
        image: postgres:15
        command:
        - /bin/sh
        - -c
        - pg_dump -h postgres $DATABASE_URL > /backup/pre-migration-$(date +%Y%m%d%H%M%S).sql
      containers:
      - name: migrate
        image: myapp:latest
        command: ["python", "manage.py", "migrate"]
```

**Severity:** Critical (data loss)
**CWE:** CWE-693 (Protection Mechanism Failure)

---

## 8. Silent Config Drift

**What:** Configuration differences between environments go undetected, causing unexpected behavior.

**Detection patterns:**

```regex
# Environment-specific overrides without tracking
# Check: are config differences documented?

# Manual configuration changes
# Check: is all config in version control?

# No config validation in CI
# Check: does CI validate config against schema?
```

**Code example:**

```python
# BAD — Config drift (manual changes in prod)
# dev: DEBUG=true, LOG_LEVEL=info
# prod: DEBUG=false, LOG_LEVEL=warning
# staging: DEBUG=true (someone forgot to change it)

# GOOD — Config as code with validation
# config/environments/dev.yaml
debug: true
log_level: info

# config/environments/prod.yaml
debug: false
log_level: warning

# CI validation step
def validate_configs():
    for env in ['dev', 'staging', 'prod']:
        config = load_config(f'config/environments/{env}.yaml')
        assert config['debug'] == (env == 'dev'), f"Debug mismatch in {env}"
        assert config['log_level'] in ['debug', 'info', 'warning', 'error']
```

**Severity:** Medium (unexpected behavior in specific environments)
**CWE:** CWE-1188 (Insecure Default Initialization of Resource)

---

## Severity Quick Reference

| Pattern | Typical Severity | Impact |
|---------|-----------------|--------|
| Dependency hell | High | Build/runtime failures |
| Works on my machine | Medium | Deployment failures |
| Missing .env variables | High | Wrong config in production |
| Unpinned dependencies | High | Unpredictable builds |
| Docker image bloat | Medium | Slow deploys, large attack surface |
| No rollback plan | High | Catastrophic failed deploys |
| DB migration without backup | Critical | Data loss |
| Silent config drift | Medium | Environment-specific bugs |

## Detection Checklist

- [ ] Dependencies pinned to exact versions
- [ ] Lock file committed (package-lock.json, poetry.lock, yarn.lock)
- [ ] .env.example documents all required variables
- [ ] App fails fast on missing required env vars
- [ ] Multi-stage Dockerfile for smaller images
- [ ] .dockerignore configured
- [ ] Base image pinned (not :latest)
- [ ] Deploy script has rollback mechanism
- [ ] Database migrations are reversible
- [ ] Backup before destructive migrations
- [ ] All config in version control (no manual prod changes)
- [ ] CI validates config against schema
