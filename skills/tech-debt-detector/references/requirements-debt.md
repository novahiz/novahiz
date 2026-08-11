# Requirements Debt — Detection Patterns

Dette d'exigences : écart entre le comportement spécifié et le comportement réel du code.

## Spec/Code Gap

### Détection
- Logique métier qui contredit la documentation/spec
- Valeurs codées en dur différentes de la spec
- Comportements manquants par rapport aux user stories
- États non gérés mentionnés dans la spec

### ❌ Dette
```typescript
// Spec: "Les utilisateurs premium ont 20% de réduction"
function getDiscount(user: User): number {
  if (user.role === 'premium') {
    return 0.1;  // 10% au lieu de 20% — bug ou spec changée ?
  }
  return 0;
}
```

### ✅ Correct
```typescript
// Aligné avec spec pricing v3.1: premium = 20%
const PREMIUM_DISCOUNT = 0.2;
function getDiscount(user: User): number {
  return user.role === 'premium' ? PREMIUM_DISCOUNT : 0;
}
```

## Missing Features

### Détection
- Fonctionnalité dans la roadmap mais non implémentée
- Endpoint documenté mais non présent
- Champ dans le modèle de données mais non exposé
- TODO qui correspond à une exigence client

### ❌ Dette
```typescript
// README: "Export CSV disponible"
// Code: pas d'endpoint /export
app.get('/users', listUsers);
// ❌ Pas de /users/export
```

### ✅ Correct
```typescript
app.get('/users', listUsers);
app.get('/users/export', exportUsersCsv);  // Implémenté
```

## Silent Behavior

### Détection
- Erreurs swallowées sans message utilisateur
- Fallback silencieux qui change le comportement attendu
- Validation qui laisse passer par défaut
- Race condition non gérée "par chance"

### ❌ Dette
```typescript
try {
  await sendEmail(user);
} catch (e) {
  // Silencieux — l'utilisateur croit que l'email est parti
}
```

### ✅ Correct
```typescript
try {
  await sendEmail(user);
} catch (e) {
  logger.error('Email failed', { userId: user.id, error: e });
  throw new NotificationError('Échec envoi email', { cause: e });
}
```

## Implicit Requirements

### Détection
- Performance non respectée (timeout dépassé)
- Accessibilité non conforme (WCAG)
- Sécurité non alignée sur la politique
- Compatibilité navigateur non gérée

### ❌ Dette
```typescript
// Spec: "Réponse < 200ms"
await heavyComputation();  // Peut prendre 2s, pas de cache
```

### ✅ Correct
```typescript
// Spec: < 200ms — cache + délégation async
const cached = await cache.get(key) ?? await computeAsync(key);
```

## Versioning Mismatch

### Détection
- API v1 expose des champs supprimés en v2
- Client attend un contrat différent de celui servi
- Migration de données non alignée sur la nouvelle spec

### ❌ Dette
```typescript
// Client v2 attend { id: string }
// Serveur v1 retourne encore { id: number }
```

## Ambiguous Acceptance Criteria

### Détection
- User story sans critères d'acceptation testables
- Comportement "edge case" non spécifié
- Pas de test d'intégration pour le parcours critique

### Checklist
- [ ] Chaque user story a des critères d'acceptation
- [ ] Les parcours critiques ont des tests E2E
- [ ] Les valeurs métier sont dans des constantes nommées
- [ ] La documentation est à jour avec le code

## Matrice de Sévérité

| Pattern | Sévérité | Contagion | Priorité |
|---------|----------|-----------|----------|
| Spec/code gap (prod impact) | Critical | High | 0.9 |
| Fonctionnalité manquante (client attend) | High | High | 0.7 |
| Silent failure (data loss) | Critical | High | 0.95 |
| Performance non respectée | Medium | Medium | 0.5 |
| Critères ambigus | Low | Low | 0.3 |

## Limites de Détection

- Nécessite la spec ou la documentation produit
- L'LLM ne peut détecter le gap que si la spec est fournie
- Les silent failures nécessitent une lecture attentive
- À documenter comme "requires business context"

## Références
- [[tech-debt-detector]]
- [[documentation-debt]]
- [[test-debt]]
