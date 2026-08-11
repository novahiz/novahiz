# Tech Debt Detector — Guide d'Utilisation

## Vue d'Ensemble

Le skill `tech-debt-detector` détecte exhaustivement les 15 types de dette technique lors des revues de code. Il complète `code-review-excellence` en se concentrant spécifiquement sur les patterns d'accumulation de dette et les coûts de maintenance à long terme.

## Quand Utiliser

- Lors de toute revue de code (auto-trigger avec `code-review-excellence`)
- Pour évaluer la santé globale d'un projet
- Pour planifier des priorités de refactoring
- Pour détecter la dette cachée lors de l'intégration à un nouveau projet

## Comment Utiliser

### 1. Utilisation Automatique (Recommandée)

Le skill se déclenche automatiquement lorsque vous lancez une revue de code :

```
User: "skills: Review ce PR"
Agent: 
1. Charge code-review-excellence
2. Charge tech-debt-detector
3. Exécute les deux skills
4. Génère un rapport combiné
```

### 2. Utilisation Manuelle

Pour analyser un projet spécifique :

```
User: "skills: Détecte la dette technique dans ce projet"
Agent:
1. Charge tech-debt-detector
2. Exécute les outils automatisés
3. Analyse le code manuellement
4. Génère le rapport de dette
```

### 3. Intégration au Workflow

Le gate `novahiz-gate` vérifie automatiquement que les deux skills sont chargés lorsqu'une revue de code est planifiée.

## Les 15 Catégories de Dette

| # | Catégorie | Description | Exemples |
|---|-----------|-------------|----------|
| 1 | **Code** | Duplication, complexité, fonctions longues | Code copié-collé, fonctions >50 lignes |
| 2 | **Architecture** | Couplage, violations de couches | God classes, imports circulaires |
| 3 | **Design** | Abstractions faibles, interfaces fuitantes | Interfaces trop larges, détails qui fuient |
| 4 | **Test** | Couverture manquante, tests flaky | Pas de tests, tests qui échouent aléatoirement |
| 5 | **Documentation** | Docs manquantes ou obsolètes | README incomplet, JSDoc manquant |
| 6 | **Build** | CI/CD lent ou fragile | Pipeline de 30 minutes, checks manquants |
| 7 | **Infrastructure** | Images obsolètes, pas d'IaC | Dockerfile avec base Ubuntu:18.04 |
| 8 | **Défauts** | Bugs connus avec workarounds | "TODO: fix this bug" |
| 9 | **Exigences** | Écart entre code et comportement voulu | Fonctionnalité non implémentée |
| 10 | **Processus** | Workflows manuels automatisables | Déploiement manuel via SSH |
| 11 | **Connaissance** | Savoir tribal, facteur bus | Un seul dev connaît le système de paiement |
| 12 | **Service** | APIs obsolètes, dépendances périmées | Utilisation d'API dépréciée |
| 13 | **Sécurité** | Secrets hardcodés, validation manquante | Mot de passe en dur, injection SQL |
| 14 | **UX/UI** | Patterns incohérents, pas de design system | Boutons de styles différents |
| 15 | **Données** | Schéma incohérent, migrations manquantes | Champ ajouté sans migration |

## Classification des Détectons

### Sévérité

| Niveau | Critère |
|--------|---------|
| **Critique** | Perte de données, faille de sécurité, bloque toutes les features |
| **Haute** | Fardeau de maintenance significatif, impact >20% sur la vélocité |
| **Moyenne** | Sous-optimal, causera des problèmes dans 6 mois |
| **Basse** | Code smell, inefficacité mineure |
| **Info** | À noter, pas d'action immédiate |

### Quadrant de Fowler

Chaque finding est classé selon le quadrant de Martin Fowler :

| | Imprudent | Prudent |
|---|---|---|
| **Délibéré** | "On n'a pas le temps pour le design" | "On ship maintenant, on fix après" |
| **Inadvertant** | "C'est quoi une couche ?" | "Maintenant on sait mieux" |

### Matrice de Priorisation (Modèle Riot Games)

Score sur 3 axes (1-5) :
- **Impact** : Ça fait mal aux utilisateurs/développeurs maintenant ?
- **Coût de fix** : Temps + risque pour corriger
- **Contagion** : Ça se propage si on laisse faire ?

**Priorité = Impact × Contagion / Coût de fix**

## Outils de Détection

### TypeScript/JavaScript

```bash
# Linting
npx eslint . --format json

# Type checking
npx tsc --noEmit

# Dépendances vulnérables
npm audit --json

# Dépendances circulaires
npx madge --circular src/
```

### Python

```bash
# Linting
flake8 . --statistics --count

# Sécurité
bandit -r . -f json

# Types
mypy src/ --strict
```

### Multi-langages

```bash
# Sécurité
semgrep --config=auto --json

# Secrets
gitleaks detect --source=. --report-format json

# Conteneurs
hadolint Dockerfile
trivy fs . --format json
```

## Format de Rapport

```markdown
## Technical Debt Report

### Executive Summary
- **Critique:** X | **Haute:** Y | **Moyenne:** Z | **Basse:** W
- **Total findings:** N
- **Top 3 priorités:**
  1. [finding le plus prioritaire]
  2. [deuxième priorité]
  3. [troisième priorité]

### Détail des Findings

#### DEBT-001: [Titre]
- **Catégorie:** code | architecture | test | ...
- **Sévérité:** Critique/Haute/Moyenne/Basse
- **Fichier:** `chemin/vers/fichier:ligne`
- **Description:** [Qu'est-ce que c'est]
- **Impact:** [Ça affecte quoi]
- **Remédiation:**
  - Minimale: [Quick fix]
  - Meilleure: [Approche recommandée]
  - Complète: [Best practice]

### Plan d'Action Recommandé
1. **Ce sprint:** [Items critiques]
2. **2 prochains sprints:** [Items haute]
3. **Backlog:** [Items moyenne/basse]
```

## Bonnes Pratiques

1. **Ne pas ignorer les findings critiques** — Ils représentent des risques réels
2. **Prioriser par impact × contagion** — Les dettes qui se propagent sont plus urgentes
3. **Documenter les décisions** — Si on choisit de ne pas fix, documenter pourquoi
4. **Créer des tickets** — Chaque finding devrait avoir un ticket associé
5. **Revérifier après fix** — S'assurer que le fix n'a pas introduit de nouvelle dette

## Intégration avec code-review-excellence

Les deux skills collaborent pendant les revues de code :

| Dimension | code-review-excellence | tech-debt-detector |
|-----------|----------------------|-------------------|
| Focus | Correction, sécurité, performance | Accumulation de dette, maintenabilité |
| Horizon | Problèmes immédiats | Coûts à long terme |
| Output | Suggestions de fix | Inventaire de dette + priorisation |
| Sévérité | Bugs/vulnérabilités | Fardeau de maintenance |

## Limitations

- La disponibilité des outils varie selon les projets
- L'architecture nécessite un contexte plus large qu'un seul diff
- La dette de connaissance nécessite l'historique git
- Certaines dettes (processus, exigences) nécessitent du contexte métier

## Ressources

- `references/code-debt.md` — Patterns par langage
- `references/architecture-debt.md` — Structure et couplage
- `references/test-debt.md` — Couverture et qualité
- `references/security-debt.md` — Vulnérabilités
- `references/detection-tools.md` — Guide des outils
