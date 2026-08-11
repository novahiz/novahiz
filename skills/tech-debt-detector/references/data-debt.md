# Data Debt — Detection Patterns

Patterns de détection pour la dette de données : migrations manquantes, schéma obsolète, données non versionnées, patterns de données problématiques.

## Detection Signals

- Missing database migrations
- Schema mismatches between code and DB
- Unversioned data formats
- Missing data validation
- Inconsistent data types
- Missing indexes
- No backup strategy

---

## Schema Debt

### Missing Migrations

```bash
# Check for migration files
find . -name "*migration*" -o -name "*migrate*" | head -10

# Check for schema files
find . -name "schema.*" -o -name "prisma" -o -name "drizzle" | head -10

# Check for ORM config
ls prisma/ drizzle/ sequelize/ knexfile.* 2>/dev/null || echo "NO ORM CONFIG"
```

### Schema Mismatches

```bash
# Check for schema changes without migrations
git log --oneline --all -- "*.sql" "prisma/schema.prisma" "drizzle/*.ts" | head -10

# Check for raw SQL queries
grep -rn "query\|execute" src/ --include="*.ts" --include="*.py" | grep -i "SELECT\|INSERT\|UPDATE\|DELETE" | head -20
```

### Missing Indexes

```bash
# Check for common query patterns
grep -rn "WHERE\|JOIN\|ORDER BY" src/ --include="*.ts" --include="*.py" | head -20

# Check for indexed fields
grep -rn "index\|INDEX" prisma/schema.prisma 2>/dev/null | head -10
```

---

## Data Validation Debt

### Missing Schema Validation

```typescript
// BAD: no validation
const data = await db.query('SELECT * FROM users');
res.json(data);

// GOOD: schema validation
import { z } from 'zod';

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

const data = await db.query('SELECT * FROM users');
const validated = UserSchema.array().parse(data);
res.json(validated);
```

### Missing Type Safety

```python
# BAD: no type hints
def get_user(id):
    return db.query("SELECT * FROM users WHERE id = %s", (id,))

# GOOD: type hints
def get_user(id: int) -> User:
    return db.query("SELECT * FROM users WHERE id = %s", (id,))
```

---

## Data Format Debt

### Unversioned Data

```typescript
// BAD: no versioning
const config = JSON.parse(fs.readFileSync('config.json'));

// GOOD: versioned format
interface ConfigV1 {
  version: 1;
  // ...
}

interface ConfigV2 {
  version: 2;
  // ...
}

type Config = ConfigV1 | ConfigV2;

function migrateConfig(data: unknown): Config {
  const raw = JSON.parse(data as string);
  if (raw.version === 1) return migrateV1toV2(raw);
  return raw;
}
```

### Inconsistent Date Formats

```typescript
// BAD: mixed formats
const date1 = "2024-01-15"; // ISO string
const date2 = "01/15/2024"; // US format
const date3 = "15/01/2024"; // EU format
const date4 = 1705276800000; // timestamp

// GOOD: consistent ISO format
const date = "2024-01-15T00:00:00.000Z"; // always ISO 8601
```

---

## Data Migration Debt

### Missing Backup Strategy

```bash
# Check for backup scripts
ls scripts/backup* backups/ 2>/dev/null || echo "NO BACKUP SCRIPTS"

# Check for backup in CI
grep -i "backup" .github/workflows/*.yml 2>/dev/null | head -10
```

### Missing Rollback Plan

```bash
# Check for rollback scripts
ls scripts/rollback* 2>/dev/null || echo "NO ROLLBACK SCRIPTS"

# Check for migration rollback
grep -i "rollback\|down\|revert" migrations/ 2>/dev/null | head -10
```

---

## Data Quality Debt

### Missing Constraints

```sql
-- BAD: no constraints
CREATE TABLE users (
  id INT,
  name VARCHAR(255),
  email VARCHAR(255)
);

-- GOOD: proper constraints
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);
```

### Missing Auditing

```sql
-- BAD: no audit trail
UPDATE users SET name = 'John' WHERE id = 1;

-- GOOD: audit trail
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255),
  record_id INT,
  action VARCHAR(10),
  old_values JSONB,
  new_values JSONB,
  changed_by VARCHAR(255),
  changed_at TIMESTAMP DEFAULT NOW()
);

-- Trigger to log changes
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
  VALUES (TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(OLD), row_to_json(NEW), current_user);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## Detection Commands

```bash
# Check for migration files
find . -name "*migration*" -o -name "*migrate*" | head -10

# Check for schema files
find . -name "schema.*" -o -name "prisma" -o -name "drizzle" | head -10

# Check for backup scripts
ls scripts/backup* backups/ 2>/dev/null || echo "MISSING: Backup scripts"

# Check for rollback scripts
ls scripts/rollback* 2>/dev/null || echo "MISSING: Rollback scripts"

# Check for data validation
grep -rn "z\.object\|z\.array\|yup\|joi" src/ --include="*.ts" --include="*.js" | head -10

# Check for type hints in Python
grep -rn "def.*->.*:" src/ --include="*.py" | wc -l
```
