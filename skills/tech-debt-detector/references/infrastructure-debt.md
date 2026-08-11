# Infrastructure Debt — Detection Patterns

Patterns de détection pour la dette d'infrastructure : OS non patché, infrastructure non-IaC, containers non sécurisés, CI/CD fragile.

## Detection Signals

- Manual infrastructure provisioning (no IaC)
- Outdated base images in Dockerfile
- Missing health checks in containers
- Hardcoded infrastructure config
- Missing resource limits
- No disaster recovery plan
- Manual deployment steps

---

## Infrastructure as Code (IaC)

### Missing IaC

```bash
# Check for IaC files
ls terraform/ pulumi/ cloudformation/ .tf .yaml 2>/dev/null || echo "NO IaC FOUND"

# Check for Terraform
find . -name "*.tf" | head -5

# Check for Pulumi
find . -name "Pulumi.*" | head -5

# Check for Kubernetes manifests
find . -name "*.yaml" -o -name "*.yml" | xargs grep -l "apiVersion:" 2>/dev/null | head -5
```

### Manual Configuration

```bash
# Check for manual steps in README
grep -i "manual\|ssh\|console\|dashboard\|click" README.md 2>/dev/null | head -10

# Check for infrastructure scripts
ls scripts/ deploy/ ops/ 2>/dev/null | head -10
```

---

## Docker Debt

### Outdated Base Images

```dockerfile
# BAD: outdated or unversioned base
FROM node:14  # EOL
FROM python:3.8  # EOL
FROM ubuntu:latest  # unversioned

# GOOD: current, specific version
FROM node:20-alpine
FROM python:3.12-slim
FROM ubuntu:22.04
```

### Missing Security

```dockerfile
# BAD: running as root
FROM node:20
WORKDIR /app
COPY . .
CMD ["node", "index.js"]

# GOOD: non-root user, multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Missing Health Checks

```dockerfile
# BAD: no health check
FROM node:20-alpine
CMD ["node", "index.js"]

# GOOD: health check
FROM node:20-alpine
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "index.js"]
```

### Large Image Size

```bash
# Check image sizes
docker images | head -10

# Analyze image layers
docker history <image> --human-readable

# Find large files in image
docker run --rm -it <image> du -sh /* | sort -rh | head -10
```

### hadolint

```bash
hadolint Dockerfile
```

---

## Kubernetes Debt

### Missing Resource Limits

```yaml
# BAD: no resource limits
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: app
    image: myapp:latest

# GOOD: resource limits
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: app
    image: myapp:1.0.0
    resources:
      requests:
        memory: "128Mi"
        cpu: "250m"
      limits:
        memory: "512Mi"
        cpu: "500m"
```

### Missing Health Probes

```yaml
# BAD: no probes
spec:
  containers:
  - name: app
    image: myapp:1.0.0

# GOOD: liveness and readiness probes
spec:
  containers:
  - name: app
    image: myapp:1.0.0
    livenessProbe:
      httpGet:
        path: /health
        port: 3000
      initialDelaySeconds: 30
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /ready
        port: 3000
      initialDelaySeconds: 5
      periodSeconds: 5
```

### Missing Network Policies

```bash
# Check for NetworkPolicy
find . -name "*.yaml" | xargs grep -l "kind: NetworkPolicy" 2>/dev/null
```

### Missing RBAC

```bash
# Check for Role/ClusterRole
find . -name "*.yaml" | xargs grep -l "kind: Role\|kind: ClusterRole" 2>/dev/null
```

---

## CI/CD Debt

### Missing CI

```bash
# Check for CI config
ls .github/workflows/ .gitlab-ci.yml .circleci/ Jenkinsfile .travis.yml 2>/dev/null || echo "NO CI FOUND"
```

### Manual Deployment Steps

```bash
# Check for manual deployment
grep -i "manual\|ssh\|scp\|rsync" README.md deploy/ scripts/ 2>/dev/null | head -10
```

### Missing Checks

```yaml
# BAD: minimal CI
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - run: npm install
    - run: npm test

# GOOD: comprehensive CI
name: CI
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npm run lint
    - run: npm run typecheck
  test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npm test -- --coverage
    - run: npm run test:e2e
  security:
    needs: lint
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - run: npm audit --audit-level=high
    - run: npx semgrep --config=auto .
  build:
    needs: [test, security]
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - run: npm run build
    - run: docker build .
```

---

## Cloud Configuration Debt

### AWS

```bash
# Check for hardcoded AWS config
grep -rn "aws_access_key_id\|aws_secret_access_key\|AWS_" src/ --include="*.ts" --include="*.py" | head -10

# Check for IAM policies
find . -name "*.json" | xargs grep -l "Action.*\*" 2>/dev/null | head -5
```

### GCP

```bash
# Check for hardcoded GCP config
grep -rn "GOOGLE_APPLICATION_CREDENTIALS\|service_account" src/ --include="*.ts" --include="*.py" | head -10
```

### Azure

```bash
# Check for hardcoded Azure config
grep -rn "AZURE_\|subscription_id\|client_id\|client_secret" src/ --include="*.ts" --include="*.py" | head -10
```

---

## Monitoring Debt

### Missing Logging

```bash
# Check for structured logging
grep -rn "console\.log\|print(" src/ --include="*.ts" --include="*.py" | grep -v "test\|spec" | head -20

# Check for proper logger
grep -rn "logger\.\|logging\.\|winston\.\|pino\.\|bunyan\." src/ --include="*.ts" --include="*.py" | head -10
```

### Missing Metrics

```bash
# Check for metrics
grep -rn "prometheus\|datadog\|statsd\|metrics" src/ --include="*.ts" --include="*.py" | head -10
```

### Missing Alerting

```bash
# Check for alert rules
find . -name "*.yaml" | xargs grep -l "alert:" 2>/dev/null | head -5
```

---

## Detection Commands

```bash
# Check for IaC
find . -name "*.tf" -o -name "Pulumi.*" -o -name "*.yaml" | xargs grep -l "apiVersion:" 2>/dev/null | head -5

# Check Dockerfile
hadolint Dockerfile 2>/dev/null

# Check for outdated Docker images
docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}" | head -10

# Check for CI config
ls .github/workflows/ .gitlab-ci.yml .circleci/ Jenkinsfile 2>/dev/null || echo "NO CI"

# Check for hardcoded secrets in infrastructure
grep -rn "password\|secret\|key" terraform/ pulumi/ k8s/ 2>/dev/null | head -10

# Check for missing health checks
grep -rn "health\|readiness\|liveness" k8s/ 2>/dev/null | head -10
```
