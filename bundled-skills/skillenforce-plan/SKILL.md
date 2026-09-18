---
name: skillenforce-plan
description: |
  Étape 1 du pipeline skillenforce : décider la direction avant d'écrire du code.
  Phase en lecture seule qui produit un plan : définition du « terminé », périmètre,
  approche retenue, ordre de dépendances, stratégie de découpage, risques, positions des
  points de contrôle.
  Use when starting a feature, a refactor, a migration, or any change that spans several
  files or whose approach is not obvious.
  Triggers on: "plan this", "comment aborder", "par où commencer", feature, architecture,
  migration, refactoring, changement multi-fichiers.
license: MIT
compatibility: opencode
---

# skillenforce-plan : décider la direction

**Étape 1 sur 6** du pipeline `skillenforce-planner`. Aucun fichier applicatif n'est modifié ici. Le livrable est un plan.

Étapes suivantes : `skillenforce-clarify`, puis `skillenforce-task`.

## Entrée

La demande est classée. Rien n'a encore été écrit.

## Ouvre le registre

Le plan se trace dans le registre d'exécution, pas dans une note locale :

```
skillenforce_task action="new"  title="<la demande en une phrase>"
skillenforce_task action="plan" todos=[...]
```

`todowrite` donne le suivi visible, `skillenforce_task` le registre durable qui survit à la compaction.

## Ce que le plan contient

- **Terminé, c'est quoi** : une phrase qui décrit l'état final observable.
- **Périmètre** : ce qui entre, ce qui reste dehors.
- **Approche retenue** : la décision, plus les options écartées avec leur raison.
- **Ordre de dépendances** : ce qui doit exister avant quoi.
- **Stratégie de découpage** : verticale par défaut, contrat d'abord si une interface est partagée, risque d'abord si une inconnue domine.
- **Risques** : impact et parade.
- **Positions des points de contrôle**.

## Lecture seule

Lis le code concerné, les manifestes, les conventions en place. Tu n'écris pas de code pendant cette phase, et tu ne « prépares » pas le terrain par des modifications anodines. Un plan se juge sur les réécritures qu'il évite.

## Ordre d'implémentation

Le graphe de dépendances se remonte : fondations, puis surface. Une API écrite avant son schéma se réécrit, un écran écrit avant son API se jette.

## Stratégies de découpage

**Verticale (défaut).** Une tranche traverse les couches nécessaires pour être observable de bout en bout. Livrer toute la base, puis toute l'API, puis tout l'écran laisse trois chantiers inutilisables.

**Contrat d'abord.** Quand plusieurs consommateurs partagent une interface : fige les types et les signatures, puis parallélise les deux côtés.

**Risque d'abord.** Quand une inconnue domine le reste : prouve le morceau dont la réussite est la moins certaine avant d'investir ailleurs.

## Huit catégories réclament cette étape

Le gate exige `skillenforce-plan` pour `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops` et `data`.

## Validation avant d'exécuter

Un plan complexe ne part pas en exécution sur un accord supposé. Tu portes la décision structurante dans l'outil `question` du harness :

```
question({
  questions: [
    {
      header: "Valider le plan",
      question: "Le plan tient-il ? <resume en une phrase>",
      options: [
        { label: "Valider et executer (Recommandé)", description: "<ce qui demarre tout de suite>" },
        { label: "Ajuster le perimetre", description: "<ce qui serait retire ou ajoute>" },
        { label: "Renoncer", description: "rien n'est ecrit" }
      ]
    }
  ]
})
```

Le contenu du plan vit dans le chat. La question de validation vit dans l'interface. Tu ne remplaces jamais l'un par l'autre.

## Passage à l'étape suivante

Si des choix restent ouverts sur l'architecture, les données, le périmètre ou les tests, va d'abord à `skillenforce-clarify`. Sinon, `skillenforce-task` convertit le plan en tâches atomiques.

## Garde-fous

- Commence par la cible et la contrainte, pas par les fichiers.
- Un plan sans ordre de dépendances reste une intention.
- Ne remplace jamais un plan encore ouvert : même travail, mise à jour en place ; travail différent, arrêt et question.
- Un plan dont toutes les tranches sont XL n'est pas un plan.
- Un plan sans point de contrôle ne dit pas quand s'arrêter.
- Ne promets rien que tu n'aies vérifié. Une direction annoncée sans lecture du code est une supposition.
