---
name: novahiz-wireframe
description: |
  novahiz-wireframe impose le pipeline wireframe-first AVANT toute construction
  d'écran ou de section: croquis détaillé de l'écran entier, puis wireframe
  annoté de chaque section, indexés dans wireframes/, la pièce jointe complète
  nourrit impeccable shape, puis le code se construit section par section avec
  des composants réutilisables. Le gate (R15) bloque la construction d'un écran
  design tant que ce wireframe n'existe pas.
  Use when designing, sketching or building any screen or screen section, or
  when the user asks to conceive, spec, wireframe or construct a UI surface.
  Triggers on: "wireframe", "croquis", "conçois l'écran", "écran entier",
  "section de l'écran", "construis la page", "design de l'écran",
  "impeccable shape avec wireframe".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
---

# novahiz-wireframe

Le wireframe est la **spécification structurelle faisant foi**. Avant d'écrire
une ligne de code de design, vous dessinez l'écran, puis chaque section. Le code
suit le wireframe; le wireframe ne suit jamais le code (sauf divergence
authentique, qu'on marque `stale` puis qu'on met à jour).

## Le contrat dur — séquence obligatoire

```
1. novahiz_wireframe init          (une fois par projet)
2. novahiz_wireframe plan          (l'écran est-il mono ou multi-sections ?)
3. novahiz_wireframe screen        (structure globale de l'écran)
4. novahiz_wireframe sections      (toutes les sections en un seul appel)
5. compléter chaque section        (annotations, états, réutilisation)
6. novahiz_wireframe review        (sections importantes oubliées ?)
7. novahiz_wireframe attach        (pièce jointe -> prompt impeccable shape)
8. impeccable shape (brief pré-rempli par le wireframe)
9. décomposer en tâches: 1 sous-tâche = 1 section
10. construire section par section (composants réutilisables)
11. novahiz_wireframe mark         (draft -> approved; stale si divergence)
```

Sauter une étape fait sortir un écran qui diverge du brief et qui se paie en
retouches. Le gate `R17-wireframe` (et l'étape `wireframe` de la roadmap
design-ui) exige cette skill chargée sur toute tâche design-ui ou tout fichier
d'écran.

Trois garde-fous portés par le code, pas par votre mémoire:

- `screen` renvoie `needsSections: true` accompagné d'un `plan` quand l'écran est
  créé sans sections. Un écran vide n'est jamais un succès silencieux.
- `sections` crée **toutes** les sections en un seul appel (une seule
  reconstruction d'index, contre une par section avec `section`). C'est la
  raison du rendu lent quand on créait les sections une à une.
- `mark approved` **refuse** tant que `review` trouve un manque. C'est le seul
  point de la séquence qui ne peut pas être sauté, et il est vérifié par le code.

## Étape 1 — init (une fois par projet)

```
novahiz_wireframe { action: "init" }
```

Crée `wireframes/` à la racine du projet avec `INDEX.md`. Idempotent.

## Étape 2 — plan: mono ou multi-sections ?

```
novahiz_wireframe { action: "plan", name: "Catalogue formations",
  objective: "Permettre à l'apprenant de comparer et de s'inscrire." }
```

Renvoie `screenClass` (`list` / `form` / `detail` / `settings` / `default`),
`needsMultiple`, les `sections` candidates, et surtout `reasons` — pourquoi
chaque décision a été prise. Exemple: un formulaire vaut trois sections parce
qu'il a trois responsabilités distinctes (saisir, valider, confirmer) qui
deviennent illisibles fusionnées.

**Le verdict est heuristique** (`heuristic: true`): une règle statique ne peut
pas juger l'intention de design. C'est une proposition argumentée, pas une
autorité — confirmez-la ou corrigez-la, puis passez les sections retenues à
`screen`. La classe `default` signifie explicitement « je ne sais pas »: la
question reste ouverte, elle n'est pas résolue.

Si `screen` a déjà été créé sans sections, `needsSections: true` arrive avec un
`plan` joint: servez-vous-en directement.

## Étape 3 — l'écran entier

```
novahiz_wireframe { action: "screen", name: "Catalogue formations",
  objective: "Permettre à l'apprenant de comparer et de s'inscrire.",
  sections: ["En-tête et filtres", "Grille de formations", "Pagination"] }
```

Produit `wireframes/<slug>/screen.md` (objectif, flux, layout ordonné des
sections, états globaux, breakpoints) et un skeleton `sections/NN-<slug>.md`
par section. L'ordre des `sections` est l'ordre de lecture de l'écran.

Si vous omettez `sections`, l'écran est créé quand même, mais avec
`needsSections: true` et un `plan` joint. Ce n'est pas un état valide: alimentez-le
immédiatement. Rappeler `screen` avec les sections **ne remplit rien** — le
wireframe existant fait foi et n'est jamais écrasé.

Le wireframe de l'écran est le croquis de synthèse: il montre l'ossature et
l'enchaînement des zones, pas le détail de chaque contrôle (c'est le rôle des
sections).

