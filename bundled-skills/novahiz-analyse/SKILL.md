---
name: novahiz-analyse
description: |
  Étape 4 du pipeline Novahiz : comprendre le code concerné avant de le modifier.
  Cinq phases ordonnées (reconnaissance, architecture, qualité, exploitation, synthèse),
  appuyées sur la carte du code quand elle est disponible. Chaque affirmation cite un
  chemin de fichier réel ; ce qui n'a pas pu être déterminé est dit explicitement.
  Use before touching unfamiliar code, before a refactor or a migration, or to locate a bug.
  Triggers on: "comprendre ce code", "où est", "qui appelle", carte du codebase,
  analyse d'impact, cause racine, point d'entrée.
license: MIT
compatibility: opencode
---

# novahiz-analyse : comprendre avant de modifier

**Étape 4 sur 6** du pipeline. L'analyse porte sur ce que la tâche exige, jamais sur tout le dépôt. Profondeur plutôt qu'exhaustivité.

Étape précédente : `novahiz-task`. Étape suivante : `novahiz-implement`.

## Appuie-toi sur la carte du code

Avant de lire au hasard : la skill `code-understand` construit une carte classée et citée, et le serveur `narsil` expose le graphe d'appels, les symboles, les références et les imports. Une question « qui appelle ça » se règle avec l'outil, pas en devinant.

## Phase 1 : reconnaissance

- Arborescence sur deux ou trois niveaux.
- Manifestes d'abord : package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml, build.gradle, Gemfile, csproj, Podfile, Package.swift.
- Build et CI : Makefile, Dockerfile, docker-compose, workflows, turbo.json, nx.json.
- Configs : tsconfig, eslint, modèle d'environnement, bundler, editorconfig.
- Docs : README, CONTRIBUTING, ARCHITECTURE, dossier docs.
- Langages, frameworks, présence d'un monorepo.

## Phase 2 : architecture

- Points d'entrée : main, index, server, routes, CLI, AppDelegate, activities.
- Suis jusqu'à cinq chemins critiques de bout en bout : route vers contrôleur vers service vers données vers réponse.
- Graphe de dépendances entre modules.
- Pattern dominant : monolithe, microservices, événementiel, hexagonale, MVC, CQRS.
- Couche données : schémas, migrations, ORM, modèles, cache.
- Surface d'API : REST, GraphQL, gRPC, WebSocket, IPC, contrats, authentification.

## Phase 3 : qualité

- Tests : structure, frameworks, unités, intégration, bout en bout, fixtures, mocks.
- Gestion d'erreurs et journalisation.
- Typage et validation à l'exécution.
- Posture de sécurité : authentification, autorisation, secrets, assainissement, vulnérabilités de dépendances.
- Cohérence des motifs, nommage, duplication.

## Phase 4 : exploitation

Build, CI/CD, modèle de déploiement, observabilité, gestion des environnements.

## Phase 5 : synthèse

Écris la synthèse après les phases précédentes, jamais avant. Chaque affirmation cite un chemin de fichier réel. Dis ce que tu n'as pas pu déterminer. Un schéma ASCII aide pour l'architecture.

Destination : le dossier de documentation du projet s'il en a un, sinon le registre d'exécution. Tu n'inventes pas `docs/analysis/` dans un projet qui n'a aucune convention de ce genre.

## Six catégories réclament cette étape

`code`, `debug`, `review`, `database-supabase`, `devops` et `data`.

## Règles

- Lire avant d'écrire.
- Ignorer le code généré, vendoré et le boilerplate.
- Ne pas redocumenter tout le dépôt à chaque tâche : cible le périmètre utile.
- Une observation sans chemin de fichier ne vaut rien.

## Sortie

Les fichiers et symboles qui portent la logique, les chemins de données, les points d'extension, et la liste explicite des inconnues restantes. Cette sortie alimente `novahiz-implement`.
