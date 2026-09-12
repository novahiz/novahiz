---
name: novahiz-audit
description: |
  Audit de fin de session pour Novahiz. CATEGORY-AWARE : ne contrôle que les règles des
  catégories réellement rencontrées. S'appuie sur l'état vérifiable (registre d'exécution,
  journal du gate, skills chargées, diff de la session) et jamais sur la mémoire de l'agent.
  Use at the END of a session, or when the user says "audit" or "vérifie".
  Triggers on: "audit", "vérifie", fin de session, compliance check, ce qu'on a oublié.
license: MIT
compatibility: opencode
---

# novahiz-audit : contrôle de fin de session

Tu audites à partir de faits vérifiables. Une case cochée de mémoire ne vaut rien.

## Les 14 catégories réelles

code, debug, review, audit, test, research, browser, design-ui, database-supabase, docs-writing, planning, devops, data, general.

`general` est la catégorie de repli. Il n'y a pas de catégorie `trivial` dans le catalogue.

## Ce qui se vérifie vraiment

| Contrôle | Source de preuve | S'applique à |
|---|---|---|
| Plan et registre ouverts | `novahiz_task status` ou `todoread` | tout sauf research |
| Étapes de la catégorie parcourues | `novahiz_roadmap --category X` puis `novahiz_step` | tout sauf research et general |
| Skills requises chargées | journal du gate, table `enforcement_log` | tout |
| humanizer appliqué sur la prose | règles R1 déclenchées, ou skill chargée | docs-writing, code, audit, planning, design-ui |
| impeccable appliqué au style | règles R2 déclenchées, ou skill chargée | design-ui |
| Revue de code faite | étape `review` du roadmap, skill `code-reviewer` | code, review, debug |
| Scan de sécurité | étape `scan`, skill `security-guidance` | audit |
| Preuve sur les étapes de vérification | `novahiz_task` refuse `done` sans `proof` | tout |
| Mémoire à jour | `MEMORY.md` plus page vault, via `novahiz-memory` | tout sauf research |
| Aucune simulation | affirmations recoupées avec des sorties réelles | tout |

## Méthode

1. Récupère la catégorie primaire et les catégories rencontrées.
2. Pour chaque contrôle applicable, cherche la preuve. Pas de preuve, pas de validation.
3. Note `conforme`, `manquant` ou `non applicable`.
4. Score : conformes sur applicables, en pourcentage. Sous 70 %, propose des correctifs précis. À 90 % et plus, conclus « session conforme ».

## Sortie

Un rapport court dans la conversation :

```
## Audit de session
Catégories : code, test
| Contrôle | Statut | Preuve |
|---|---|---|
| Registre | conforme | 6 étapes, 1 bloquée |
| humanizer | conforme | chargée avant rédaction |
| Revue de code | manquant | étape review non exécutée |
Score : 67 %

## À corriger
- Lancer code-reviewer sur les fichiers modifiés

## À retenir
- ...
```

## Pièges

- Cocher une règle sans preuve.
- Inventer un journal de conformité, un fichier de session ou un script de validation : ils n'existent pas dans ce système.
- Auditer des catégories qui n'ont pas été rencontrées.
- Confondre absence de preuve et conformité.

## Suite

Ce qui se répare se répare tout de suite : relancer humanizer, lancer la revue, écrire la mémoire. Le reste est consigné pour la session suivante.
