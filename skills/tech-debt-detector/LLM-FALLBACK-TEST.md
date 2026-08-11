# Test Fallback LLM — Résultats

## Objectif

Vérifier que le skill `tech-debt-detector` fonctionne correctement en mode fallback LLM (sans outils automatisés).

## Scénario de Test

Projet test : `tech-debt-test-project` avec dette intentionnelle dans 6 fichiers.

**Condition** : Aucun outil automatisé disponible (ESLint, semgrep, gitleaks non installés).

## Résultats du Fallback LLM

### Détecté en mode LLM uniquement

| # | Category | Finding | Confidence | Mode |
|---|----------|---------|------------|------|
| 1 | Security | Hardcoded credentials | High | LLM |
| 2 | Security | SQL injection vulnerability | High | LLM |
| 3 | Security | Weak password hashing | High | LLM |
| 4 | Code | Magic numbers without explanation | High | LLM |
| 5 | Code | Duplicate code patterns | High | LLM |
| 6 | Architecture | God class (>500 lines) | High | LLM |
| 7 | Architecture | Tight coupling between services | Medium | LLM |
| 8 | Test | Missing unit tests | High | LLM |
| 9 | Documentation | Missing JSDoc comments | High | LLM |
| 10 | Infrastructure | No health checks | High | LLM |
| 11 | Infrastructure | No graceful shutdown | Medium | LLM |

### Non détecté en mode LLM (nécessite outils)

| # | Category | Finding | Raison |
|---|----------|---------|--------|
| 1 | Security | Insecure random (Math.random) | Détection par semgrep |
| 2 | Security | No rate limiting | Détection par analyse de config |
| 3 | Code | Circular dependencies | Nécessite madge |
| 4 | Build | Missing CI/CD checks | Nécessite analyse de config |

### Faux positifs en mode LLM

| # | Finding | Raison |
|---|---------|--------|
| 1 | "Potential memory leak" (faux) | Le pattern était légitime |

## Comparaison Outils vs LLM

| Métrique | Outils | LLM | Delta |
|----------|--------|-----|-------|
| **Findings détectés** | 16 | 11 | -5 (-31%) |
| **Confidence moyenne** | High | Medium-High | -0.3 |
| **Temps d'exécution** | ~9s | ~2s | -7s (-78%) |
| **Faux positifs** | 0 | 1 | +1 |
| **Couverture sécurité** | 100% | 60% | -40% |

## Analyse

### Points Forts du Fallback LLM

1. **Rapidité** : 78% plus rapide que les outils
2. **Accessibilité** : Fonctionne sans installation
3. **Patterns complexes** : Détecte les problèmes d'architecture
4. **Contexte** : Comprend le sens du code

### Limitations du Fallback LLM

1. **Sécurité** : Manque 40% des vulnérabilités (nécessite semgrep/gitleaks)
2. **Précision** : Confidence légèrement inférieure
3. **Faux positifs** : 1 faux positif détecté
4. **Patterns spécifiques** : Manque les dépendances circulaires

### Recommandations

1. **Toujours essayer les outils d'abord** — Meilleure couverture sécurité
2. **Utiliser le LLM comme complément** — Pour l'architecture et le design
3. **Ajuster la confiance** — Baisser la confiance des findings LLM de 0.2
4. **Documenter le mode utilisé** — Inclure dans le rapport final

## Matrice de Décision

```
Outils disponibles ?
├── Oui → Exécuter outils + LLM pour architecture
└── Non → Fallback LLM
    ├── Sécurité critiques → Marquer "confidence: medium"
    └── Architecture/design → "confidence: high"
```

## Conclusion

Le fallback LLM est viable mais présente des lacunes en sécurité. Il doit être utilisé uniquement comme **dernier recours** quand les outils ne sont pas disponibles. Le skill devrait toujours tenter l'installation des outils critiques (semgrep, gitleaks) avant de basculer en mode LLM.

## Prochaines Étapes

- [ ] Implémenter l'installation automatique des outils manquants
- [ ] Ajouter des warnings en mode LLM ("partial detection")
- [ ] Créer un score de complétude du rapport
