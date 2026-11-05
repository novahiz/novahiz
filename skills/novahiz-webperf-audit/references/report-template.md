# Gabarit de rapport

Le rapport se remet en entier avant toute modification. Il tient en trois blocs, dans cet ordre.

## 1. Ligne de base

```
## Ligne de base
| Métrique | Valeur | Source |
|---|---|---|
| LCP mobile (4G, CPU 4x) | 4,2 s | lighthouse --preset=desktop? non : --form-factor=mobile |
| CLS | 0,18 | idem |
| INP (labo, proxy) | 320 ms | trace Playwright |
| JS transféré (page d'accueil) | 780 Ko | next build / vite build |
| TTFB | 640 ms | curl -w |
| Requêtes au premier écran | 14 | onglet réseau |
| Utilisateurs réels (CrUX 28 j) | LCP p75 4,8 s | PageSpeed Insights |
```

Une métrique non mesurable se note `non mesurée` avec la raison. Jamais une estimation présentée comme une mesure.

## 2. Verdict des 31 règles

```
| # | Règle | Verdict | Fichier concerné | Coût pour l'utilisateur |
|---|---|---|---|---|
| 1 | Écrans de chargement en squelette | absente | src/screens/Orders.tsx:41 | un spinner plein écran rend l'attente plus longue qu'elle n'est |
| 2 | Images WebP ou AVIF | absente | public/hero.jpg (1,4 Mo) | 1 à 3 s de LCP sur mobile 4G |
| 3 | Pas d'appels API en double | appliquée | src/api/queries.ts:12 | — |
| 8 | Requêtes N+1 | sans objet | — | aucune base dans ce projet |
| 30 | Monitoring réel | à vérifier (faible) | — | non constatable sans accès au déploiement |
```

Valeurs autorisées : `appliquée`, `absente`, `sans objet (raison)`, `à vérifier (confiance)`.

Règles :
- une ligne par règle, les 31, jamais un sous-ensemble ;
- `appliquée` et `absente` portent toujours un `fichier:ligne` ou une commande avec sa sortie ;
- `sans objet` porte un fait constatable, pas une absence de recherche ;
- `à vérifier` est préférable à un verdict inventé.

## 3. Classement

```
## Classement par rentabilité

| Rang | # | Règle | Score | Effort | Ce que ça change |
|---|---|---|---|---|---|
| 1 | 9 | Compression Brotli | 18 | XS | 60 à 70 % de HTML et JS en moins |
| 2 | 25 | Pool de connexions | 12 | XS | plus de refus de connexion sous charge |
| 3 | 2 | Images WebP | 9 | S | 1 à 3 s de LCP |

Score = portée × fréquence × criticité / effort, calculé sur les faits du projet.
```

Puis une phrase par règle retenue : ce qui sera touché, et comment on saura que ça a marché.

## 4. Le point d'arrêt

```
## En attente de validation

Je ne modifie rien avant ton accord. Trois façons de continuer :
- « fais 1 à 3 » : je corrige ces rangs, un par un, avec preuve après chacun ;
- « tout sauf X » : je garde le classement, j'écarte X ;
- « audit seul » : je m'arrête ici, rien n'est modifié.

Rappel : chaque correction passe par build + tests + re-mesure de la métrique visée.
```

Le point d'arrêt se pose dans l'interface (question), pas seulement en prose. Tant qu'aucune réponse n'est revenue, aucune édition n'a lieu.

## 5. Journal des corrections

Une entrée par règle corrigée, ajoutée au fur et à mesure :

```
### R9 · Compression Brotli — corrigée
- Fichiers : vercel.json:12, next.config.mjs:4
- Preuve : curl -sI -H "Accept-Encoding: br" URL → content-encoding: br
- Mesure avant / après : JS transféré 780 Ko → 240 Ko ; LCP 4,2 s → 3,1 s
- Régression : aucune, tests 42/42 verts
- Rollback : revert de 2 fichiers, aucune migration
```

Une correction sans mesure avant/après n'est pas terminée : elle est en cours.
