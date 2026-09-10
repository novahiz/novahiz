# Cloud/Infrastructure Anti-Patterns

Detection patterns for single point of failure, missing auto-scaling, vendor lock-in, uncontrolled costs, missing disaster recovery, config sprawl, and secrets in git.

## 1. Single Point of Failure (SPOF)

**What:** A component has no redundancy — if it fails, the entire system goes down.

**Detection patterns:**

```regex
# Single instance without replica/replication
# Check: are critical services deployed with replicas?

# Single database without failover
# Check: is there a standby/replica database?

# Single availability zone deployment
# Check: are resources spread across AZs?

# Single load balancer without redundancy
# Check: is the LB redundant?
```

**Code example:**

```yaml
# BAD — Single point of failure (Kubernetes)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 1  # ← Single instance
  # No PodDisruptionBudget
  # No anti-affinity rules

# GOOD — Redundant deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3
  template:
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: api-server
              topologyKey: kubernetes.io/hostname
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api-server
```

```python
# BAD — Single database connection
db = psycopg2.connect(DATABASE_URL)

# GOOD — Connection pool with failover
from sqlalchemy import create_engine

engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    failover_urls=[FAILOVER_URL],
)
```

**Severity:** Critical (single failure brings down entire system)
**CWE:** CWE-693 (Protection Mechanism Failure)

---

## 2. Missing Auto-Scaling

**What:** Infrastructure doesn't scale with demand, causing outages under load or wasted resources at rest.

**Detection patterns:**

```regex
# Fixed replica count without HPA
replicas:\s*\d+(?!.*HorizontalPodAutoscaler)

# Fixed instance count without autoscaling group
# Check: is there an ASG/Autoscale configuration?

# No CPU/memory-based scaling
# Check: are scaling policies defined?
```

**Code example:**

```yaml
# BAD — No auto-scaling
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3  # ← Fixed, doesn't scale with load

# GOOD — Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

```python
# BAD — Fixed worker count
 workers = [Worker() for _ in range(4)]

# GOOD — Dynamic worker pool
import os
from multiprocessing import cpu_count

worker_count = int(os.environ.get('WORKER_COUNT', cpu_count()))
workers = [Worker() for _ in range(worker_count)]
```

**Severity:** High (outage under load, wasted resources)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 3. Vendor Lock-in

**What:** Code is tightly coupled to a specific cloud provider, making migration difficult or impossible.

**Detection patterns:**

```regex
# Direct provider SDK usage without abstraction
import boto3|from google\.cloud|from azure\.|import aws_xray

# Provider-specific resource definitions
AWS::|aws_|google_compute_|azurerm_

# Provider-specific services without abstraction layer
DynamoDB|BigTable|CosmosDB
(?!.*repository.*interface|.*abstract.*class|.*driver.*interface)
```

**Code example:**

```python
# BAD — Vendor lock-in (direct AWS SDK)
import boto3

def save_user(user):
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table('users')
    table.put_item(Item=user.to_dict())

# GOOD — Abstraction layer
from abc import ABC, abstractmethod

class UserRepository(ABC):
    @abstractmethod
    def save(self, user): ...

class DynamoDBUserRepository(UserRepository):
    def save(self, user):
        import boto3
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table('users')
        table.put_item(Item=user.to_dict())

class PostgresUserRepository(UserRepository):
    def save(self, user):
        db.execute("INSERT INTO users ...", user.to_dict())

# Usage depends on config, not code
repo = DynamoDBUserRepository() if USE_DYNAMO else PostgresUserRepository()
```

**Severity:** Medium (migration difficulty, vendor dependency)
**CWE:** CWE-710 (Improper Adherence to Coding Standards)

---

## 4. Uncontrolled Costs

**What:** Cloud resources run without cost controls, leading to surprise bills.

**Detection patterns:**

```regex
# Lambda/Cloud Function without timeout
Handler.*timeout|CloudFunction.*timeout
(?!.*maxDuration|.*timeout_seconds|.*Timeout)

# No cost alerts or budgets
# Check: are AWS Budgets / GCP Billing Alerts configured?

# Over-provisioned instances
# Check: are instance sizes appropriate for workload?

# No spot/preemptible instance usage for batch work
# Check: can batch jobs use cheaper instances?
```

**Code example:**

```yaml
# BAD — Uncontrolled Lambda
 handler:
   runtime: nodejs18.x
   # No timeout — can run forever → cost explosion
   memorySize: 1024  # ← Over-provisioned for simple task

# GOOD — Cost-controlled Lambda
 handler:
   runtime: nodejs18.x
   timeout: 30  # Max 30 seconds
   memorySize: 256  # Right-sized
   environment:
     variables:
       MAX_RETRIES: "3"

# GOOD — Spot instances for batch
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-processor
spec:
  template:
    spec:
      containers:
      - name: batch
        resources:
          limits:
            cpu: "2"
            memory: "4Gi"
      tolerations:
      - key: "spot"
        operator: "Equal"
        value: "true"
        effect: "NoSchedule"
```

**Severity:** High (financial impact)
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

---

## 5. Missing Disaster Recovery

**What:** No backup, no replication, no failover — data loss or extended outage on failure.

**Detection patterns:**

```regex
# Database without automated backups
# Check: are automated backups enabled?

# No cross-region replication
# Check: is data replicated to another region?

