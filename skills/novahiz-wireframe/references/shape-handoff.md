# Handoff wireframe → impeccable shape

`impeccable shape` planifie le design avant le code: interview discovery puis
brief (7 sections). Notre choix (validé 2026-10-12): le wireframe est joint au
prompt **en contenu complet**, pas seulement par chemin. Shape reçoit la
structure verrouillée et ne fait plus que le travail qui reste: le monde
visuel, le concept, la hiérarchie fine.

## Pourquoi le contenu, pas le chemin

Donner un chemin laisse shape décider s'il lit le fichier. Lecture partielle,
instructions ignorées, interview relancée à vide: le risque réel. Le bloc collé
en tête de prompt ne laisse aucune ambigüité sur ce qui fait foi.

## La séquence exacte

```
1. novahiz_wireframe { action: "attach", screen: "<slug>" }
   -> récupérer promptBlock
2. Lancer impeccable shape avec le prompt ci-dessous.
```

## Template de prompt à impeccable shape

```
Conçois l'écran « <Titre écran> ». Le wireframe ci-dessous est la
spécification structurelle faisant foi: la structure, les sections, les
éléments, les annotations et les états s'y conforment. Ne relance pas
l'interview discovery sur la structure, le flux ou les états: ils sont
déjà tranchés dans le wireframe. Concentre le brief sur le monde visuel,
le concept et la hiérarchie fine.

<insérer ici le promptBlock renvoyé par novahiz_wireframe attach>

Contexte projet: <PRODUCT.md existant / audience / objectifs si disponibles>.
```

Insérez le `promptBlock` tel quel (il contient déjà les en-têtes de fichiers et
les règles de conformité). Ne le résumez pas.

## Ce que le wireframe couvre dans le brief de shape

Le brief de shape a 7 sections. Le wireframe en pré-remplit trois, ce qui
transforme l'interview:

| Section du brief | Apport du wireframe |
| --- | --- |
| 1. Job and audience | L'objectif et le flux du `screen.md` |
| 2. Outcome and proof | La sortie principale du flux |
| 5. States and ranges | Les états edge de chaque section (les 6 lignes) |
| 6. Interaction and layout | Ordre des sections, annotations behavior, responsive |

Restent à shape (et à l'utilisateur dans l'interview):

- **3. Selected direction**: le monde visuel, la thèse d'interaction, le
  moment focal.
- **4. Scope and boundaries**: fidélité, périmètre, anti-goals.
- **7. Constraints**: plateforme, livraison, i18n, et les choix qu'un
  builder ne doit pas inventer.

Si le wireframe est complet, l'interview Round 1 (purpose/people/outcome) est
largement répondue; Round 2 (material/behavior/boundaries) aussi, sauf les
contraintes de plateforme et de livraison qui ne sont pas du ressort du
wireframe.

## Après shape

Le brief confirmé (le `Confirm and stop` de shape) clôt la phase de design
d'intention. Revenez au pipeline novahiz:

1. La tâche ledger de l'écran se découpe 1 sous-tâche = 1 section (voir la
   skill, étape 7).
2. Chaque section se construit contre son wireframe.
3. À la convergence de l'écran: `novahiz_wireframe { action: "mark",
   screen, status: "approved" }`.
4. Si le code a divergé authentiquement du wireframe en cours de route:
   `mark stale`, mettez le wireframe à jour, repassez en `draft`.

## Mise à jour du wireframe pendant le build

Le wireframe est fait foi, mais la réalité du build peut le rattraper (une
exigence change, une contrainte technique apparaît). La règle:

- Ne laissez jamais le code et le wireframe diverger en silence.
- `mark stale` sur l'élément concerné.
- Éditez le wireframe pour qu'il rejoigne la réalité (c'est la direction
  conventionnelle: le wireframe rejoint le code, jamais l'inverse, une fois
  la divergence authentique).
- Repassez en `draft`, puis `approved` à la re-convergence.

Le `INDEX.md` reflète les statuts à chaque action; un écran `stale` se voit
d'office dans l'index.
