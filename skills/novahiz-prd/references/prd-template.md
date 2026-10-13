# Template PRD une page — novahiz-prd v2

Design propre, écrit de zéro le 2026-10-12. Ancré sur trois constats de recherche:
la tendance 2026 est au document court attaché au repo; les agents ont besoin de
critères vérifiables et de frontières explicites; les PRD générées échouent sur les
mêmes points (chiffres inventés, non-goals sautés, longueur). Ce template est une
réponse à ces trois constats, pas la copie d'un template existant.

**Plafond dur: 600 mots de corps, hors frontmatter.** L'excédent part dans une annexe
nommée, jamais dans la page.

## Frontmatter

```yaml
---
title: "PRD: nom de la feature"
type: prd
status: draft       # draft | review | approved | building | shipped | superseded
owner: "prenom"     # une personne physique; un groupe = personne
created: 2026-10-12
updated: 2026-10-12
decision: ""        # verdict du go/no-go, ex "GO 4,15/5 (2026-10-12)"
supersedes: ""      # chemin de la PRD remplacée, le cas échéant
---
```

## Corps — huit sections, budget par section

### 1. En une phrase — 25 mots
Quoi, pour qui, et le succès en une phrase. Ce paragraphe seul doit permettre de dire
oui ou non. S'il ne le permet pas, la PRD n'est pas prête.

### 2. Le problème, avec sa preuve — 80 mots
Qui est bloqué, à quelle fréquence, ce que coûte l'inaction. Une preuve réelle exigée:
ticket, mesure, citation, observation de terrain. Sans preuve, la phrase porte
`[à valider]` — la marque reste visible dans le document partagé, c'est voulu: un lecteur
doit voir ce qui n'est pas encore solide.

### 3. L'utilisateur, précisément — 45 mots
Un segment nommé (« les PM solo qui documentent pour un client », pas « les utilisateurs »)
et l'observation qui dira que sa vie a changé. Vérifiable sans instrument: quelqu'un doit
pouvoir le constater en regardant travailler la personne.

### 4. Ce qu'on livre v1 — 70 mots
Trois à cinq puces de valeur. Chaque puce décrit un comportement observable, pas un écran,
pas une donnée. Si une puce contient un nom de table, de champ ou de composant, elle est
mal placée: c'est du travail de spec.

### 5. Périmètre — 90 mots
- **Construit** — 2 à 4 items.
- **Ne sera pas construit** — 4 à 6 items, obligatoires, non vides. Chaque non-goal est un
  refus net; une envie différée n'appartient pas ici (« plus tard » ment sur la décision).

Cette section porte la moitié de la valeur du document: elle est la seule que les
générateurs sautent, et celle qui évite le plus d'implémentations parasites.

### 6. Critères d'acceptation — 110 mots
Quatre à sept critères, identifiants stables, forme testable:

```
AC-1  Étant donné <état initial>, quand <action>, alors <résultat observable>
AC-2  ...
Vérification: <commande exécutable si elle existe>
```

Les identifiants (`AC-n`) permettent la traçabilité: le plan, les tâches et la
convergence citent `AC-3`, pas un paragraphe. Un critère qui contient « bien », « rapide »
ou « flexible » est rejeté à la relecture.

### 7. Succès mesuré — 60 mots
- Métrique primaire: valeur actuelle → cible, avec fenêtre de mesure.
- Garde-fous: 1 à 2 contre-métriques qui empêchent d'atteindre la cible en abîmant le reste.

Sans mesure d'origine: `[à valider]` sur la baseline, jamais un chiffre de façade.
À ne pas confondre avec l'AC-1: les critères gate la livraison, la métrique juge
l'après-livraison.

### 8. Décisions figées et questions ouvertes — 80 mots
- **Figé** — 2 à 4 décisions déjà tranchées avec leur raison courte et l'alternative
  écartée. Leur présence empêche de les rouvrir en revue.
- **Ouvert** — chaque question avec un propriétaire et une date de arbitrage. Le marqueur
  `[STOP]` sur une question interdit à l'agent de deviner: il doit demander.

**Total budget: 660 mots; viser 550.**

## Relecture avant livraison — les sept refus

Une PRD contenant l'un de ces défauts revient à l'auteur, non au lecteur:

1. Métrique sans source (doit porter `[à valider]`).
2. Section blanche (un blanc se lit comme un accord).
3. Non-goals absents ou vides.
4. Détail d'implémentation dans le corps.
5. Critère non testable.
6. Owner collectif.
7. Corps au-delà de 600 mots (annexer).

## Hors page

Analyse concurrentielle, personas, wireframes, architecture, roadmap, RACI, plan de
test: chaque genre a son document. La PRD y renvoie si besoin; elle ne les absorbe pas.
