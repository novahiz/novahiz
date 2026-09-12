---
name: novahiz-converge
description: |
  Étape 6 du pipeline Novahiz : fermer l'écart entre l'intention et le code.
  Construit l'inventaire d'intention (demande, plan, critères d'acceptation, étapes du
  registre, principes du projet), évalue l'état présent du code, classe chaque élément
  satisfait, partiel ou non satisfait, et ajoute les restes comme étapes tracées.
  En ajout seul : ne réécrit rien, ne supprime aucune étape, ne touche pas au code.
  Use at the end of an implementation, before declaring work done.
  Triggers on: "c'est fini ?", vérifier la feature, convergence, analyse d'écart,
  "qu'est-ce qui reste", clôture.
license: MIT
compatibility: opencode
---

# novahiz-converge : fermer l'écart

**Étape 6 sur 6** du pipeline. Elle tourne après l'implémentation, jamais pendant.

Étape précédente : `novahiz-implement`.

## Ne pas confondre avec l'audit

`novahiz-converge` mesure l'écart entre ce qui était demandé et ce que le code fait. `novahiz-audit` mesure la conformité de la session aux règles. Le premier porte sur le travail, le second sur la méthode.

## Source d'intention

L'intention vient des artefacts, pas de ta mémoire :

- la demande initiale,
- le plan,
- les critères d'acceptation des tâches,
- le registre d'exécution : `novahiz_task action="status"` et `action="signals"`,
- les principes du projet, à commencer par `AGENTS.md`.

Constitue l'inventaire : chaque élément identifié et traçable.

## Évaluation

Regarde l'état présent du code. Ce n'est pas un diff : ni git, ni branche, ni historique. Tu évalues ce que le code fait maintenant.

Classe chaque élément :

- **satisfait** : le code fait ce qui est demandé, et la preuve le montre.
- **partiel** : une partie tient, le reste manque ou ne se prouve pas.
- **non satisfait** : rien ne couvre l'élément.

Une étape fermée sans preuve ne compte pas comme satisfaite, même si le registre la dit `done`.

## Écriture en ajout seul

- La seule écriture autorisée est l'ajout des restes au registre, chacun devenant une étape traçable : `novahiz_task action="insert"`.
- Tu ne modifies ni le plan, ni les critères, ni les étapes existantes.
- Tu ne renommes, ne renumérotes, ne réordonnes et ne supprimes aucune étape.
- L'acceptation du reste ouvert se demande par l'outil `question` du harness : accepter le reste, le traiter maintenant, ou le tracer pour plus tard. Un reste non explicitement accepté garde la clôture ouverte.
- Tu ne touches pas au code applicatif.

Si tout est satisfait, tu ne touches à rien et tu rapportes un résultat propre. Un rapport vide n'est pas un résultat propre.

## Sévérité

La violation d'un principe MUST d'`AGENTS.md` est le niveau le plus haut et produit une étape de remédiation. Si les principes sont absents, tu le dis et tu continues.

## Clôture

Rapporte trois listes : ce qui est satisfait et prouvé, ce qui reste ouvert, ce qui n'a pas pu être évalué et pourquoi. Le travail est terminé quand la liste ouverte est vide, ou quand l'utilisateur accepte explicitement le reste.

## Catégories concernées

L'étape de convergence apparaît dans `code`, `debug`, `test`, `audit`, `browser`, `design-ui`, `database-supabase`, `docs-writing`, `planning`, `devops` et `data`.

## Pièges

- Déclarer satisfait ce qui n'a jamais été exécuté.
- Confondre « l'étape est cochée » et « le comportement existe ».
- Réécrire le plan pour qu'il colle au résultat obtenu.