## Étape 4-5 — les sections: création en lot, puis détail

```
novahiz_wireframe { action: "sections", screen: "catalogue-formations",
  sections: ["En-tête et filtres", "Grille de formations", "Pagination"] }
```

Crée toutes les sections en **un seul appel**. Une seule reconstruction d'index
contre une par appel avec `action: "section"`, qui reste réservé à l'ajout d'une
section unique en cours de route. Les noms déjà présents sont signalés dans
`existing`, jamais réécrits.

La réponse contient `review`: le verdict immédiat de « ai-je maintenant tout ce
qu'il faut ? ».

Ensuite, chaque section reçoit son contenu. Complétez-la intégralement avant
shape:

- **Rôle dans l'écran**: pourquoi cette section existe.
- **Éléments**: tableau id / élément / type (texte, bouton, champ, liste…).
- **Annotations**: une par élément interactif, ancrée à l'élément, en trois
  volets `Intent` (pourquoi), `Behavior` (quand l'utilisateur X, le système
  répond Y), `Constraints` (limites, troncature, débordement).
- **États**: les six lignes cochées sans exception — Default, Loading, Empty,
  Error, Permission, Responsive.
- **Composants**: `reuse` (composant existant, nom exact) et `new-component`
  (candidat à l'extraction).

Le format complet, avec les règles d'annotation et les pièges à éviter, est dans
[references/format.md](references/format.md). Lisez-le avant la première
section d'un projet.

## Étape 6 — review: la vérification des sections oubliées

```
novahiz_wireframe { action: "review", screen: "catalogue-formations" }
```

Renvoie `verdict` (`pass` / `gaps`), `gaps` — chaque manque avec son `severity`
et son `why` — et `questions`.

**Deux choses distinctes cohabitent ici, et il faut savoir laquelle vous regardez:**

1. `gaps` est **déterministe**. Une règle classe l'écran et compare ses sections
   attendues à celles qui existent. Elle détecte l'objectivement manquant: un
   écran sans structure, un listing sans état vide, un formulaire sans
   section d'erreur. Elle ne peut pas inventer un besoin de design.
2. `questions` est **obligatoire et non résoluble par le code**. Six questions —
   depuis quand vient l'utilisateur, que voit-on si la liste est vide, que fait
   375px à chaque section — que seul vous pouvez répondre, section par section.

Le script ne pense pas à votre place: il empêche l'étape d'être sautée. C'est
pourquoi `mark approved` appelle la revue lui-même et refuse tant que `verdict`
n'est pas `pass`.

## Étape 7-8 — la pièce jointe à impeccable shape

```
novahiz_wireframe { action: "attach", screen: "<slug>" }
```

Renvoie `promptBlock`: le contenu **complet** du screen et de toutes ses
sections, préfixé des règles de conformité. Collez ce bloc dans le prompt
d'`impeccable shape`, en tête de prompt. La correspondance exacte entre le
wireframe et les sections du brief de shape est détaillée dans
[references/shape-handoff.md](references/shape-handoff.md) — lisez-la avant de
construire le prompt.

Le wireframe répond déjà à l'interview Round 1 de shape (purpose, people,
outcome) et alimente les sections 5 (States and ranges) et 6 (Interaction and
layout) du brief. Shape en sort avec la structure verrouillée; il ne reste que
le monde visuel et le concept à choisir.

## Étape 9 — décomposition en tâches

Un écran N sections se découpe en **N sous-tâches sections**, plus quelques
sous-tâches transverses. Template (via `novahiz_task`):

```
todo (verify)  Validated wireframe for <écran> (all sections annotated)
todo (edit)    Section wireframe completed: <section 1>
todo (edit)    Build section 1: <section 1>
todo (edit)    Section wireframe completed: <section 2>
todo (edit)    Build section 2: <section 2>
...
todo (edit)    Extract reusable components (end of screen)
todo (verify)  Screen matches wireframe, mark approved
```

