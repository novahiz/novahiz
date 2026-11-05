---
name: novahiz-webperf-audit
description: |
  Audit de performance web en 31 règles, avec verdict sourcé par règle, coût
  utilisateur, classement par rentabilité et point d'arrêt avant toute
  modification. Déclenché sur « performance », « lenteur », « c'est lent »,
  Lighthouse, Core Web Vitals, LCP/INP/CLS, bundle, images WebP/AVIF, cache
  HTTP, requêtes N+1, TTFB, ou demande d'audit de vitesse d'une application
  web. Différent de novahiz-wcag-audit (accessibilité), d'impeccable (qualité
  visuelle) et de novahiz-code-review (qualité du code) : celui-ci mesure et
  hiérarchise ce que l'utilisateur paie en secondes, puis corrige une règle à
  la fois avec preuve avant/après.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
---

# novahiz-webperf-audit

## Quand ce skill s'applique

L'utilisateur dit que l'application est lente, demande un audit de performance, un meilleur score Lighthouse, ou une revue de ce qui coûte des secondes. La catégorie `performance` le route automatiquement.

Il ne s'applique pas à l'accessibilité (`novahiz-wcag-audit`), à la qualité visuelle (`impeccable`), ni à la qualité du code (`novahiz-code-review`). Un audit de performance peut révéler un problème d'accessibilité : il se signale, il ne se corrige pas ici.

## La règle qui gouverne tout

**Aucune modification avant la validation du classement.** L'utilisateur a demandé un diagnostic et une priorisation ; il attend une liste, pas un chantier. Le skill produit le rapport complet, pose la question, et s'arrête. Tant que la réponse n'est pas revenue, le code ne bouge pas.

Une seule dérogation : l'utilisateur écrit explicitement « corrige tout » ou « fais les trois premiers ». Cette phrase est enregistrée dans le rapport comme validation.

## Les six phases

```
1. Mesurer       -> ligne de base réelle (labo + terrain si disponible)
2. Inventorier   -> stack, hébergement, base, file de jobs : ce qui peut être hors périmètre
3. Constater     -> verdict pour les 31 règles, avec preuve localisée
4. Classer       -> score de rentabilité, du plus rentable au moins rentable
5. Valider       -> question bloquante, aucune édition
6. Corriger      -> une règle par incrément, preuve et re-mesure après chacune
```

### 1. Mesurer avant de juger

Sans ligne de base, « rentable » est une opinion. Exécuter au minimum ce qui est possible :

```bash
node <skill>/scripts/scan-perf.mjs --root .          # constats statiques
npx lighthouse "<url>" --only-categories=performance --form-factor=mobile \
  --throttling-method=simulate --output=json --output-path=./lh-before.json
```

Les commandes de mesure, les seuils (LCP, INP, CLS, TTFB) et le bridage réseau/CPU sont dans [references/measure.md](references/measure.md). Une métrique non mesurable se note `non mesurée` avec sa raison : jamais une estimation déguisée en mesure.

### 2. Inventorier la stack

Le scanner renvoie un bloc `stack` (framework, backend, base, ORM, cache, file de jobs, IA, RUM, hébergement) et un bloc `applicability` par règle. Cet inventaire décide de ce qui est vraiment hors périmètre.

**« Sans objet » exige un fait constatable.** Pas de base détectée, pas de fonctionnalité IA, pas d'hébergement identifiable : c'est un fait. « Je n'ai pas trouvé » n'est pas « sans objet » — le verdict est `à vérifier`.

Un projet purement statique rend sans objet les règles 8, 17, 25 (base), 13 (IA), 7 (file de jobs si aucune tâche lente). Les règles 6, 19, 28 restent à vérifier si l'hébergement n'est pas visible dans le code.

### 3. Constater, règle par règle

Les 31 règles, leur méthode de détection, leur cas « sans objet », leur coût et leur effort par défaut vivent dans [references/rules-31.md](references/rules-31.md). Le scanner couvre les règles mécaniques ; les autres se lisent dans le code ou se mesurent.

Chaque verdict porte une preuve : `fichier:ligne`, commande et sa sortie, ou mesure. Un constat de confiance faible se vérifie avant d'être écrit comme `absente`.

### 4. Classer par rentabilité

```
score = portée × fréquence × criticité / effort
```

- portée : 1 page secondaire · 2 parcours clé · 3 toutes les pages
- fréquence : 1 rare · 2 courant · 3 chaque visite
- criticité : 1 hors chemin critique · 2 ralentit · 3 sur le chemin critique (LCP, paiement, recherche)
- effort : XS=1 · S=2 · M=3 · L=4

Une règle `appliquée` ou `sans objet` ne se classe pas. Les valeurs par défaut du référentiel se corrigent avec les faits du projet ; un classement recopié sans ajustement est un classement inventé. À score égal, la règle dont l'effet se mesure le mieux passe devant.

### 5. Valider

Le rapport complet se remet, puis la question se pose dans l'interface (`question`), jamais seulement en prose. Options concrètes : corriger les rangs proposés, corriger une sélection, rester en audit seul. Chaque option dit ce qui commence immédiatement.

Le gabarit exact du rapport (ligne de base, tableau des 31 verdicts, classement, point d'arrêt) est dans [references/report-template.md](references/report-template.md).

### 6. Corriger une règle à la fois

Pour chaque règle validée :

```
start -> correction minimale -> build + tests -> re-mesure -> journal -> règle suivante
```

- une seule règle par incrément, aucun lot ;
- la preuve est la métrique visée, pas l'impression que ça va mieux ;
- si la métrique ne bouge pas, la correction ne compte pas : la défaire ou l'expliquer ;
- si une autre métrique régresse (gagner du LCP en cassant le CLS), on revient en arrière ;
- chaque correction est réversible : pas de migration sans retour possible.

Une correction sans mesure avant/après reste `en cours`, jamais `terminée`.

## Ce que le rapport doit contenir

1. la ligne de base, avec la source de chaque chiffre ;
2. les 31 lignes de verdict, jamais un sous-ensemble ;
3. le classement chiffré, avec ce que chaque règle change ;
4. le point d'arrêt explicite ;
5. le journal des corrections, mis à jour au fil des incréments.

## Honnêteté

- Ne jamais annoncer une mesure non exécutée.
- Ne jamais transformer un indice de confiance faible en verdict ferme.
- Ne jamais promettre un gain chiffré avant de l'avoir mesuré.
- Dire quand l'application ne peut pas être mesurée (pas de build, pas d'URL, pas d'accès au déploiement) et proposer la mesure la plus proche possible.
- WebP réduit un JPEG de 25 à 35 %, AVIF jusqu'à 50 % : annoncer « 2 à 3 fois plus léger » sans mesure est faux.

## Pièges

- Corriger avant d'avoir classé : le chantier remplace le diagnostic.
- Mesurer un serveur de développement : aucune conclusion valable.
- Confondre absence de preuve et absence de problème.
- Proposer 31 corrections d'un coup : l'utilisateur en voulait trois.
- Optimiser le score Lighthouse sans regarder les utilisateurs réels (règle 30).
- Toucher au backend alors que la stack affichée est statique.

## Fichiers de ce skill

- [references/rules-31.md](references/rules-31.md) — les 31 règles, détection, coût, effort, barème
- [references/report-template.md](references/report-template.md) — forme exacte du rapport
- [references/measure.md](references/measure.md) — commandes de mesure, seuils, bridage
- [scripts/scan-perf.mjs](scripts/scan-perf.mjs) — constats déterministes, `--help` documenté
