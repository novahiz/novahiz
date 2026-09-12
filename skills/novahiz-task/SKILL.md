---
name: novahiz-task
description: |
  Étape 3 du pipeline Novahiz : convertir un plan en tâches atomiques, ordonnées et
  vérifiables. Chaque tâche porte un objectif, des critères d'acceptation testables, une
  preuve, ses dépendances, les fichiers qu'elle possède et sa taille (XS à XL).
  Use when a plan must become an ordered task list, or when work must be split across
  sessions or agents.
  Triggers on: "découpe", liste de tâches, todo, sous-tâches, critères d'acceptation,
  priorisation, "par quoi je commence".
license: MIT
compatibility: opencode
allowed-tools:
  - todowrite
  - todoread
  - Read
  - Grep
  - Glob
  - novahiz_task
  - question
---

# novahiz-task : découper en tâches vérifiables

**Étape 3 sur 6** du pipeline. Le plan dit où l'on va ; cette étape dit par quels pas, dans quel ordre, et comment chaque pas se ferme.

Étape précédente : `novahiz-clarify`. Étape suivante : `novahiz-analyse`.

## Contrat de tâche

Toutes les tâches prennent la même forme. Une tâche sans critère d'acceptation et sans preuve reste une intention.

```markdown
## Tâche N : <titre court, à l'impératif>

Objectif : une phrase.
Critères d'acceptation :
- [ ] condition testable
- [ ] condition testable
Preuve : la commande, le test ou l'observation qui ferme la tâche
Dépend de : #A, #B (ou Aucune)
Fichiers concernés : chemin/a, chemin/b
Taille : XS | S | M | L | XL
```

## Le registre refuse une étape `verify` sans preuve

`novahiz_task` applique cette règle : une étape de nature `verify` ne se ferme pas sans `proof`. La preuve se décide donc au moment du plan, pas au moment du doute.

| Action | Usage |
|---|---|
| `plan` | déposer la liste complète d'un coup |
| `todo` | ajouter une étape (`kind` : read, edit, verify, delegate) |
| `start` / `done` | ouvrir, fermer (`done` exige `proof` sur une étape verify) |
| `block` | bloquer, avec `reason` |
| `review` | réviser le plan entre deux étapes |
| `amend` / `insert` / `drop` / `reorder` | corriger la liste sans la réécrire |
| `signals` / `status` / `resume` | relire l'état |

## Taille

| Taille | Fichiers | Exemple |
|---|---|---|
| XS | 1 | ajouter une règle de validation |
| S | 1 à 2 | un endpoint |
| M | 3 à 5 | un parcours complet |
| L | 5 à 8 | fonctionnalité touchant plusieurs composants |
| XL | 8 et plus | à redécouper, sans exception |

Redécoupe encore si le travail dépasse une session suivie, si les critères ne tiennent pas en trois puces, si deux sous-systèmes indépendants sont touchés, ou si le titre contient « et ». Ce « et » signale deux tâches collées.

## Ordre

- Les dépendances d'abord.
- Chaque tâche laisse le système fonctionnel.
- Les tâches risquées passent tôt : échouer vite coûte moins cher.
- Un point de contrôle tous les deux ou trois pas. Il sert à prouver, puis à décider de continuer, corriger ou abandonner.

## Catégories qui exigent cette étape

`code`, `browser`, `design-ui` et `planning`.

## Discipline

- Une seule étape `in_progress` à la fois.
- Mise à jour en temps réel, pas de complétion groupée.
- `completed` seulement après vérification, jamais sur intention.
- Une étape bloquée reste `in_progress` et une tâche de suivi décrit le blocage.
- Le vocabulaire de l'utilisateur est repris tel quel : commandes, options, arguments, ordre.

## Conflit de plan

Avant d'écrire, regarde s'il existe un plan encore ouvert. Même travail : mise à jour en place. Travail différent : arrêt, et tu poses la décision dans l'outil `question` du harness (reprendre, remplacer, créer à côté), jamais en prose. Tu ne supprimes, n'écrases et ne renommes jamais un plan ouvert de ta propre initiative.

## Rationnalisations

| Rationnalisation | Réalité |
|---|---|
| « je verrai en avançant » | c'est ainsi qu'on obtient un enchevêtrement et du travail refait |
| « les tâches sont évidentes » | écris-les : l'écrit révèle les dépendances et les cas limites oubliés |
| « planifier, c'est du temps perdu » | la planification fait partie du travail |
| « je garde tout en tête » | la fenêtre de contexte est finie, un plan écrit traverse les sessions |
| « l'ancien plan est périmé » | les tâches non cochées portent un état qui n'existe nulle part ailleurs |

## Drapeaux rouges

- implémentation lancée sans liste de tâches
- tâche « implémenter la fonctionnalité » sans critère d'acceptation
- plan sans étape de vérification
- toutes les tâches en XL
- aucun point de contrôle
- ordre de dépendance ignoré
- plan écrasé sans confirmation