Règles de découpe:

- **1 sous-tâche = 1 section.** La wireframe completion et le build d'une
  même section sont adjacents: on ne wireframe pas toutes les sections puis
  on ne code pas toutes d'un coup. On avance section par section.
- La tâche `verify` wireframe ouvre le bal; la `verify` finale prouve la
  conformité et déclenche `mark approved`.
- Chaque `build section` référence les composants `reuse` listés dans son
  wireframe. Un composant nouveau non extrait est un dette.

## Étape 10 — construction modulaire

Le wireframe section est la carte de réutilisation. En construisant:

- Un élément marqué `reuse` appelle le composant existant tel quel. Ne le
  recopiez pas.
- Un élément marqué `new-component` devient, à sa deuxième occurrence ou à la
  fin de l'écran, un composant dédié dans le dossier de composants partagés.
  Un composant vit à un endroit.
- La logique de section reste dans la section; le composant porte l'UI
  réutilisable. La section ne se retrouve jamais à dupliquer un style.

À la fin de l'écran, l'étape `extract reusable components` (template ci-dessus)
passe au crible les `new-component` et crée ceux qui justifient un fichier
propre. C'est le point où l'approche modulaire devient un livrable, pas une
intention.

## Étape 11 — cycle de vie et mise à jour

```
draft ──(brief confirmé, code conforme)──> approved
approved ──(code diverge authentiquement)──> stale
stale ──(wireframe mis à jour)──> draft
```

- `novahiz_wireframe { action: "mark", screen, status: "approved" }` à la
  convergence de l'écran. **La revue s'exécute à ce moment-là**: tant que
  `verdict != pass`, l'approbation est refusée avec la liste des manques et la
  commande de rattrapage. C'est le contrôle qui ne dépend pas de votre
  discipline.
- Si le code diverge du wireframe (découverte en cours de route, exigence qui
  change), `mark stale` sur l'écran ou la section concernée, puis éditez le
  wireframe pour qu'il rejoigne la réalité, puis repassez en `draft`.
- `novahiz_wireframe { action: "index" }` reconstruit `INDEX.md` depuis le
  disque (source de vérité). L'index se régénère aussi à chaque screen/section.
- `novahiz_wireframe { action: "status" }` donne l'état courant de tous les
  écrans (ou d'un écran avec `screen: <slug>`).

## Anti-patterns

- **Coder la section avant son wireframe.** Le gate refuse; moralement c'est
  pire: le brief part sur une structure inventée après coup.
- **Créer un écran sans sections et passer à la suite.** `needsSections: true`
  n'est pas un avertissement à ignorer. L'état existe pour être réparé, en un
  seul appel `sections`.
- **Créer les sections une par une.** Chaque appel reconstruit tout l'index du
  projet. `sections` fait le travail en un appel et rend le verdict de revue en
  même temps.
- **Traiter `plan` comme une décision.** `heuristic: true` veut dire « proposition
  argumentée ». Une règle statique ne connaît pas votre intention de design; elle
  ne peut que vous proposer et vous dire pourquoi. Une classe `default` est une
  question ouverte, pas une réponse.
- **Approuver sans avoir lu `questions`.** Le blocage porte sur `gaps`
  (déterministe); les six questions vous reviennent. Vous passerez la revue en
  n'y répondant pas — c'est exactement ce qu'elles cherchent à empêcher.
- **Wireframer tout l'écran en détail d'un bloc.** Le croquis de synthèse
  (screen.md) montre l'ossature; le détail vit section par section. Deux
  niveaux, pas un.
- **Annotations ancrées à l'écran.** Une annotation suit son élément. Ancrez-la
  à l'élément, sinon elle se périme au premier déplacement de layout.
- **Écriture de specs visuelles dans le wireframe.** Couleurs, typographies,
  espacements exacts: hors wireframe, c'est le design system qui les porte. Le
  wireframe décrit la structure, le comportement et les états.
- **Composants recopiés.** Un `reuse` ignoré et recopié est une duplication
  qui grandit. Suivez la carte `reuse` du wireframe.
- **Oublier les états edge.** Empty, Loading, Error, Permission sont presque
  toujours absents d'un wireframe bâclé, et presque toujours le périmètre des
  tickets de fin de sprint.
