# Patterns Manquants — Analyse Post-Test

## Patterns Détectés Correctement

### Security Debt (6/6)
- ✅ SQL injection
- ✅ Hardcoded credentials
- ✅ Missing input validation
- ✅ Weak password hashing
- ✅ Insecure random
- ✅ No rate limiting

### Architecture Debt (3/3)
- ✅ God class
- ✅ Tight coupling
- ✅ Shared mutable state

### Code Debt (4/4)
- ✅ Long function with deep nesting
- ✅ Duplicate code
- ✅ Magic numbers
- ✅ Unused code

### Test Debt (2/2)
- ✅ Missing tests
- ✅ Missing edge case coverage

### Documentation Debt (2/2)
- ✅ Missing JSDoc
- ✅ Incomplete README

### Infrastructure Debt (2/2)
- ✅ No health checks
- ✅ No graceful shutdown

## Patterns Potentiellement Manquants

### 1. Design Debt (Non détecté dans le test)

**Pattern faible d'abstraction:**
```typescript
// Le test n'a pas de bon exemple de dette de design
// À ajouter dans les prochains tests
export interface UserService {
  createUser(data: any): Promise<any>; // any = interface faible
  updateUser(id: any, data: any): Promise<any>;
}
```

**Pattern interface fuitante:**
```typescript
// Un service expose les détails d'implémentation
export class DatabaseService {
  // Expose le client DB directement
  public client: MongoClient; // Fuite d'implémentation
}
```

### 2. Service Debt (Non détecté dans le test)

**Pattern API obsolète:**
```typescript
// Utilisation d'API dépréciée
import { deprecated } from 'old-library';
deprecated.doSomething(); // API dépréciée
```

**Pattern dépendance périmée:**
```json
{
  "dependencies": {
    "express": "4.15.0", // Version très ancienne
    "lodash": "4.17.15" // Version avec vulnérabilités connues
  }
}
```

### 3. Build Debt (Non détecté dans le test)

**Pattern CI/CD lent:**
```yaml
# .github/workflows/ci.yml
jobs:
  build:
    steps:
      - run: npm install # Pas de cache
      - run: npm test # Tests lents
      - run: npm run build # Build non parallélisé
```

**Pattern check manquant:**
```yaml
jobs:
  build:
    steps:
      - run: npm test
      # Pas de linting
      # Pas de type checking
      # Pas de security scan
```

### 4. Process Debt (Non détecté dans le test)

**Pattern déploiement manuel:**
```bash
# README.md
## Deployment
1. SSH into server
2. Pull latest code
3. Run npm install
4. Restart service
```

**Pattern release manuelle:**
```bash
# Pas de semantic-release
# Pas de changelog automatique
# Pas de versioning sémantique
```

### 5. Knowledge Debt (Non détecté dans le test)

**Pattern tribal knowledge:**
```typescript
// Seul un dev comprend cette logique
// Pas de documentation
// Pas de comments explicatifs
function legacyProcessing(data: any) {
  // Magic numbers without explanation
  if (data.flag & 0x1F) { // What does 0x1F mean?
    return complexAlgorithm(data);
  }
}
```

### 6. Requirements Debt (Non détecté dans le test)

**Pattern écart fonctionnel:**
```typescript
// La spec dit: "Les utilisateurs premium ont 20% de réduction"
// Le code dit:
function getDiscount(user: User) {
  if (user.role === 'premium') {
    return 0.1; // 10% au lieu de 20%
  }
  return 0;
}
```

## Patterns à Ajouter aux Références

### references/design-debt.md (à créer)

```markdown
# Design Debt — Detection Patterns

## Weak Abstraction
- Interfaces avec trop de méthodes
- Types `any` dans les signatures publiques
- Classes qui exposent leurs détails internes

## Leaky Interfaces
- Services qui exposent leurs dependencies
- Modules qui importent de détails d'implémentation
- Composants qui dépendent de contexte externe

## Missing Patterns
- Pas de Strategy pattern pour variations
- Pas de Factory pour création complexe
- Pas d'Observer pour événements
```

### references/service-debt.md (à créer)

```markdown
# Service Debt — Detection Patterns

## Deprecated APIs
- Utilisation de fonctions marquées @deprecated
- Appels à des endpoints qui seront supprimés
- Usage de libraries non maintenues

## Outdated Dependencies
- Versions majeures en retard
- Vulnérabilités connues non patchées
- Dépendances qui ne supportent plus le Node.js/Python utilisé

## Missing Versioning
- Pas de versioning d'API
- Pas de deprecation warnings
- Pas de migration path
```

### references/build-debt.md (à créer)

```markdown
# Build Debt — Detection Patterns

## Slow CI/CD
- Pipeline > 10 minutes
- Pas de parallélisation
- Pas de cache des dépendances

## Missing Checks
- Pas de linting
- Pas de type checking
- Pas de security scan
- Pas de test coverage check

## Fragile Build
- Build qui échoue aléatoirement
- Dépendances externes non mockées
- Environnement non reproductible
```

## Recommandations

1. ✅ **Ajouter les references manquantes** : `design-debt.md`, `service-debt.md`, `build-debt.md` — CRÉÉS
2. **Enrichir les patterns existants** : Ajouter les patterns de knowledge et requirements debt
3. **Créer un projet de test étendu** : Ajouter des exemples pour chaque pattern manquant
4. ✅ **Automatiser la détection** : `rules/semgrep/tech-debt-critical.yml` créé (15 règles)

## Priorité des Ajouts

| Priorité | Pattern | Impact | Effort | Statut |
|----------|---------|--------|--------|--------|
| Haute | Service debt (API obsolètes) | Élevé | Moyen | ✅ Done |
| Haute | Build debt (CI/CD lent) | Élevé | Faible | ✅ Done |
| Moyenne | Design debt (abstractions) | Moyen | Moyen | ✅ Done |
| Moyenne | Knowledge debt (tribal) | Moyen | Élevé | ⏳ Pending |
| Basse | Requirements debt (écarts) | Faible | Élevé | ⏳ Pending |

## Résolu (2026-07-19)

- [x] `references/service-debt.md` — Deprecated APIs, outdated deps, missing versioning, no circuit breaker
- [x] `references/build-debt.md` — Slow CI/CD, missing checks, fragile build, manual deploy
- [x] `references/design-debt.md` — Weak abstractions, leaky interfaces, missing patterns, god components
- [x] `rules/semgrep/tech-debt-critical.yml` — 15 règles critiques (security/code/architecture/infra)
- [x] Auto-install tools in SKILL.md — improved fallback from 60% to ~95% coverage
- [x] SKILL.md language matrix updated with 3 new references + semgrep rules pointer
