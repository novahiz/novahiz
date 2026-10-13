---
name: novahiz-skill-craft
description: |
  Créer, modifier, évaluer et améliorer tout skill dans l'écosystème Novahiz, avec le contrat strict du registre Novahiz. Déclenché obligatoirement avant toute création ou modification de SKILL.md, de evals.json de skill, ou de script de skills/. À ne pas confondre avec skill-authoring (contrat générique d'un SKILL.md) ni skill-eval-loop (mesure de l'aide apportée à l'agent) : celui-ci porte le pipeline Novahiz, le gate R18 et les scripts de vérification. Ne pas utiliser pour modifier une skill tierce non Novahiz sans son contrat.
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

1. Définir les evals (`evals.json`) : prompt, résultat attendu, attentes vérifiables (`contains:`, `regex:`, `file_exists:`...).
2. **Produire les transcripts** : c'est vous qui lancez chaque prompt dans votre session d'agent. **Aucun script de ce skill n'invoque un modèle** — voir `scripts/run-eval.py`.
3. Mesurer et archiver (`scripts/run-eval.py --transcript F --record`) : métriques du transcript, copie sous `evals/runs/`. Ce script ne juge **pas** la réussite.
4. Noter (`scripts/generate-grading.py`) : chaque attente PASS/FAIL avec l'épreuve testée, puis un taux. Sort `1` si une attente échoue.
5. Comparer (`scripts/generate-comparison.py`) : verdict A/B sur deux `grading.json`. La mise à jour de `history.json` est **manuelle**, et à faire seulement après un verdict.

Le format `evals.json` est obligatoire (voir `references/evals-spec.md`, schémas dans `references/schemas.md`). `history.json` n'est requis qu'à partir de la première comparaison ; une seule entée porte `current_best: true`, et elle doit être précédée d'un verdict.

---

## Phase 3 : Améliorer un skill (mode Amélioration)

Quand : le skill a échoué à un ou plusieurs tests d'évaluation.

Cycle itératif (chaque boucle) :

```
Écrire la correction → Valider le gate → Produire les transcripts → Noter → Comparer au current_best
```

À chaque itération :
- Si le taux dépasse le `current_best` → la nouvelle version devient `current_best` dans `history.json` (écrit à la main, après verdict).
- Si égal → `tie` (choix de l'utilisateur).
- Si diminue → `lost` (revenir au `current_best` ou continuer en connaissance de cause).

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

Le skill applique le bon pipeline selon la catégorie du projet : `code`, `flutter`, `expo`, `debug`, `review`, `audit`, `test`, `research`, `browser`, `design-ui`, `database-supabase`, `docs-writing`, `planning`, `devops`, `data`, `assessment`, `general`. Chaque catégorie a ses exigences spécifiques.

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
- `scripts/scan-skill.py` : structure du dossier de skill (SKILL.md, corps ≤500 lignes, fences équilibrées, références de niveau 1, scripts avec `--help`)
- `scripts/extract-description.py` : analyse de la description comme routeur (longueur, déclencheurs, différenciateurs, spécificité lexicale)
- `scripts/run-eval.py` : **n'invoque aucun modèle**. Valide la forme de `evals.json`, mesure un transcript que **vous** produisez, l'archive sous `evals/runs/`
- `scripts/generate-grading.py` : note un transcript contre les attentes de `evals.json` (produit `grading.json`, code 1 si une attente échoue)
- `scripts/generate-comparison.py` : comparaison aveugle A/B de deux `grading.json` (produit `comparison.json`, code 0 même sur un exaequo)
- `scripts/check-memory.py` : cohérence mémoire/code (citations `novahiz-docs/<lib>@<version>`, chemins absolus, secrets, notes vides ou anciennes)

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
- `assets/frontmatter-checklist.md` : checklist de livraison en 10 points, chaque point accompagné de la commande qui le prouve
