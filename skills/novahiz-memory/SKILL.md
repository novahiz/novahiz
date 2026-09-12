---
name: novahiz-memory
description: |
  Mémoire de projet Novahiz : écriture double, dans le MEMORY.md du projet et dans une page
  du vault Obsidian. La destination se déduit uniquement de la table de routage
  _meta/routing.md. Frontmatter obligatoire, wikilinks, fusion plutôt que duplication.
  Use when a complex task ends, when the user says "mets à jour la mémoire" or "sauvegarde",
  or when a decision, une cause de bug ou une prochaine étape doit survivre à la session.
  Triggers on: "mémoire", "MEMORY.md", obsidian, vault, sauvegarde, "note ça", routing.
license: MIT
compatibility: opencode
allowed-tools:
  - todoread
  - Read
  - Glob
  - Grep
---

# novahiz-memory : mémoire double

Une session se termine par une trace. Deux écritures, jamais une seule.

## Où

| Support | Chemin |
|---|---|
| Projet | `MEMORY.md` à la racine du projet courant |
| Vault | `C:\Users\hiz\Documents\novahiz`, dossier déduit de `_meta\routing.md` |

`_meta\routing.md` est la seule source de vérité pour le dossier cible. Aucune devinette : si le routage est ambigu, tu demandes.

La procédure détaillée vit dans la skill `memory-save`. Charge-la et suis-la plutôt que d'écrire à main levée.

## Interdits

- Écrire dans `index.md`, `log.md`, `hot.md`, `.manifest.json`, `_meta\` ou `.obsidian\`. Ces fichiers appartiennent aux skills de maintenance.
- Créer un dossier racine de ta propre initiative.
- Deviner la destination.

## Contenu attendu

1. Ce qui fonctionne.
2. Ce qui a changé, avec les fichiers clés.
3. Ce qui reste ouvert : prochaine étape, dette technique, blocages.

## Frontmatter obligatoire

```
title, category, tags, sources, created, updated, summary
```

Les tags viennent de `_meta\taxonomy.md`. La page se lie avec des `[[wikilinks]]`. Quand le sujet existe déjà, tu enrichis la page existante au lieu d'en créer une seconde.

## Avant d'écrire

Affiche le chemin retenu. Une écriture annoncée est une écriture vérifiable.

## Pièges

- Écrire la même chose dans deux pages au lieu d'enrichir la première.
- Recopier le déroulé de la session au lieu de distiller les décisions.
- Mettre à jour le vault et oublier le `MEMORY.md` du projet.
- Toucher aux fichiers de maintenance depuis cette skill.
