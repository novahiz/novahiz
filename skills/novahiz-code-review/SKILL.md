---
name: novahiz-code-review
description: "novahiz-code-review is a three-layer intelligent code review: deterministic analysis, contextual review, human verdict. Triggers on reviewing PRs, analyzing code quality, assessing change risk, generating review reports."
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-code-review

Revue de code intelligente à trois couches. Analyse déterministe (patterns, complexité, secrets), review contextuelle (appels, types, flux de données), puis verdict humain final. Couvre 14 langages avec un moteur de règles extensible.

## Quand l'utiliser

- Revue de pull request ou de branche avant merge.
- Évaluation de la qualité du code ou du risque d'un changement.
- Production d'un rapport de review structuré.

Pour un diff ciblé depuis le dernier commit, préférer `novahiz-delta-review`. Pour un audit de sécurité dédié, préférer `novahiz-security`.

## Les trois couches

### 1. Analyse déterministe

Exécution de règles sans interprétation :

- **Patterns dangereux** : injection, XSS, path traversal, command injection, désérialisation non sûre.
- **Complexité** : cyclomatique, longueur de fonction, profondeur d'imbrication.
- **Secrets** : clés, tokens, mots de passe en clair dans le code.
- **Conventions** : nommage, structure de fichiers, imports.

Chaque finding porte un identifiant stable, une sévérité (`critical`, `high`, `medium`, `low`, `info`), et une localisation `fichier:ligne`.

### 2. Review contextuelle

Lecture au-delà de la ligne signalée :

- Qui appelle ce code, et avec quelles hypothèses.
- Les types et le contrat réel des fonctions voisines.
- Les flux de données : d'où vient l'entrée, où va la sortie.
- La cohérence avec les patterns du reste du dépôt.

Cette couche confirme, nuance ou infirme les findings déterministes. Un finding sans contexte réel est requalifié ou retiré.

### 3. Verdict humain

Synthèse finale :

- Ce qui doit bloquer le merge.
- Ce qui peut attendre.
- Ce qui est un faux positif et pourquoi.

Le verdict ne recopie pas la liste brute. Il tranche.

## Sortie structurée

```
## Review
Verdict: APPROVE | REQUEST_CHANGES | COMMENT

### Bloquant
- [CRITIQUE] fichier:ligne : titre
  Contexte: ...
  Correction: ...

### À améliorer
- ...

### Faux positifs écartés
- ... (raison)
```

## Règles

- Chaque finding cite un fichier et une ligne réels. Une observation sans chemin de fichier ne compte pas.
- Ne jamais inventer de symbole, d'API ou de chemin non vérifié.
- La sévérité reflète le risque réel, pas le nombre de matches.
- Ne pas noyer le verdict sous une liste interminable : trier par impact.
- Le rapport est un texte destiné à un lecteur : pas de triades forcées, pas de tirets enchaînés, pas de formules vides.

## Moteur de règles

Les règles vivent dans le catalogue Novahiz (`catalog/rules.json`). Ajouter une règle, c'est ajouter un pattern déterministe + sa sévérité + son message, sans toucher au pipeline des trois couches.
