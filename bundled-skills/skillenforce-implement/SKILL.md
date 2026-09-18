---
name: skillenforce-implement
description: |
  Étape 5 du pipeline skillenforce : écrire le code par incréments qui laissent le système
  utilisable. Cycle implémenter, tester, vérifier, commit, tranche suivante.
  Règles de simplicité, de discipline de périmètre, de défauts sûrs et de réversibilité.
  Use when writing or changing code for an approved task.
  Triggers on: implémenter, coder, écrire le code, ajouter l'endpoint, construire le
  composant, appliquer le changement, faire passer le test.
license: MIT
compatibility: opencode
---

# skillenforce-implement : écrire par incréments propres

**Étape 5 sur 6** du pipeline. Tu écris ce que la tâche demande, ni plus ni moins.

Étape précédente : `skillenforce-analyse`. Étape suivante : `skillenforce-converge`.

## Cycle d'incrément

```
implémenter -> tester -> vérifier -> commit -> tranche suivante
```

Tu ne repars pas de zéro à chaque tranche. Chaque tranche laisse un système qui compile et dont les tests passent.

## Ouvre et ferme l'étape

```
skillenforce_task action="start" id="<todo>"
... travail ...
skillenforce_task action="done"  id="<todo>" proof="<commande et résultat>"
```

`done` sur une étape de nature `verify` exige la preuve. Sans preuve, l'étape reste ouverte.

## Choisir la première tranche

- Verticale par défaut : elle traverse les couches pour être observable de bout en bout.
- Contrat d'abord : fige types et interfaces, puis les deux côtés avancent en parallèle.
- Risque d'abord : prouve le morceau dont la réussite est la moins certaine.

## Le gate va se déclencher

Écrire du code fait tomber les règles : R1-code-prose exige `humanizer` dès que le contenu porte de la prose (commentaires, messages, libellés), R2 exige `impeccable` dès qu'un fichier de style est touché. Charge-les avant d'écrire, pas après le refus.

## Règles d'écriture

**Simplicité.** Quelle est la chose la plus simple qui puisse marcher ? Moins de lignes. Une abstraction doit gagner sa complexité. Trois lignes similaires valent mieux qu'une abstraction prématurée. Écris la version naïve et évidemment correcte, puis optimise après preuve par les tests.

**Périmètre.** Ne touche que ce que la tâche exige. Pas de nettoyage du code adjacent, pas de refactor d'imports d'autres fichiers, pas de suppression d'un commentaire non compris, pas de fonctionnalité hors périmètre. Ce que tu vois sans y toucher se note « vu mais non touché » et devient une proposition : `skillenforce_task action="insert"`, jamais une modification surprise.

**Une chose à la fois.** Pas de composant plus refactor plus configuration de build dans le même pas.

**Garder compilable.** Le build et les tests existants passent après chaque incrément.

**Défauts sûrs.** Nouveau comportement en opt-in, valeur conservatrice. Une option absente vaut faux.

**Réversible.** Changements additifs, modifications minimales, migration avec retour arrière, et jamais supprimer puis remplacer dans le même commit.

## Confirmer avant l'irréversible

Une action qui détruit de la donnée, casse une compatibilité ou ne se défait pas passe par l'outil `question` du harness avant d'être lancée. Les options sont concrètes : lancer, sauvegarder d'abord, renoncer. Une migration sans retour arrière et une suppression de données en font partie. Le feu vert se demande, il ne se suppose pas.

## Ne rien inventer

N'écris pas d'API, de fonction ou d'import dont tu n'as pas vérifié l'existence. Trois recours réels : le code lui-même, la documentation de la version installée via `context7`, et la skill `zero-hallucination-coder`. Un symbole supposé devient une dette immédiate.

## Quand la preuve est rouge

Corrige, ou bloque l'étape avec `skillenforce_task action="block"` et une raison. Tu ne masques pas un test en le désactivant, et tu ne contournes pas un échec par un bloc d'erreur silencieux.

## Catégories concernées

L'étape d'implémentation apparaît dans `code`, `debug`, `test`, `design-ui`, `database-supabase`, `devops` et `data`.

## Sortie

Chaque incrément produit les fichiers modifiés, la preuve exécutée et son résultat. Tu passes à `skillenforce-converge` quand les tranches sont terminées.
