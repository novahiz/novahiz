---
name: novahiz-skill-craft
description: |
  Créer, modifier, évaluer et améliorer tout skill dans l'écosystème Novahiz.
  Déclenché obligatoirement avant toute création ou modification de SKILL.md.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
---

# novahiz-skill-craft

Le point d'entrée obligatoire pour créer ou modifier tout skill Novahiz.

## Pourquoi un skill séparé

Un skill qui crée des skills doit être plus rigoureux que ceux qu'il produit.
Il doit connaître : le frontmatter YAML strict, la disclosure progressive,
le gate (novahiz_gate), le pipeline Novahiz (6 étapes), les 17 catégories,
le ledger (novahiz_task) avec preuves obligatoires, et la mémoire avec rotation.

## Les 4 phases du cycle de vie

Chaque phase correspond à un mode : Création, Évaluation, Amélioration, Audit.

---

## Phase 1 : Créer un nouveau skill (mode Création)

Quand : l'utilisateur demande un skill qui n'existe pas.

Workflow (pipeline Novahiz intégré) :

1. Plan (`novahiz-plan`) : objectif, déclencheurs, format de sortie, type d'évaluation.
2. Clarification (`novahiz-clarify`) : 10 familles de risques (portée, données, flux, qualité, intégrations, limites, contraintes, terminologie, signaux, remplissage).
3. Tâches (`novahiz-task`) : tâches atomiques avec objectif, critères, preuve, dépendances, fichiers, taille.
4. Analyse (`novahiz-analyse`) : lire le projet, vérifier la duplication, noter les conventions.
5. Implémentation (`novahiz-implement`) : écrire le SKILL.md et ses ressources, un incrément à la fois.
6. Convergence (`novahiz-converge`) : comparer le résultat à l'intention ; classer satisfait/partiel/non satisfait.

Le gate (`novahiz_gate`) doit être appelé après chaque modification du SKILL.md. Le skill s'arrête sur tout blocage et le signale.

### Frontmatter (contrat strict)

Le frontmatter YAML doit contenir au minimum :

```yaml
---
name: nom-en-kebab-case  # ≤64 caractères, [a-z0-9-], pas de tiret au début/fin
description: Ce que le skill fait ET quand il se déclenche. ≤1024 caractères. Pas de balises XML (< >).
license: Apache-2.0
compatibility: opencode
metadata:
  author: ...
  version: "x.y.z"
---
```

Règles : la description est le routeur principal. Si le skill ne déclenche pas, corriger la description d'abord (95 % des cas). Le corps doit rester sous 500 lignes ; au-delà, déplacer dans `references/` avec des pointeurs explicites.

Le script `scripts/validate-frontmatter.py` vérifie tout cela automatiquement.

---

## Phase 2 : Évaluer un skill (mode Évaluation)

Quand : le skill existe et doit être testé.

Workflow d'évaluation :

1. Définir les evals (`evals.json`) : prompt, résultat attendu, fichiers d'entrée optionnels, attentes vérifiables.
2. Exécuter (`scripts/run-eval.py`) : lancer chaque prompt contre le skill ; enregistrer le transcript complet.
3. Noter (`scripts/generate-grading.py`) : PASS / FAIL / PARTIAL avec preuves (citation du transcript).
4. Analyser la variance (`scripts/generate-comparison.py`) : comparer A/B de manière aveugle ; la meilleure version devient `current_best` dans `history.json`.

Le format `evals.json` (voir `references/schemas.md`) est obligatoire. Chaque itération est tracée dans `history.json` (version, parent, taux de réussite, résultat `baseline`/`won`/`lost`/`tie`, `is_current_best`).

---

## Phase 3 : Améliorer un skill (mode Amélioration)

Quand : le skill a échoué à un ou plusieurs tests d'évaluation.

Cycle itératif (chaque boucle) :

```
Écrire la correction → Valider le gate → Exécuter les evals → Noter le résultat → Décider
```

