---
name: novahiz-planner
description: |
  Orchestrateur du pipeline Novahiz. CATEGORY-AWARE et BLOQUANT : aucun travail non
  trivial ne commence sans plan écrit.
  Le pipeline suit six étapes dans l'ordre : plan, clarification, tâches, analyse,
  implémentation, convergence. Chaque étape a sa skill dédiée.
  Use at the START of any request with 3+ steps, several files, or an unclear scope.
  Triggers on: multi-step tasks, feature implementation, refactoring, debugging sessions,
  migrations, architecture work, "plan this", "break this down", "where do I start".
license: MIT
compatibility: opencode
---

# novahiz-planner : orchestrateur du pipeline

Tu ouvres le travail. Toute tâche non triviale suit la même séquence.

## Loi d'entrée

```
SI la catégorie n'est ni research ni general ET qu'aucune tâche n'est ouverte :
  -> ARRÊT. Aucune édition, aucune commande.
  -> Ouvre le pipeline, puis exécute.
```

## Le pipeline

| # | Étape | Skill | Produit | Ferme quand | Écrit ? |
|---|---|---|---|---|---|
| 1 | Plan | `novahiz-plan` | direction, périmètre, ordre de dépendances, stratégie de découpage, risques | le plan tient et l'utilisateur l'a vu | non |
| 2 | Clarification | `novahiz-clarify` | familles d'ambiguïté, salves de questions, décisions figées | les éléments ouverts ne changent plus ni architecture, ni données, ni tâches, ni tests, ni UX, ni exploitation | non |
| 3 | Tâches | `novahiz-task` | tâches atomiques avec critères d'acceptation et preuve | chaque tâche a un critère et une preuve, et l'ordre tient | registre seul |
| 4 | Analyse | `novahiz-analyse` | fichiers, symboles, chemins de données, inconnues | le périmètre utile est compris et les inconnues nommées | non |
| 5 | Implémentation | `novahiz-implement` | incréments qui gardent le système utilisable | les tranches sont terminées et vertes | oui |
| 6 | Convergence | `novahiz-converge` | inventaire d'intention, écart classé, restes tracés | la liste ouverte est vide ou explicitement acceptée | registre seul |

Deux retours en arrière prévus : la clarification renvoie au plan quand une réponse change l'architecture ; la convergence renvoie aux tâches quand un reste apparaît.

## Ce que le gate applique vraiment

Le gate (voir `novahiz-gate`) ne bloque que sur les étapes de type `skill`. Dans le roadmap `code`, ce sont `novahiz-plan`, `novahiz-clarify`, `novahiz-task`, `novahiz-analyse` et `code-reviewer`. Les étapes `implement` et `converge` figurent dans `requiredSkills` mais ne refusent aucune édition.

Conséquence pratique : si l'implémentation ou la convergence n'ont pas lieu, rien ne s'y oppose mécaniquement. Le pipeline tient donc aussi parce qu'il est suivi, pas seulement parce qu'il est programmé.

## Lecture seule

Les étapes 1, 2 et 4 ne modifient aucun fichier. L'étape 3 n'écrit que dans le registre d'exécution. L'écriture de code commence à l'étape 5.

## Les 14 catégories

code, debug, review, audit, test, research, browser, design-ui, database-supabase, docs-writing, planning, devops, data, general.

Le pipeline complet s'applique à `code`, `debug`, `browser`, `design-ui`, `database-supabase`, `planning`, `devops` et `data`. `review`, `audit` et `test` gardent leurs étapes métier et se terminent par une convergence. `research` et `general` n'imposent aucune étape.

## Étapes annexes selon la catégorie

| Catégorie | Pipeline 1 à 6 | Code review | Mémoire | Audit | Next steps |
|---|---|---|---|---|---|
| `code` | oui | oui | oui | oui | oui |
| `debug` | oui | oui | oui | oui | oui |
| `database-supabase` | oui | oui | oui | oui | oui |
| `browser` | oui | non | oui | oui | oui |
| `design-ui` | oui | non | oui | oui | oui |
| `planning` | oui | non | oui | oui | oui |
| `devops` | oui | non | oui | oui | oui |
| `data` | oui | non | oui | oui | oui |
| `review` | étapes métier | oui | oui | oui | oui |
| `audit` | étapes métier | non | oui | oui | oui |
| `test` | étapes métier | non | oui | oui | oui |
| `docs-writing` | non | non | oui | oui | oui |
| `research` | non | non | non | non | oui |
| `general` | non | non | oui | oui | oui |

## Règles transverses

- **Choix par l'interface** : toute décision posée à l'utilisateur passe par l'outil `question` du harness. Tableau interactif, options décrites par leur conséquence, option recommandée en tête. Aucune question et aucune demande de confirmation en prose dans le chat. Le chat porte le contexte et le contenu, l'interface porte les choix.
- **humanizer** sur toute prose : textes, documentation, messages d'interface, commentaires.
- **impeccable** sur tout ce qui touche le style visuel.
- **Skills Supabase** (`supabase`, `supabase-postgres-best-practices`) sur la catégorie `database-supabase`.
- **Honnêteté** : aucune exécution affirmée sans sortie réelle. Une incertitude se dit.
- **Critique** : une demande incohérente, ambiguë, risquée ou sous-optimale se contredit, avec une alternative.
- **Suite** : à la fin, une prochaine étape utile est proposée, même si c'est de ne rien faire.
- **Mémoire** : la fin d'une tâche complexe passe par `novahiz-memory`.

## Comportement bloquant

Quand aucune tâche n'est ouverte et que la catégorie n'est ni `research` ni `general` :

1. ARRÊT : aucune édition, aucune commande.
2. ANALYSE : `novahiz_classify` puis `novahiz_roadmap` donnent la catégorie et les étapes.
3. PIPELINE : ouvre les étapes dans l'ordre, en commençant par le plan.
4. ÉCRIS : `novahiz_task action="new"` puis `action="plan"`, et `todowrite` pour le suivi visible.
5. PRÉSENTE : pour une tâche complexe, montre le plan avant d'exécuter.
6. EXÉCUTE : une seule étape `in_progress`, mise à jour en temps réel, `done` seulement avec preuve.
7. CLÔTURE : `novahiz-converge`, puis `novahiz-audit`.

## Dérogation utilisateur

Si l'utilisateur dit « fais-le sans plan » ou « pas besoin de plan » :

1. crée une tâche minimale d'une étape ;
2. préviens : « Plan minimal créé. Les prochaines tâches recevront un plan complet. » ;
3. garde la dérogation visible pour l'audit.
