---
name: memory-save
description: >
  Sauvegarder proprement un contenu dans le vault Obsidian de l'utilisateur en
  choisissant TOUJOURS le bon dossier via la table de routage. Utilise cette skill
  quand l'utilisateur demande "met à jour ma mémoire", "sauvegarde ceci/cela", "note
  ça dans obsidian", "enregistre cette note", "mémorise", "save to memory", "add to
  my obsidian", "où va cette note", ou veut classer un nouveau contenu (dev, formation,
  trading) dans son vault. Garantit le respect de _meta/routing.md et _meta/taxonomy.md.
---

# memory-save — Sauvegarder dans le vault Obsidian

Tu écris une page (ou quelques pages) dans le vault Obsidian de l'utilisateur à la **bonne place**.
Tu ne devines jamais : tu suis la table de routage `_meta/routing.md`. En cas de doute, tu demandes.

## Résolution du chemin du vault

`OBSIDIAN_VAULT_PATH` : vault unique connu = `C:\Users\hiz\Documents\novahiz`.
Si un autre chemin est fourni (`@nom`), vérifie qu'il existe avant tout.

## Procédure obligatoire (dans l'ordre)

### 1. Résoudre la config
- Lire `_meta/routing.md` et `_meta/taxonomy.md` dans le vault (ils sont la source de vérité).
- Vérifier que le vault et `_meta/routing.md` existent. Sinon : prévenir l'utilisateur, ne rien écrire.

### 2. Classifier le contenu : domaine + type
- **Domaine** : `dev` · `formation` · `trading` · `général` (hors domaine).
- Pour `dev`, déduire la sous-stack à partir du contenu :
  - React / Next / Vue / JS / browser → `web`
  - Flutter / React Native / Swift / Kotlin / Android / iOS → `mobile`
  - Electron / Tauri / .NET / WPF / SwiftUI / Qt → `desktop`
  - Backend / API / infra générique → laisser au niveau global (`skills/` ou `references/`)
- **Type de contenu** : raw source · note temporelle · how-to/skill · reference · concept ·
  entity · synthesis · project · activité domaine (cours / TP / support / client · analyse /
  stratégie / risque / économie).
- Si l'un des deux axes est ambigu **ou** que deux dossiers sont plausibles : **demander à
  l'utilisateur** (question à choix). Ne pas choisir au hasard.

### 3. Afficher le chemin choisi AVANT d'écrire
Toujours afficher, sous forme de bloc :

```
→ C:\Users\hiz\Documents\novahiz\<dossier>\<titre-si-pertinent>.md
```

Si l'utilisateur a demandé une sauvegarde directe et que le classement est évident (table sans
ambiguïté), écrire immédiatement après l'affichage. Si le contenu touche à plusieurs domaines,
proposer (a) de découper, (b) de choisir un dossier principal, (c) une page synthesis.

### 4. Respecter les garde-fous
- **Ne PAS écrire** dans : `index.md`, `log.md`, `hot.md`, `.manifest.json`, `.obsidian/`, `_meta/`. Ces fichiers sont **réservés aux skills de maintenance** (wiki-ingest, wiki-update, wiki-lint, wiki-status, cross-linker, graph-colorize) qui gèrent le journal et le graph. `memory-save` enregistre uniquement la page de contenu, jamais de traces ailleurs.
- **Ne PAS créer de dossier racine**. Si la table ne couvre pas le sujet → demander ; si nécessaire,
  créer l'entrée dans `routing.md` avec l'accord explicite de l'utilisateur.
- Vérifier que le dossier cible existe. S'il manque, prévenir (ne pas recréer en silence).

### 5. Écrire avec le format vault (frontmatter ar9av)
Frontmatter obligatoire (YAML) :

```yaml
---
title: <titre concis>
category: <concept|entity|skill|reference|synthesis|journal|project|meta|raw>
tags: [<domaine/...>, <type/...>, depuis _meta/taxonomy.md]
sources: [<lien ou nom de la source d'origine si applicable>]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
summary: <1–2 phrases>
---
```

- `category` reflète le **type de page** (les mêmes catégories que `llm-wiki`) : `concept|entity|skill|reference|synthesis|journal|project|meta|raw`. Pas le domaine — le domaine vit dans `tags`.
- `tags` : le **domaine** (`dev/...`, `formation/...`, `trading/...`) plus un `type/...` (cross-domaine) depuis `_meta/taxonomy.md`. Exemple : une note de stratégie forex → `tags: [trading/strategy, type/concept]`.
- Corps de la note : contenu utile + `[[wikilinks]]` vers les pages liées existantes
  (ou à créer). Si une page proche existe déjà, **fusionner ou lier** plutôt que dupliquer.
- Ne pas donner de trace ailleurs qu'à l'étape 6.

### 6. Rendre compte (court)
Confirmer le dossier choisi + le fichier écrit + un rappel si une page existante a été mise à jour.

## Cas particuliers

- **Source brute** (article/PDF/page/export chat non encore traité) → `_raw/`. Ne pas distiller dans le corps ; la distillation est du ressort de `wiki-ingest`.
- **Note temporelle / daily / session / trade daté** → `journal/`. Pour un trade forex précis, entrée dans `journal/` datée (tags `trading/forex`, `trading/analyse`) et le détail d'analyse complet dans `areas/trading/analyse` si volumineux.
- **Projet / repo de code** → `projects/<nom>.md` (ou via `wiki-update`).
- **« Où va cette note ? »** → répondre avec la ligne de la table concernée, sans écrire.
- **Contraire (annuler une sauvegarde erronée)** → indiquer le fichier écrit et le déplacer avec accord.