À chaque itération :
- Si le taux de réussite augmente et dépasse le `current_best` → la nouvelle version devient `current_best`.
- Si égal → `tie` (choix de l'utilisateur).
- Si diminue → `lost` (revenir au `current_best` ou continuer).

Ne pas réécrire tout le skill. Identifier la source du problème :
- Description qui ne déclenche pas → corriger le frontmatter.
- Workflow incomplet → ajouter une étape ou un script.
- Instructions ambiguës → clarifier avec des exemples concrets.
- Script qui échoue → corriger le script, pas le SKILL.md.

Le principe de manque de surprise s'applique : le contenu doit correspondre à l'intention décrite. Ne pas créer de skills trompeurs, ni de code exploitant, ni de contenu qui facilite un accès non autorisé.

---

## Phase 4 : Auditer un skill (mode Audit)

Quand : le skill semble terminé. Avant livraison, il doit passer l'audit complet.

Workflow d'audit (6 vérifications) :

1. **Audit du gate** : le SKILL.md passe `novahiz_gate` dans toutes les catégories requises.
2. **Audit de structure** : `name` = dossier (kebab-case, ≤64) ; `description` = action + déclencheurs ; corps ≤500 lignes (ou divisé proprement) ; références au niveau 1.
3. **Audit de contenu** : instructions impératives ; exemples concrets ; formats de sortie définis ; erreurs gérées ; sources et contraintes visibles.
4. **Audit d'évaluation** : au moins 3 evals (ou justification) ; attentes significatives (pas triviales) ; comparateur aveugle utilisé.
5. **Audit de mémoire** : décision persistée (`memory_write`) ; citation de source (`novahiz-docs/<library>@<version>`) ; cohérence mémoire/code.
6. **Audit de sécurité** : aucun secret, clé, jeton dans SKILL.md ou scripts ; aucun chemin absolu machine ; aucun code caché ou obfusqué.

Checklist d'expédition (tous les éléments doivent être cochés) :
- [ ] `name` correspond au dossier, kebab-case
- [ ] `description` : action + déclencheurs + différenciateur ; ≤1024 caractères ; sans balises XML
- [ ] Corps ≤500 lignes ou divisé proprement avec pointeurs
- [ ] Références au niveau 1, liées avec des pointeurs explicites
- [ ] Scripts exécutables, erreurs actionnables, aide intégrée (`--help`)
- [ ] Pas de secrets, pas de chemins absolus, pas de bombes temporelles
- [ ] Humanizer passé (si design frontend — R13)
- [ ] Test de déclenchement implicite + exécution explicite (`skill-eval-loop`)
- [ ] Versionné avec le dépôt
- [ ] Mémoire cohérente et citée

Le skill est terminé quand il peut produire un autre skill de qualité équivalente, testé, audité et documenté, sans intervention manuelle au-delà des décisions stratégiques.

---

## Intégration avec le système Novahiz

### Le gate (`novahiz_gate`)

Le skill appelle le gate automatiquement après chaque modification du SKILL.md. Si le gate bloque : corriger, réessayer. Ne jamais ignorer un blocage. Le gate est un filet de sécurité, pas un obstacle.

### Le pipeline (`novahiz-planner`)

Le pipeline 6 étapes est intégré :

| Étape | Skill | Produit | Fermeture |
| 1. Plan | `novahiz-plan` | Direction, portée, dépendances | Plan validé par l'utilisateur |
| 2. Clarification | `novahiz-clarify` | Décisions verrouillées | Plus d'ambiguïté qui changerait l'architecture |
| 3. Tâches | `novahiz-task` | Tâches atomiques avec critères | Chaque tâche a ses critères et preuves |
| 4. Analyse | `novahiz-analyse` | Fichiers, symboles, inconnus nommés | Portée utile comprise |
| 5. Implémentation | `novahiz-implement` | Incréments utilisables | Slices terminés et verts |
| 6. Convergence | `novahiz-converge` | Écart entre intention et code | Liste ouverte vide ou acceptée explicitement |

### Les 17 catégories

Le skill applique le bon pipeline selon la catégorie du projet : `code`, `flutter`, `expo`, `debug`, `browser`, `design-ui`, `database-supabase`, `devops`, `data`, `test`, `review`, `audit`, `test`, `research`, `general`. Chaque catégorie a ses exigences spécifiques.

### Le ledger (`novahiz_task`)

Le skill crée et met à jour le ledger automatiquement : `new` au début, `plan` après le plan, `start`/`done` pour chaque tâche (avec `proof` obligatoire pour `verify`), `insert` pour les restes, `block` si obstacle. Sans preuve, l'étape reste ouverte.

### La mémoire (`novahiz-memory`)

Le skill persiste les décisions clés : format compact (pas d'extrait de document complet), citation obligatoire (`novahiz-docs/<library>@<version>`), fusion plutôt que duplication, rotation automatique au-delà de 8000 caractères / 200 lignes. La cohérence mémoire/code est vérifiée avant livraison.

---

## Communication avec l'utilisateur

Le niveau technique de l'utilisateur varie. Adapter le langage :

- Utilisateur non technique : expliquer brièvement (`JSON`, `assertion`, `benchmark`, `gate`) avant d'utiliser le terme sans explication.
- Utilisateur expérimenté : utiliser le vocabulaire technique directement.
- Toujours proposer l'option recommandée avec `(Recommandé)`.
- Toujours rappeler brièvement les concepts clés du système Novahiz au besoin.

Le principe de manque de surprise : le contenu du skill doit correspondre à son intention décrite. Pas de skills trompeurs, pas de code exploitant, pas d'accès non autorisé facilité.

---

## Scripts disponibles (`scripts/`)

Tous les scripts produisent un résultat structuré et ont une aide intégrée (`--help`) :

- `scripts/validate-frontmatter.py` : validation du YAML frontmatter (nom, description, secrets, chemins absolus, balises XML)
- `scripts/scan-skill.py` : analyse de la structure du dossier de skill (fichiers manquants, tailles, références)
- `scripts/extract-description.py` : extraction et analyse de la description (longueur, déclencheurs, différenciateurs, spécificité)
- `scripts/run-eval.py` : exécution d'un prompt contre un skill (produit transcript + métriques)
- `scripts/generate-grading.py` : comparaison d'un transcript avec des attentes (produit `grading.json`)
- `scripts/generate-comparison.py` : comparaison aveugle A/B (produit `comparison.json`)
- `scripts/check-memory.py` : cohérence de la mémoire avec le code actuel (vérifie citations et versions)

---

## Références (`references/`)

Chaque fichier de référence a une table des matières si >300 lignes :

- `references/frontmatter-spec.md` : spécification complète du frontmatter, règles de validation, erreurs courantes et leurs corrections
- `references/evals-spec.md` : format `evals.json`, `history.json`, `grading.json`, `comparison.json` avec exemples
- `references/progressive-disclosure.md` : le modèle 3 niveaux, comment diviser un skill, comment pointer vers les références
- `references/schemas.md` : schémas JSON complets pour tous les fichiers d'évaluation et de suivi

---

## Assets (`assets/`)

Templates prêts à l'emploi :

- `assets/skill-template.md` : modèle du SKILL.md avec toutes les sections obligatoires
- `assets/evals-template.json` : modèle des évaluations avec un exemple complet
- `assets/frontmatter-checklist.md` : checklist rapide du frontmatter (10 points)
