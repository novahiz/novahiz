# Service Debt — Detection Patterns

Dette de service : problèmes liés aux APIs externes, dépendances et versioning.

## Deprecated APIs

### Détection
- Fonctions marquées `@deprecated` encore utilisées
- Appels à des endpoints annoncés comme dépréciés
- Imports depuis des modules en "end of life"

### TypeScript/JavaScript
```typescript
// ❌ Dette: utilisation d'API dépréciée
import { deprecatedHelper } from 'legacy-utils';
deprecatedHelper.doSomething(); // @deprecated since v2.0

// ✅ Correct: migration vers la nouvelle API
import { newHelper } from 'modern-utils';
newHelper.doSomething();
```

### Python
```python
# ❌ Dette: méthode dépréciée
from collections import Mapping  # Déprécié en Python 3.10
# ✅ Correct
from collections.abc import Mapping
```

### Règle semgrep
```yaml
- id: deprecated-api-usage
  pattern: deprecatedHelper(...)
  message: "API dépréciée détectée"
  severity: WARNING
```

## Outdated Dependencies

### Détection
- Versions majeures en retard (> 2 versions)
- Vulnérabilités connues (CVE) non patchées
- Dépendances non maintenues (> 1 an sans release)

### package.json
```json
{
  "dependencies": {
    "express": "4.15.0",   // ❌ Version de 2017, vulnérable
    "lodash": "4.17.15"    // ❌ CVE-2020-8203 non patché
  }
}
```

### pyproject.toml
```toml
[tool.poetry.dependencies]
django = "2.2"  # ❌ EOL, plus de sécurité
```

### Détection automatisée
```bash
npm audit --json          # Vulnérabilités npm
pip-audit --format json   # Vulnérabilités Python
npm outdated              # Versions périmées
```

## Missing Versioning

### Détection
- API sans numéro de version dans l'URL
- Pas de header `Deprecation` sur les endpoints anciens
- Pas de `Sunset` header pour annoncer la fin de vie

### ❌ Dette
```typescript
app.get('/users', handler);  // Pas de version
```

### ✅ Correct
```typescript
app.get('/v1/users', handler);
// Header: Deprecation: true, Sunset: Wed, 31 Dec 2025 23:59:59 GMT
```

## Unversioned Breaking Changes

### Détection
- Modification de schéma de réponse sans bump de version
- Suppression de champ sans période de transition
- Changement de type de paramètre

### ❌ Dette
```typescript
// v1 retournait { id: number }
// v2 retourne { id: string }  // Breaking change silencieuse
```

## Hardcoded Endpoints

### Détection
- URLs d'API en dur dans le code
- Pas de configuration centralisée
- Environnements (dev/staging/prod) mélangés

### ❌ Dette
```typescript
const API_URL = 'https://api.production.com';  // En dur
```

### ✅ Correct
```typescript
const API_URL = process.env.API_BASE_URL;  // Configurable
```

## No Circuit Breaker

### Détection
- Appels externes sans timeout
- Pas de retry avec backoff
- Pas de fallback sur échec

### ❌ Dette
```typescript
const res = await fetch(externalApi);  // Peut bloquer indéfiniment
```

### ✅ Correct
```typescript
const res = await fetchWithCircuitBreaker(externalApi, {
  timeout: 5000,
  retries: 3,
  fallback: cachedResponse
});
```

## Matrice de Sévérité

| Pattern | Sévérité | Contagion | Priorité |
|---------|----------|-----------|----------|
| API dépréciée (EOL) | High | High | 0.8 |
| Dépendance vulnérable (CVE) | Critical | High | 0.95 |
| Pas de versioning d'API | Medium | Medium | 0.5 |
| Endpoint en dur | Low | Low | 0.3 |
| Pas de circuit breaker | High | Medium | 0.6 |

## Références
- [[tech-debt-detector]]
- [[security-debt]]
- [[detection-tools]]
