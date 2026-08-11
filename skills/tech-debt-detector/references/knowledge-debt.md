# Knowledge Debt — Detection Patterns

Dette de connaissance : savoir critique non documenté, facteur bus, décisions non tracées.

## Tribal Knowledge

### Détection
- Logique métier sans commentaire ni documentation
- Fonctions dont le "pourquoi" n'est connu que par un dev
- Constantes magiques sans explication (ex: `if (flag & 0x1F)`)
- Algorithmes legacy non documentés

### ❌ Dette
```typescript
function legacyProcessing(data: any) {
  // Personne ne sait pourquoi 0x1F
  if (data.flag & 0x1F) {
    return complexAlgorithm(data);
  }
}
```

### ✅ Correct
```typescript
/**
 * Applique le traitement legacy pour compatibilité avec l'API v1 (deprecated 2024).
 * 0x1F = masque des 5 premiers bits = catégories historiques A-E.
 * TODO: supprimer quand tous les clients auront migré (Q3 2025).
 */
function legacyProcessing(data: LegacyData): Result {
  if (data.flag & LEGACY_CATEGORY_MASK) {
    return complexAlgorithm(data);
  }
}
```

## Bus Factor

### Détection
- Un seul auteur sur un module critique (git blame)
- Pas de revue par les pairs sur les fichiers sensibles
- Aucun test sur le code ne connaissant qu'un dev
- Documentation absente pour les intégrations externes

### Commande de détection
```bash
# Auteurs par fichier (bus factor)
git blame --line-porcelain src/payment-service.ts | grep '^author ' | sort | uniq -c | sort -rn

# Fichiers avec un seul contributeur
for f in $(git ls-files 'src/*.ts'); do
  authors=$(git blame --line-porcelain "$f" | grep -c '^author ')
  if [ "$authors" -eq 1 ]; then echo "SINGLE AUTHOR: $f"; fi
done
```

### Métrique
| Bus factor | Risque |
|------------|--------|
| 1 (un seul dev) | Critique |
| 2 | High |
| 3+ | Acceptable |

## Undocumented Decisions

### Détection
- Choix d'architecture sans ADR (Architecture Decision Record)
- Workarounds sans explication du problème original
- `@ts-ignore` / `eslint-disable` sans justification
- Branches de code avec commentaire "don't touch this"

### ❌ Dette
```typescript
// @ts-ignore
const result = legacyCall();  // Pourquoi ignore ?
```

### ✅ Correct
```typescript
// @ts-ignore: legacyCall retourne any (lib v2.1 typings incomplets)
// Tracked: https://github.com/org/repo/issues/123
const result = legacyCall();
```

## Missing Onboarding Docs

### Détection
- Pas de README ou README vide
- Setup local non documenté
- Variables d'environnement non listées
- Pas de runbook pour les incidents

### Checklist
- [ ] README avec quickstart
- [ ] Liste des variables d'env (`.env.example`)
- [ ] Instructions de setup DB
- [ ] Runbook d'incident
- [ ] Architecture overview (diagramme ou MOC)

## Implicit Domain Rules

### Détection
- Règles métier codées en dur sans lien vers la spec
- Validations qui ne correspondent pas aux exigences documentées
- États système non modélisés explicitement

### ❌ Dette
```typescript
// La règle "max 3 essais" n'est nulle part documentée
if (attempts >= 3) lockAccount();
```

### ✅ Correct
```typescript
// Règle métier: MAX_LOGIN_ATTEMPTS = 3 (voir spec auth v2.3, §4.2)
const MAX_LOGIN_ATTEMPTS = 3;
if (attempts >= MAX_LOGIN_ATTEMPTS) lockAccount();
```

## Matrice de Sévérité

| Pattern | Sévérité | Contagion | Priorité |
|---------|----------|-----------|----------|
| Bus factor = 1 sur module critique | Critical | High | 0.9 |
| Décision non documentée (prod impact) | High | Medium | 0.6 |
| Tribal knowledge (algo legacy) | Medium | Medium | 0.5 |
| Setup non documenté | Medium | Low | 0.4 |
| Commentaire "don't touch" | Low | Low | 0.3 |

## Limites de Détection

- Nécessite l'historique git (blame, log)
- Difficile à détecter sans contexte métier
- L'LLM ne peut inférer le bus factor qu'avec git
- À documenter dans le rapport comme "requires git history analysis"

## Références
- [[tech-debt-detector]]
- [[process-debt]]
- [[documentation-debt]]