# No documented recovery procedures
# Check: is there a runbook for disaster recovery?

# No backup restoration testing
# Check: are backups tested regularly?
```

**Code example:**

```yaml
# BAD — No disaster recovery
apiVersion: apps/v1
kind: Deployment
metadata:
  name: database
spec:
  template:
    spec:
      containers:
      - name: postgres
        volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
      volumes:
      - name: data
        emptyDir: {}  # ← Data lost on pod restart

# GOOD — Persistent volume with backup
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 1
  template:
    spec:
      containers:
      - name: postgres
        volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast
      resources:
        requests:
          storage: 100Gi
---
# CronJob for daily backups
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:15
            command:
            - /bin/sh
            - -c
            - pg_dump -h postgres $DATABASE | gzip > /backup/$(date +%Y%m%d).sql.gz
```

**Severity:** Critical (data loss, extended outage)
**CWE:** CWE-693 (Protection Mechanism Failure)

---

## 6. Config Sprawl

**What:** Configuration is scattered across multiple files, environments, and tools with no single source of truth.

**Detection patterns:**

```regex
# Multiple config files with overlapping settings
config\.(json|yaml|yml|toml|env|ini|properties)
\.env\.(local|production|staging|development)

# Hardcoded config values alongside config files
DATABASE_URL\s*=\s*["']|API_KEY\s*=\s*["']

# Environment-specific configs without validation
process\.env\.\w+|os\.environ\[|os\.getenv\(
(?!.*required|.*validate|.*schema|.*check)
```

**Code example:**

```python
# BAD — Config sprawl
# config.py
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///dev.db')
API_KEY = os.environ.get('API_KEY', 'dev-key')

# settings.py
DATABASE_URL = os.environ.get('DATABASE_URL')  # Duplicate!
DEBUG = os.environ.get('DEBUG', 'false') == 'true'

# GOOD — Single config source with validation
from pydantic import BaseSettings

class Settings(BaseSettings):
    database_url: str
    api_key: str
    debug: bool = False
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

# Validates on import — fails fast if missing
settings = Settings()
```

```javascript
// BAD — Config sprawl
const config = {
    db: process.env.DATABASE_URL,
    apiKey: process.env.API_KEY,
    debug: process.env.DEBUG === 'true',
};

// GOOD — Validated config with zod
import { z } from 'zod';

const configSchema = z.object({
    DATABASE_URL: z.string().url(),
    API_KEY: z.string().min(1),
    DEBUG: z.coerce.boolean().default(false),
});

const config = configSchema.parse(process.env);
```

**Severity:** Medium (configuration errors, "works on my machine")
**CWE:** CWE-1188 (Insecure Default Initialization of Resource)

---

## 7. Secrets in Git

**What:** API keys, passwords, tokens committed to version control.

**Detection patterns:**

```regex
# Hardcoded secrets
api[_-]?key\s*[=:]\s*["'][A-Za-z0-9]{20,}|secret\s*[=:]\s*["'][A-Za-z0-9]{20,}
password\s*[=:]\s*["'][^"']{8,}|token\s*[=:]\s*["'][A-Za-z0-9]{20,}

# AWS keys
AKIA[0-9A-Z]{16}

# Private keys
-----BEGIN (RSA |EC )?PRIVATE KEY-----

# Connection strings with passwords
mysql://|postgres://|mongodb://|redis://
(?!.*\$|.*\{|.*ENV|.*env|.*process\.env)
```

**Code example:**

```python
# BAD — Secret in code
API_KEY = "sk-1234567890abcdef1234567890abcdef"
DATABASE_URL = "postgres://user:password123@host/db"

# GOOD — Environment variables
import os

API_KEY = os.environ["API_KEY"]
DATABASE_URL = os.environ["DATABASE_URL"]

# BETTER — Use a secrets manager
import boto3

def get_secret(secret_name):
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response['SecretString'])
```

```yaml
# BAD — Secret in docker-compose
services:
  db:
    image: postgres
    environment:
      POSTGRES_PASSWORD: supersecret  # ← Committed to git

# GOOD — Use Docker secrets or .env file (gitignored)
services:
  db:
    image: postgres
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
secrets:
  db_password:
    file: ./secrets/db_password.txt  # In .gitignore
```

**Severity:** Critical (credential exposure)
**CWE:** CWE-798 (Use of Hard-coded Credentials)

---

## Severity Quick Reference

| Pattern | Typical Severity | Impact |
|---------|-----------------|--------|
| Single point of failure | Critical | System outage on single failure |
| Missing auto-scaling | High | Outage under load |
| Vendor lock-in | Medium | Migration difficulty |
| Uncontrolled costs | High | Financial impact |
| Missing disaster recovery | Critical | Data loss, extended outage |
| Config sprawl | Medium | Config errors, inconsistency |
| Secrets in git | Critical | Credential exposure |

## Detection Checklist

- [ ] Critical services have replicas (no single instance)
- [ ] Auto-scaling configured for variable load
- [ ] Cloud provider SDK usage abstracted behind interfaces
- [ ] Cost alerts and budgets configured
- [ ] Database backups automated and tested
- [ ] Configuration validated on startup (not silent failure)
- [ ] No secrets hardcoded in source code
- [ ] .env files in .gitignore
- [ ] Secrets rotated regularly
- [ ] Multi-AZ deployment for critical services
