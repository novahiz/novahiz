# Design Debt — Detection Patterns

Dette de design : abstractions faibles, interfaces fuitantes, patterns manquants.

## Weak Abstraction

### Détection
- Interfaces avec `any` dans les signatures publiques
- Classes qui exposent trop de méthodes (interface trop large)
- Pas de séparation des préoccupations
- Couplage fort entre modules

### TypeScript/JavaScript
```typescript
// ❌ Dette: interface faible avec any
export interface UserService {
  createUser(data: any): Promise<any>;
  updateUser(id: any, data: any): Promise<any>;
}

// ✅ Correct: types explicites
export interface CreateUserDTO {
  email: string;
  name: string;
}
export interface User {
  id: string;
  email: string;
  name: string;
}
export interface UserService {
  createUser(data: CreateUserDTO): Promise<User>;
  updateUser(id: string, data: Partial<CreateUserDTO>): Promise<User>;
}
```

### Python
```python
# ❌ Dette: signature sans type
def process(data):
    return data['result']

# ✅ Correct: types explicites
from dataclasses import dataclass
@dataclass
class ProcessResult:
    result: str
def process(data: dict[str, Any]) -> ProcessResult:
    return ProcessResult(result=data['result'])
```

## Leaky Interfaces

### Détection
- Services qui exposent leurs dépendances internes
- Modules qui importent des détails d'implémentation
- Composants dépendants du contexte externe
- Couplage à la couche de persistance dans la couche domaine

### ❌ Dette
```typescript
export class DatabaseService {
  // Fuite d'implémentation: expose le client directement
  public client: MongoClient;
  
  constructor(client: MongoClient) {
    this.client = client;
  }
}

// Ailleurs dans le code
const db = new DatabaseService(client);
db.client.db('users').collection('profiles').findOne({});  // Couplage direct
```

### ✅ Correct
```typescript
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export class MongoUserRepository implements UserRepository {
  constructor(private readonly collection: Collection<User>) {}
  
  async findById(id: string): Promise<User | null> {
    return this.collection.findOne({ _id: id });
  }
}

// Usage
const repo: UserRepository = new MongoUserRepository(collection);
const user = await repo.findById('123');  // Pas de fuite
```

## Missing Patterns

### Strategy Pattern Manquant
```typescript
// ❌ Dette: if/else pour variations de comportement
function calculateDiscount(user: User, amount: number): number {
  if (user.role === 'premium') return amount * 0.8;
  if (user.role === 'vip') return amount * 0.7;
  return amount;
}

// ✅ Correct: Strategy pattern
interface DiscountStrategy {
  calculate(amount: number): number;
}
class PremiumDiscount implements DiscountStrategy {
  calculate(amount: number) { return amount * 0.8; }
}
```

### Factory Pattern Manquant
```typescript
// ❌ Dette: switch pour création d'objets
function createParser(type: string) {
  switch (type) {
    case 'json': return new JsonParser();
    case 'xml': return new XmlParser();
  }
}

// ✅ Correct: Factory avec registry
class ParserFactory {
  private static parsers = new Map<string, ParserConstructor>();
  static register(type: string, ctor: ParserConstructor) {
    this.parsers.set(type, ctor);
  }
  static create(type: string): Parser {
    const Ctor = this.parsers.get(type);
    if (!Ctor) throw new Error(`Unknown parser: ${type}`);
    return new Ctor();
  }
}
```

### Observer Pattern Manquant
```typescript
// ❌ Dette: polling au lieu d'events
setInterval(() => {
  if (cacheChanged) refreshUI();
}, 1000);

// ✅ Correct: EventEmitter / Observer
eventBus.on('cache:changed', refreshUI);
```

## God Component (Frontend)

### Détection
- Composant React > 300 lignes
- Props > 10
- Responsabilités multiples (data + UI + logic)

### ❌ Dette
```tsx
function UserDashboard({ userId }: { userId: string }) {
  const [user, setUser] = useState();
  const [orders, setOrders] = useState();
  const [loading, setLoading] = useState(false);
  // ... 400 lignes de tout mélangé
}
```

### ✅ Correct
```tsx
function UserDashboard({ userId }: { userId: string }) {
  const user = useUser(userId);
  const orders = useOrders(userId);
  return (
    <ErrorBoundary>
      <Suspense fallback={<Skeleton />}>
        <UserHeader user={user} />
        <OrderList orders={orders} />
      </Suspense>
    </ErrorBoundary>
  );
}
```

## Anemic Domain Model

### Détection
- Entités avec uniquement des getters/setters
- Logique métier dans les services
- Pas d'encapsulation des règles

### ❌ Dette
```typescript
class Order {
  id: string;
  items: Item[];
  status: string;
}
// Logique ailleurs
function canShip(order: Order): boolean {
  return order.status === 'paid' && order.items.length > 0;
}
```

### ✅ Correct
```typescript
class Order {
  constructor(private id: string, private items: Item[], private status: OrderStatus) {}
  canShip(): boolean {
    return this.status === OrderStatus.PAID && this.items.length > 0;
  }
}
```

## Matrice de Sévérité

| Pattern | Sévérité | Contagion | Priorité |
|---------|----------|-----------|----------|
| `any` dans API publique | High | High | 0.7 |
| Interface fuitante | High | High | 0.75 |
| God component | Medium | Medium | 0.5 |
| Pattern manquant (Strategy/Factory) | Medium | Low | 0.4 |
| Anemic model | Low | Medium | 0.45 |

## Références
- [[tech-debt-detector]]
- [[architecture-debt]]
- [[code-debt]]
