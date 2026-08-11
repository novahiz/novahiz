# Architecture Debt — Detection Patterns

Patterns de détection pour la dette architecturale : couplage excessif, violations de couches, god classes, décisions structurelles obsolètes.

## Detection Signals

- Import statements crossing module boundaries
- Circular dependency chains
- God classes/modules (too many responsibilities)
- Missing abstraction layers
- Direct database access from presentation layer
- Shared mutable state across modules
- Missing dependency injection

---

## Coupling Analysis

### Circular Dependencies

**TypeScript/JavaScript:**
```bash
# Detect circular imports
npx madge --circular src/

# Or manual check
grep -rn "import.*from" src/ | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  imported=$(echo "$line" | grep -oP "from ['\"]([^'\"]+)" | cut -d"'" -f2)
  # Check if imported file imports back
done
```

**Python:**
```bash
# Use pydeps
pydeps --no-config src/ --max-bacon=2

# Or manual check
python -c "
import ast, sys
for f in sys.argv[1:]:
    tree = ast.parse(open(f).read())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            print(f'{f}: imports from {node.module}')
"
```

### God Classes / God Functions

**Detection criteria:**
- Class with >20 methods
- Class with >500 lines
- Function with >10 parameters
- Module with >30 exports

**TypeScript:**
```bash
# Count methods per class
grep -n "class " src/ -r | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  classline=$(echo "$line" | cut -d: -f2)
  # Find next class or EOF, count methods in between
done

# Count lines per file
find src/ -name "*.ts" -exec wc -l {} + | sort -rn | head -20
```

**Python:**
```bash
# Count methods per class
grep -n "class \|def " src/ -r | awk -F: '{if($3 ~ /class/) class=$1; if($3 ~ /def/) count++; if(count>20) print class, count}'
```

### Tight Coupling

**Signs:**
- A class directly instantiates its dependencies
- A function accesses global state
- Modules share database connections
- Components import from unrelated modules

```typescript
// BAD: tight coupling
class UserService {
  private db = new PostgresConnection(); // hardcoded dependency
  private mailer = new SendGridMailer(); // hardcoded dependency
}

// GOOD: dependency injection
class UserService {
  constructor(
    private db: DatabaseConnection,
    private mailer: Mailer,
  ) {}
}
```

---

## Layer Violations

### Presentation Layer → Data Layer

```typescript
// BAD: React component directly queries database
function UserList() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    db.query('SELECT * FROM users').then(setUsers); // layer violation
  }, []);
}

// GOOD: through service layer
function UserList() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    userService.getUsers().then(setUsers); // proper abstraction
  }, []);
}
```

### Business Logic in Controllers

```typescript
// BAD: business logic in controller
async function createUser(req, res) {
  const { email, password } = req.body;
  if (!email.includes('@')) throw new Error('Invalid email'); // validation in controller
  const hashed = bcrypt.hashSync(password, 10); // business logic in controller
  const user = await db.insert('users', { email, password: hashed });
  await sendWelcomeEmail(email); // side effect in controller
  res.json(user);
}

// GOOD: controller delegates to service
async function createUser(req, res) {
  const input = CreateUserSchema.parse(req.body);
  const user = await userService.createUser(input);
  res.json(user);
}
```

### Direct Database Access from Views/UI

**Django:**
```python
# BAD: direct DB query in template
{% for user in User.objects.all() %}
  {{ user.name }}
{% endfor %}

# GOOD: pass through view
# views.py
def user_list(request):
    users = User.objects.all()
    return render(request, 'users.html', {'users': users})
```

---

## Module Boundary Violations

### Import Pattern Analysis

```typescript
// BAD: importing from unrelated modules
// src/features/auth/UserService.ts
import { CartService } from '../cart/CartService'; // unrelated
import { NotificationService } from '../notifications/NotificationService'; // unrelated

// GOOD: domain-based boundaries
// src/features/auth/UserService.ts
import { AuthService } from './AuthService'; // same domain
import { UserRepository } from './UserRepository'; // same domain
```

### Barrel Export Abuse

```typescript
// BAD: barrel file re-exports everything, creating implicit dependencies
// src/features/index.ts
export * from './auth';
export * from './cart';
export * from './notifications';
// Any consumer can access anything, no boundaries

// GOOD: explicit imports
// src/features/auth/index.ts
export { UserService } from './UserService';
export type { CreateUserInput } from './types';
```

### Missing Abstraction Layers

**Without DI container:**
```typescript
// BAD: manual instantiation everywhere
const repo = new UserRepository(db);
const service = new UserService(repo);
const controller = new UserController(service);

// GOOD: DI container
const container = new Container();
container.register(UserRepository, { useClass: UserRepository });
container.register(UserService, { useClass: UserService });
```

---

## Scalability Debt

### Synchronous Bottlenecks

```typescript
// BAD: synchronous blocking
app.get('/users', (req, res) => {
  const users = db.querySync('SELECT * FROM users'); // blocks event loop
  res.json(users);
});

// GOOD: async
app.get('/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json(users);
});
```

### Shared Database

```
// BAD: all services share one database
Service A → DB (shared)
Service B → DB (shared)
Service C → DB (shared)

// GOOD: database per service
Service A → DB A
Service B → DB B
Service C → DB C
```

### Missing Caching Layer

```typescript
// BAD: no caching, hits DB every time
async function getUser(id: string) {
  return db.query('SELECT * FROM users WHERE id = $1', [id]);
}

// GOOD: cache-first
async function getUser(id: string) {
  const cached = await cache.get(`user:${id}`);
  if (cached) return cached;
  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  await cache.set(`user:${id}`, user, { ttl: 300 });
  return user;
}
```

---

## Cross-Language Architecture Patterns

### Missing Health Checks

```typescript
// BAD: no health endpoint
app.listen(3000);

// GOOD: health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: process.env.VERSION, uptime: process.uptime() });
});
```

### Missing Graceful Shutdown

```typescript
// BAD: no graceful shutdown
process.on('SIGTERM', () => process.exit(0)); // abrupt

// GOOD: graceful shutdown
process.on('SIGTERM', async () => {
  await server.close(); // stop accepting connections
  await db.disconnect(); // close DB
  await cache.disconnect(); // close cache
  process.exit(0);
});
```

### Missing Circuit Breaker

```typescript
// BAD: no circuit breaker, cascading failures
async function callExternalAPI() {
  const response = await fetch(externalURL); // if external is down, all retries fail
  return response.json();
}

// GOOD: circuit breaker
const breaker = new CircuitBreaker(callExternalAPI, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});
```

---

## Detection Commands

```bash
# Find circular dependencies
npx madge --circular src/
npx dependency-cruiser src/ --config .dependency-cruiser.js

# Count lines per file
find src/ -name "*.ts" -exec wc -l {} + | sort -rn | head -20

# Count methods per class
# TypeScript: grep -n "class\|  public\|  private\|  protected" src/ | awk ...

# Find long functions
grep -n "function\|=> {" src/ -r | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  # Check function length by finding next closing brace
done

# Check for missing dependency injection
grep -rn "new " src/ --include="*.ts" | grep -v "test\|spec\|mock" | grep -v "container\|injector"
```
