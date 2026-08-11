# Build Debt — Detection Patterns

Dette de build : problèmes liés à CI/CD, pipeline et reproductibilité.

## Slow CI/CD

### Détection
- Pipeline > 10 minutes
- Pas de parallélisation des jobs
- Pas de cache des dépendances
- Tests séquentiels non parallélisés

### ❌ Dette (.github/workflows/ci.yml)
```yaml
jobs:
  build:
    steps:
      - run: npm install          # Pas de cache
      - run: npm test             # Séquentiel, lent
      - run: npm run build        # Build non parallélisé
      - run: npm run lint         # Dernière étape
```

### ✅ Correct
```yaml
jobs:
  install:
    steps:
      - uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ hashFiles('package-lock.json') }}
      - run: npm ci
  test:
    needs: install
    strategy:
      matrix:
        shard: [1, 2, 3, 4]      # Parallélisation
    steps:
      - run: npm test -- --shard=${{ matrix.shard }}
  build:
    needs: [install, test]
    steps:
      - run: npm run build
```

### Métriques
| Taille projet | Cible | Acceptable | Critique |
|---------------|-------|------------|----------|
| < 100 fichiers | < 3 min | < 8 min | > 15 min |
| 100-1000 | < 8 min | < 15 min | > 30 min |
| > 1000 | < 15 min | < 25 min | > 45 min |

## Missing Checks

### Détection
- Pas de linting dans le pipeline
- Pas de type checking
- Pas de security scan
- Pas de test coverage gate
- Pas de build check

### ❌ Dette
```yaml
jobs:
  build:
    steps:
      - run: npm test    # Rien d'autre
```

### ✅ Correct
```yaml
jobs:
  quality:
    steps:
      - run: npm run lint
      - run: npm run typecheck
      - run: npm audit
      - run: npx semgrep --config=auto
  test:
    steps:
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4
```

## Fragile Build

### Détection
- Build qui échoue aléatoirement (flaky)
- Dépendances externes non mockées
- Environnement non reproductible (pas de lockfile)
- Tests d'intégration sans conteneur isolé

### ❌ Dette
```json
{
  "dependencies": {
    "left-pad": "*"   // Version flottante = non reproductible
  }
}
```

### ✅ Correct
```json
{
  "dependencies": {
    "left-pad": "1.3.0"   // Version épinglée
  },
  "lockfileVersion": 3     // Lockfile présent
}
```

## Manual Deployment

### Détection
- Déploiement via SSH manuel
- Pas de pipeline de déploiement
- Pas de rollback automatique
- Scripts shell non versionnés

### ❌ Dette (README.md)
```markdown
## Deploy
1. SSH to server
2. git pull
3. npm install
4. pm2 restart
```

### ✅ Correct
```yaml
deploy:
  needs: [build, test]
  steps:
    - uses: azure/webapps-deploy@v3
    - if: failure()
      run: rollback.sh
```

## Missing Artifact Management

### Détection
- Pas de stockage d'artefacts entre jobs
- Rebuild à chaque étape
- Pas de cache de Docker layers

### ❌ Dette
```yaml
jobs:
  build:
    steps:
      - run: docker build .   # Rebuild à chaque fois
  deploy:
    needs: build
    steps:
      - run: docker build .   # Rebuild encore
```

### ✅ Correct
```yaml
jobs:
  build:
    steps:
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: registry/app:${{ github.sha }}
  deploy:
    needs: build
    steps:
      - run: kubectl set image deploy/app app=registry/app:${{ github.sha }}
```

## No Quality Gates

### Détection
- Pas de seuil de coverage minimum
- Pas de limite de complexité
- Pas de blocage sur vulnérabilités

### ❌ Dette
```yaml
- run: npm test -- --coverage   # Coverage ignorée
```

### ✅ Correct
```yaml
- run: npm test -- --coverage --coverage-threshold=80
```

## Matrice de Sévérité

| Pattern | Sévérité | Contagion | Priorité |
|---------|----------|-----------|----------|
| Pipeline > 30 min | High | Medium | 0.6 |
| Pas de security scan | Critical | High | 0.9 |
| Build flaky | High | High | 0.7 |
| Déploiement manuel | Medium | Medium | 0.5 |
| Pas de coverage gate | Medium | Low | 0.4 |

## Références
- [[tech-debt-detector]]
- [[infrastructure-debt]]
- [[detection-tools]]
