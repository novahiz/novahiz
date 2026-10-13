---
name: novahiz-prd
description: |
  novahiz-prd écrit la PRD d'une page du projet: un document produit, sur disque, qui sert deux lecteurs à la fois — l'humain qui décide (client, co-fondateur) et l'agent qui construit. Sortie: novahiz-docs/prd/ en fichier slug kebab-case, versionné dans le repo. Se déclenche sur "génère la PRD", "fais la PRD de X", "write the PRD", "cadrage produit", ou en sortie d'un assess-*. Deux entrées: synthèse des sorties de l'assessment roadmap sans re-questionner, ou entretien one-shot de 5 questions maximum sur une idée brute. Ne pas confondre avec novahiz-assess-define (contrat d'implémentation, reste dans le chat) ni novahiz-plan (direction technique): la PRD porte le pourquoi, jamais le comment.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-prd

Une page. Deux lecteurs. Zéro ambiguïté survivante.

La PRD répond à quatre questions — *pourquoi, pour qui, quoi, et surtout pas quoi* — puis
se tait. Ce qu'elle ne couvre pas a une maison: le *comment* revient à la spec
(`novahiz-assess-define`), la *direction technique* à `novahiz-plan`. Deux documents qui
se ressemblent signifient qu'un des deux a fui: corriger, ne pas fusionner.

## When

Trois portes d'entrée, une seule à la fois:

1. **En sortie d'assessment** — `intake → research → define → shape → decide` ont produit
   leurs rapports dans le chat. La PRD *synthétise*; elle ne rouvre aucune question.
2. **Entretien one-shot** — pas d'assessment, une idée brute. Cinq questions au maximum
   (voir plus bas), puis la page.
3. **Révision** — une PRD existe déjà et le périmètre a bougé. On édite la version en
   place et on bouge `status` + `updated`; si la rupture est forte, on crée un fichier
   nouveau avec `supersedes`.

Jamais les deux premières en même temps: si des rapports d'assessment existent, on part
d'eux.

## Mode synthèse

1. Relire les cinq sorties de l'assessment **dans le chat** — l'intention vient des
   artefacts, pas de la mémoire de l'agent.
2. Remplir chaque section avec le contenu réel trouvé. Une section sans donnée reçoit le
   marqueur `[à valider]`; elle ne reste jamais blanche, un blanc se lit comme un accord.
3. Reporter le verdict de `decide` (go / no-go / conditional) dans le frontmatter
   `decision` et dans le TL;DR.

## Mode entretien

Batch unique, ordre fixe, harness `question`:

```
question({
  questions: [
    { header: "Problème",
      question: "Quel souci, pour qui, avec quelle preuve ?",
      options: [
        { label: "Douleur documentée (Recommandé)", description: "chiffre, ticket ou citation réelle entre dans la PRD" },
        { label: "Hypothèse", description: "entrera marquée [à valider]" }] },
    { header: "Succès",
      question: "Quel résultat observable prouve que ça a marché ?",
      options: [
        { label: "Métrique + cible + fenêtre (Recommandé)", description: "mesurable après livraison" },
        { label: "Sortie binaire", description: "livré / non livré, suffisant pour un jalon interne" }] },
    { header: "Périmètre",
      question: "Qu'est tentant mais hors sujet ?",
      options: [
        { label: "Lister 4 à 6 non-goals (Recommandé)", description: "la section qui évite le plus d'aller-retours" },
        { label: "Pas de non-goals", description: "déconseillé: la section est alors bloquée vide" }] },
    { header: "Lecteur",
      question: "Qui ouvrira ce document ?",
      options: [
        { label: "Humains + agents (Recommandé)", description: "format partageable tel quel" },
        { label: "Agents seulement", description: "PRD purement fonctionnelle de la pipeline" }] }
  ]
})
```

La 5ᵉ question (échéance) ne se pose que si elle changerait le périmètre.

## La page: contrat dur

- Template imposé: `references/prd-template.md` — sections, ordre, budgets de mots.
  **~600 mots de corps.** Au-delà, le surplus part dans une annexe séparée, jamais dans
  la page.
- Aucun chiffre sans source: pas de baseline → `[à valider]`, jamais de valeur inventée.
- Les non-goals sont obligatoires et non vides.
- Critères d'acceptation pass/fail; un adjectif (« performant », « flexible ») n'est pas
  un critère.
- Une seule question ouverte par ligne, avec propriétaire.
- Aucun détail d'implémentation: colonne, composant, couleur, bibliothèque → hors PRD.

## Écriture

1. Cible: `novahiz-docs/prd/<slug>.md`, slug kebab-case du nom de la feature. Créer les
   dossiers manquants; le fichier se versionne dans le repo du projet.
2. Frontmatter du template: `title`, `type: prd`, `status`, `owner` (une personne, jamais
   un groupe), `created`, `updated`, `decision`, `supersedes`.
3. Cycle de vie de `status`: `draft → review → approved → building → shipped`, puis
   `superseded` quand une version prend le relais.
4. Retour en chat: le chemin du fichier, puis le TL;DR en deux phrases.

## Handoff

`novahiz-plan` lit le fichier comme entrée d'intention. La PRD n'est jamais recopiée dans
le plan ni dans les tâches: on y pointe, on ne la duplique pas. Quand la convergence
(`novahiz-converge`) détecte une dérive entre le code livré et le périmètre déclaré, la
PRD est rafraîchie en premier — c'est elle qui fait foi sur le *quoi*.

## Anti-patterns

- Recopier la spec dans la PRD: si les deux disent la même chose, une des deux est morte.
- Section laissée vide au lieu de `[à valider]`.
- Non-goals absents — le symptôme le plus fréquent et le plus coûteux.
- Métrique inventée pour faire professionnel: elle coûtera une décision fausse.
- PRD de 3 pages « parce que le sujet le mérite »: le mérite se prouve en une page.
- Owner collectif: un groupe en propriétaire signifie personne.
- Chiffre de concurrence ou de marché non sourcé → `[à valider]`.
