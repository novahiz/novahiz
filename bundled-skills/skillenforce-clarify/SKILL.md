---
name: skillenforce-clarify
description: |
  Étape 2 du pipeline skillenforce : lever les ambiguïtés avant de figer le plan.
  Deux mécanismes combinés : un balayage d'ambiguïté par familles de risque, et des salves
  de questions ordonnées par dépendances (la frontière), chaque question numérotée avec une
  réponse recommandée.
  Use when the request is vague, underspecified, contradictory, or when several plausible
  readings lead to different work.
  Triggers on: "clarifier", ambigu, "je ne sais pas encore", périmètre flou, exigences
  manquantes, "deux lectures possibles", questions ouvertes.
license: MIT
compatibility: opencode
---

# skillenforce-clarify : lever les ambiguïtés

**Étape 2 sur 6** du pipeline. Tu interroges avant que le plan ne soit figé.

Étape précédente : `skillenforce-plan`. Étape suivante : `skillenforce-task`.

## Entrée

Demande ambiguë, contradictoire, ou assez large pour que deux lectures produisent deux travaux différents.

## A. Balayage par familles

Passe la demande au crible de dix familles de risque. Note chacune `claire`, `partielle` ou `manquante`.

1. Comportement et portée fonctionnelle
2. Domaine et modèle de données
3. Parcours et interactions
4. Qualités non fonctionnelles : performance, charge, disponibilité, sécurité, accessibilité, internationalisation
5. Intégrations et dépendances externes
6. Cas limites et gestion des échecs
7. Contraintes et compromis
8. Terminologie et cohérence
9. Signaux de complétion : ce qui prouve que c'est fini
10. Zones de remplissage et valeurs provisoires

Une famille laissée `manquante` sur la portée, les données, le découpage, les tests, l'UX ou l'exploitation devient une question. Le reste attend.

## B. Salves par frontière, posées dans l'interface

Modélise les décisions comme un arbre : chaque décision ouvre celles qui en dépendent.

La **frontière** est l'ensemble des décisions dont les prérequis sont déjà tranchés, donc posables maintenant sans deviner. Une salve est **un seul appel** à l'outil `question` du harness, avec une entrée par décision de la frontière.

```
question({
  questions: [
    {
      header: "<titre court, 30 caracteres au plus>",
      question: "<la decision, une phrase, avec son enjeu>",
      options: [
        { label: "<option recommandee> (Recommandé)", description: "<consequence concrete>" },
        { label: "<option>", description: "<consequence concrete>" },
        { label: "<option>", description: "<consequence concrete>" }
      ]
    }
  ]
})
```

Règles de salve :

- **Aucune question en prose dans le chat.** Le tableau interactif est le seul canal. Le chat porte le contexte, jamais la liste des questions.
- Cinq questions au maximum, classées par impact croisé avec incertitude.
- Deux à cinq options par question, exclusives entre elles, chacune décrite par ce qu'elle implique.
- L'option que tu recommandes passe en premier et porte le suffixe `(Recommandé)`. L'interface ajoute une réponse libre toute seule : n'ajoute ni « Autre » ni option fourre-tout.
- `multiple: true` seulement quand plusieurs réponses peuvent coexister.
- Une question qui dépend d'une autre question encore ouverte appartient à une salve ultérieure.
- Chaque réponse déplace la frontière : recalcule-la, relance un appel.
- Tu attends le retour de l'appel avant de continuer.

Si le harness courant n'expose pas d'outil `question`, tu poses **une** question par tour, la recommandation en tête, et tu attends. Tu ne déverses jamais une liste de questions d'un coup.

Tu réponds toi-même à tout ce que deux fichiers lus suffisent à trancher.

## Devoir de critique

Si la demande est incohérente, ambiguë, risquée ou sous-optimale, dis-le et propose une alternative. Garder le silence laisse une erreur en place.

## Sortie

Une courte liste : familles ouvertes, questions posées, réponses obtenues, décisions figées. Tu passes à `skillenforce-task` quand les éléments encore ouverts ne changent plus ni l'architecture, ni les données, ni les tâches, ni les tests, ni l'UX, ni l'exploitation.

## Pièges

- Poser une question de confort sur ce qui est déjà écrit dans la demande.
- Poser six questions là où la frontière en autorise cinq.
- Interroger sur le style ou sur le détail d'exécution.
- Enchaîner les salves sans relire les réponses pour recalculer la frontière.
- Écrire les questions en prose au lieu d'ouvrir le tableau interactif.
