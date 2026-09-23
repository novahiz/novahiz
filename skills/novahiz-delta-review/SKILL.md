---
name: novahiz-delta-review
description: novahiz-delta-review analyzes only the diff since the last commit with impact analysis. Token-efficient delta review with automatic blast-radius detection. Triggers on reviewing git diffs, assessing change impact, validating code changes before merge.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-delta-review

Analyse de diff intelligente avec détection de risque, calcul de blast radius et suggestions de tests. Elle ne lit que ce qui a changé depuis le dernier commit, puis remonte les impacts par appelants et imports.

## Quand l'utiliser

- Revue du travail non commité avant un commit.
- Validation d'un changement ciblé avant merge.
- Estimation rapide du risque d'un diff.

Pour une revue complète du dépôt, utiliser `novahiz-code-review`.

## Procédure

### 1. Collecter le delta

```
git diff            # working tree vs HEAD
git diff --staged   # staged vs HEAD
git status --short  # fichiers non suivis
```

Si le working tree est propre, s'arrêter : il n'y a rien à revivre.

### 2. Lire le diff

Lire chaque hunk. Ne pas ouvrir les fichiers entiers sauf si le contexte local ne suffit pas à juger la modification.

### 3. Blast radius

Pour chaque symbole modifié (fonction, classe, endpoint, colonne, route) :

- Qui l'appelle (références, imports, `narsil` ou `rg`).
- Quelles couches touchent (API, données, UI, tests).
- Ce qui casse si le contrat change.

Le rayon se note en couches touchées, pas en nombre de fichiers.

### 4. Classification du risque

| Risque | Critère | Action |
|--------|---------|--------|
| élevé | contrat public cassé, migration, auth, écriture de données | revue ligne à ligne + tests ciblés |
| moyen | logique interne, comportement observable | vérifier les appelants |
| faible | commentaires, typo, code mort | aperçu |

### 5. Suggestions de tests

Pour chaque risque ≥ moyen, proposer le test le plus petit qui prouve la non-régression. Un risque sans test proposé reste ouvert.

## Sortie

```
## Delta review
Fichiers: N (+x -y)
Risque global: élevé | moyen | faible

### Fichiers
- path | risque | note

### Blast radius
- symbole → appelants → couches

### Tests à ajouter
- ...

### Verdict
APPROVE | REQUEST_CHANGES | COMMENT
```

## Règles

- Ne reviewer que le delta. Les problèmes préexistants hors diff sont notés "vu mais hors scope" et deviennent une proposition, jamais une modification surprise.
- Chaque finding cite `fichier:ligne` réel.
- Un diff propre ne produit pas un rapport forcé : dire qu'il n'y a rien, c'est un résultat.
- Phrases variées, pas de triades forcées, pas de tirets enchaînés dans le rapport.
