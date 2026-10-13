# Format des wireframes novahiz

Le wireframe novahiz est un fichier Markdown structuré. Pas de HTML/CSS: le
wireframe doit être joignable à un prompt, versionnable, lisible par l'agent et
par un humain, sans dérive vers le code. Les deux niveaux (écran puis section)
portent chacun leur format.

## Niveau 1 — `wireframes/<slug>/screen.md`

Le croquis de synthèse. Il montre l'ossature de l'écran et l'enchaînement des
zones, jamais le détail des contrôles.

```markdown
---
id: catalogue-formations
title: Catalogue formations
kind: screen
status: draft
version: 1
created: 2026-10-12T…Z
updated: 2026-10-12T…Z
---

# Catalogue formations

## Objectif

Permettre à l'apprenant de comparer et de s'inscrire en une session.

## Flux

- **Entrée**: menu principal, recherche globale.
- **Sortie principale**: clic sur une formation -> fiche détail.
- **Sorties secondaires**: filtres, pagination, favoris.

## Layout (ordre des sections)

1. **En-tête et filtres** → `sections/01-en-tete-et-filtres.md`
2. **Grille de formations** → `sections/02-grille-de-formations.md`
3. **Pagination** → `sections/03-pagination.md`

## États globaux de l'écran

- [x] Loading global (squelette de grille)
- [x] Empty global (aucune formation au catalogue)
- [x] Error globale (échec de chargement + retry)
- [x] Permission refusée

## Breakpoints

- **Mobile (< 640px)**: une colonne, filtres en sheet.
- **Desktop (>= 1024px)**: grille 3 colonnes, filtres en rail gauche.
```

La liste `Layout` est l'ordre de lecture. Chaque ligne pointe le fichier de
section qui la détaille. Les états globaux concernent l'écran pris comme un
tout (pas une section).

## Niveau 2 — `wireframes/<slug>/sections/NN-<section>.md`

Le wireframe détaillé d'une section. C'est ici que vit la précision.

```markdown
---
id: 02-grille-de-formations
title: Grille de formations
kind: section
screen: catalogue-formations
status: draft
version: 1
created: 2026-10-12T…Z
updated: 2026-10-12T…Z
---

# Grille de formations

## Rôle dans l'écran

Faire comparer les formations et ouvrir la fiche. C'est le cœur de l'écran:
la section doit rendre la comparaison immédiate.

## Éléments

| Id | Élément | Type | Annotation |
| --- | --- | --- | --- |
| e1 | Carte formation | carte | voir e1 |
| e2 | Badge niveau | badge | voir e2 |
| e3 | Bouton « S'inscrire » | bouton | voir e3 |
| e4 | Lien « Voir détails » | lien | voir e4 |

## Annotations

### e1 (Carte formation)

- **Intent**: unité de comparaison; une carte = une formation.
- **Behavior**: au clic (hors bouton e3), ouvre la fiche détail dans le même
  flux. Au survol, la carte s'élève d'un cran (surface, pas scale).
- **Constraints**: titre tronqué à 2 lignes; la carte ne déborde jamais, le
  contenu long s'affiche en `clamp`.

### e3 (Bouton « S'inscrire »)

- **Intent**: action primaire de la section, une par carte.
- **Behavior**: clic -> confirmation; état loading pendant la requête;
  désactivé si prérequis non satisfaits (avec tooltip disant lequel).
- **Constraints**: jamais deux inscriptions simultanées sur la même carte.

## États (obligatoires: compléter chaque ligne)

- [x] Default (liste peuplée)
- [x] Loading (squelettes de cartes)
- [x] Empty (aucun résultat pour les filtres -> lien « réinitialiser »)
- [x] Error (échec de chargement + retry dans la section)
- [x] Permission (filtres premium masqués, pas désactivés)
- [x] Responsive (1 colonne mobile, 3 desktop; carte identique)

## Composants

- **reuse**: `FormationCard` (existant), `Badge` (existant).
- **new-component**: `FilterChip` (le même chip revient dans l'en-tête).
```

## Les règles d'annotation

Ces règles viennent des pratiques de handoff documentées (annotation ancrée à
l'élément, volets intent/behavior/constraints, états edge obligatoires,
vocabulaire fixe). Elles font la différence entre un wireframe utile et un
souhait.

### Ancrez à l'élément, jamais à l'écran

Une annotation suit son élément. Ancrée à l'écran, elle se périme au premier
déplacement de layout. Ankrée à l'élément (### e3), elle survit au
repositionnement.

### Les trois volets

- **Intent** — pourquoi cet élément existe ici, ce qu'il aide à faire.
- **Behavior** — quand l'utilisateur X, le système répond Y. Transitions,
  validation, états, retour d'information.
- **Constraints** — limites: min/max, troncature, débordement, cas limites.

Un élément purement décoratif n'a pas d'annotation. Un élément interactif en a
une, sans exception.

### Vocabulaire fixe des types

Utilisez le même mot partout: `texte`, `bouton`, `lien`, `champ`, `liste`,
`carte`, `badge`, `tableau`, `onglet`, `menu`, `modale`, `toast`, `squelette`,
`image`, `icône`, `sélecteur`, `curseur`, `avatar`, `pagination`, `filtre`.
Un type hétérogène casse la lecture de l'index et la génération de tâches.

### Les six états, toujours

`Default`, `Loading`, `Empty`, `Error`, `Permission`, `Responsive`. Les quatre
derniers sont ceux qu'on oublie et qu'on paie plus tard. `Responsive` décrit
ce qui change par breakpoint, pas « ça s'adapte ».

### Pas de specs visuelles

Le wireframe décrit la structure, le comportement et les états. Interdits dans
un wireframe novahiz: valeurs de couleur, familille et corps de typo, espacements
en px, rayons, ombres. Tout cela vit dans le design system. Une note comme
« contraste suffisant » est une contrainte d'a11y recevable; `#3B82F6` ne l'est
pas.

### Ids d'éléments stables

`e1`, `e2`, … sont stables dans la vie de la section. Le code, le brief de
shape et les tickets de test peuvent les référencer. Renommez-les seulement
avec une mise à jour de version.

### Au-delà de deux phrases

Une annotation qui dépasse deux phrases a probablement une décision de produit
dedans. Sortez-la dans une section « Décisions » sous l'annotation, ou c'est
une note de design system. L'annotation reste lisible.

## Ce qui ne va pas dans un wireframe

| Interdit | Où ça va |
| --- | --- |
| `#3B82F6`, `text-lg font-bold` | design system / DESIGN.md |
| « padding 24px partout » | design system |
| Règle de produit nu (« l'utilisateur peut annuler ») | PRD / brief shape |
| Logique métier (calculs, seuils) | ticket de build de la section |
| Copy définitive longue | contenu réel ou brief |

Une contrainte d'a11y (« focus visible sur chaque carte »), un état edge ou
une règle de comportement ont leur place. La mise en forme n'y a pas la sienne.
