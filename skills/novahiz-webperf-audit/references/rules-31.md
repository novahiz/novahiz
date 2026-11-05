# Les 31 règles — détection, coût, effort

Ce fichier est la source du verdict. Pour chaque règle : comment la constater dans ce projet, quand elle est sans objet, ce qu'elle coûte à l'utilisateur, et son effort de correction.

## Comment lire une règle

```
### N · Titre
Détecte     la preuve à chercher, avec la commande ou le motif exact
Sans objet  la condition positive qui autorise à sortir la règle du périmètre
Coût        ce que l'utilisateur paie aujourd'hui, en une phrase
Effort      XS (moins d'une heure) · S (une demi-journée) · M (une à deux journées) · L (plus)
Impact      portée · fréquence · criticité, de 1 à 3 (voir le barème en fin de fichier)
```

**« Sans objet » exige une preuve positive.** Pas de base de données dans le projet, pas de trafic public, pas de tâche lente : c'est un fait constatable. « Je n'ai pas trouvé » n'est pas « sans objet » — dans ce cas le verdict est `à vérifier`.

**Aucune règle ne se déclare appliquée sans localisation.** Un `fichier:ligne`, une commande et sa sortie, une mesure. Le code qui « a l'air » d'appliquer la règle ne compte pas.

## Couche 1 — Rendu et perception

### 1 · Écrans de chargement en squelette
- **Détecte** : `grep -rnE "CircularProgress|Spinner|Loader2|<Loader|activity-indicator" src` ; comparer avec la présence de composants de squelette (`Skeleton`, `shimmer`, `placeholder`).
- **Sans objet** : aucune vue ne charge de données distantes (page statique, formulaire pur).
- **Coût** : un spinner plein écran rend l'attente plus longue qu'elle n'est ; l'utilisateur voit un écran vide alors que la structure est déjà connue.
- **Effort** : S (squelette par écran, pas global). **Impact** : 3 · 3 · 1.

### 14 · Interface optimiste
- **Détecte** : lister les mutations (POST/PATCH/DELETE) déclenchées par un clic et vérifier si l'état local change avant la réponse. Chercher `onMutate`, `optimistic`, `useOptimistic`, ou un `await fetch` qui garde l'ancien état jusqu'à la résolution.
- **Sans objet** : aucune action dont le résultat est prévisible côté client (paiement, suppression irréversible avec confirmation serveur).
- **Coût** : 200 à 600 ms d'attente perçue sur chaque action courante, alors que le résultat était certain.
- **Effort** : M (rollback à écrire). **Impact** : 2 · 2 · 1.

### 20 · Rendu côté serveur ou au build
- **Détecte** : `grep -rn "use client" src | wc -l`, présence de `getServerSideProps`, `generateStaticParams`, `export const dynamic`, `loader`, `+page.server.ts` ; vérifier si le HTML initial contient le contenu principal (`curl -s URL | grep -c "<h1"`).
- **Sans objet** : application derrière authentification où aucune page n'est indexable ni partageable (dashboard interne), ou contenu personnalisé par utilisateur dès le premier octet.
- **Coût** : le navigateur télécharge le JS, l'exécute, puis appelle l'API avant d'afficher quoi que ce soit ; le premier écran utile arrive 1 à 3 s plus tard.
- **Effort** : L (change l'architecture de rendu). **Impact** : 3 · 3 · 2.

### 23 · Longues listes virtualisées
- **Détecte** : chercher `.map(` dans un composant de liste et l'absence de `react-window`, `react-virtualized`, `@tanstack/react-virtual`, `virtua`, `FlashList`, `ListView.builder` ; estimer la taille de la source (pagination serveur ou non).
- **Sans objet** : aucune liste ne dépasse quelques dizaines de lignes, ou la pagination serveur plafonne déjà à 50.
- **Coût** : au-delà de quelques centaines de lignes, le scroll saccade sur téléphone et la mémoire du navigateur grimpe.
- **Effort** : S. **Impact** : 1 · 2 · 1.

### 26 · Pas de re-renders inutiles
- **Détecte** : contexte global qui porte un état changeant souvent, props objets recréées à chaque rendu, absence de `memo`/`useMemo`/`useCallback` sur les composants lourds ; mesurer avec le Profiler React avant d'affirmer.
- **Sans objet** : interface sans état fréquent (page de contenu).
- **Coût** : des interactions qui répondent en 100 ms pourraient répondre en 15 ms ; sur mobile bas de gamme, la différence se sent au clavier.
- **Effort** : M. **Impact** : 2 · 2 · 1.

## Couche 2 — Données et requêtes

### 3 · Pas d'appels API en double
- **Détecte** : `scripts/scan-perf.mjs` liste les URL littérales passées à `fetch`/`axios` et signale celles qui apparaissent dans plusieurs fichiers ; vérifier la présence d'un cache de requêtes (`@tanstack/react-query`, SWR, RTK Query, Apollo).
- **Sans objet** : aucune donnée partagée entre composants.
- **Coût** : deux à quatre requêtes identiques au montage, donc du temps serveur et un premier écran plus lent.
- **Effort** : S. **Impact** : 3 · 2 · 1.

### 4 · Debounce sur la recherche et l'autocomplétion
- **Détecte** : composant d'input dont `onChange` appelle directement une fonction réseau ; absence de `debounce`, `useDebounce`, `useDeferredValue`.
- **Sans objet** : recherche purement locale (filtre sur une liste déjà chargée).
- **Coût** : une requête par frappe, soit 8 à 12 appels pour une saisie de 10 caractères, sur un serveur qui n'en avait pas besoin.
- **Effort** : XS. **Impact** : 2 · 2 · 1.

### 5 · Résultats d'API paginés
- **Détecte** : `findMany(`/`select(` sans `take`/`limit`, endpoints qui renvoient une table entière, absence de `page`/`cursor` dans les routes de liste.
- **Sans objet** : aucune route de liste (site vitrine, application mono-enregistrement).
- **Coût** : la première réponse porte toute la table ; elle grossit chaque mois jusqu'à devenir inutilisable sur mobile.
- **Effort** : M. **Impact** : 2 · 2 · 2.

### 8 · Requêtes N+1 corrigées
- **Détecte** : boucle qui contient un accès base (`for (...) { await prisma.… }`), relation chargée en lazy sans `include`/`with`, activer les logs de requêtes et compter sur une page de liste.
- **Sans objet** : aucun ORM ni accès base.
- **Coût** : 50 requêtes pour afficher 50 lignes, soit 10 à 40 fois le temps de réponse attendu.
- **Effort** : S. **Impact** : 2 · 3 · 2.

### 16 · Requêtes indépendantes en parallèle
- **Détecte** : `await` successifs sur des appels sans dépendance entre eux, dans la même fonction ; comparer avec `Promise.all`/`Promise.allSettled`.
- **Sans objet** : un seul appel par écran.
- **Coût** : deux allers-retours de 150 ms coûtent 300 ms au lieu de 150.
- **Effort** : XS. **Impact** : 2 · 2 · 1.

### 24 · Seulement les colonnes utiles
- **Détecte** : `grep -rniE "select \*|select\(\*\)|SELECT \*" --include=*.ts --include=*.sql --include=*.py .`
- **Sans objet** : aucune requête SQL écrite à la main et ORM configuré en sélection explicite.
- **Coût** : transporter des colonnes inutiles, parfois des blobs, sur chaque ligne et chaque requête.
- **Effort** : XS. **Impact** : 2 · 3 · 1.

### 25 · Pool de connexions à la base
- **Détecte** : `new Pool`/`new Client`/`createConnection` instancié dans un handler ou une fonction de route au lieu du module ; en serverless, absence de pooler (PgBouncer, Neon, Supabase pooler).
- **Sans objet** : aucune connexion base depuis le code applicatif (base accédée uniquement par un service tiers).
- **Coût** : une connexion ouverte par requête ; sous charge, la base refuse les connexions et la page tombe en erreur.
- **Effort** : XS. **Impact** : 2 · 3 · 2.

## Couche 3 — Cache et traitement serveur

### 7 · Tâches lentes en file de jobs
- **Détecte** : envoi de mail, génération de PDF/export, appel IA déclenchés dans le handler d'une requête HTTP ; présence ou absence de `bullmq`, `bull`, `sqs`, `qstash`, `trigger.dev`, `inngest`.
- **Sans objet** : aucune tâche dépassant quelques centaines de millisecondes.
- **Coût** : la requête attend l'envoi du mail ou la génération ; l'utilisateur fixe un spinner pour un travail qui n'a pas besoin de lui.
- **Effort** : M. **Impact** : 2 · 1 · 2.

### 10 · Cache Redis sur les données chaudes
- **Détecte** : requêtes lues à chaque visite et modifiées rarement (catalogue, configuration, agrégats), sans couche de cache ; présence de `redis`, `ioredis`, `upstash`.
- **Sans objet** : site statique, ou données personnalisées à chaque requête.
- **Coût** : chaque visite recalcule la même chose ; le coût se voit en facture et en latence sous charge.
- **Effort** : M (invalidation à définir). **Impact** : 2 · 2 · 1.

### 17 · Index en base pour les requêtes fréquentes
- **Détecte** : colonnes utilisées en `where`/`orderBy` dans le code, comparées aux index du schéma ou des migrations ; `EXPLAIN` sur la requête la plus fréquente.
- **Sans objet** : aucune base relationnelle, ou tables de moins de quelques milliers de lignes.
- **Coût** : un scan complet sur chaque filtre ; la page ralentit à mesure que la table grossit, sans que le code ait changé.
- **Effort** : XS. **Impact** : 2 · 3 · 2.

## Couche 4 — Réseau et livraison

### 2 · Images en WebP ou AVIF, tailles adaptées
- **Détecte** : `scripts/scan-perf.mjs --images` liste les `.jpg`/`.png` du projet avec leur poids ; chercher `sharp`, `squoosh`, `next/image`, `nuxt-img`, `srcset`.
- **Sans objet** : aucune image matricielle (interface texte, icônes SVG uniquement).
- **Coût** : une image de 1 Mo non optimisée coûte 1 à 3 s de LCP sur mobile 4G. WebP fait 25 à 35 % de moins qu'un JPEG équivalent, AVIF jusqu'à 50 % — pas 2 à 3 fois, sauf cas favorable.
- **Effort** : S (pipeline de build) ou XS si le framework le fait déjà. **Impact** : 3 · 3 · 2.

### 6 · Fichiers statiques sur un CDN
- **Détecte** : cible de déploiement (Vercel, Netlify, Cloudflare, S3+CloudFront) et en-têtes de réponse (`curl -sI URL/asset.js | grep -i "cf-cache\|x-cache\|age"`).
- **Sans objet** : usage local, intranet, ou trafic négligeable.
- **Coût** : chaque utilisateur télécharge depuis un serveur unique ; 100 à 300 ms de plus par fichier selon la distance.
- **Effort** : XS si la plateforme le fait, sinon S. **Impact** : 3 · 3 · 2.

### 9 · Compression Brotli ou gzip
- **Détecte** : `curl -sI -H "Accept-Encoding: br,gzip" URL | grep -i content-encoding` ; côté code, `compression` (Express), `next.config` (actif par défaut), `gzip on` (nginx).
- **Sans objet** : aucune réponse textuelle servie par l'application auditée.
- **Coût** : du HTML, du JS et du JSON envoyés bruts, souvent 3 à 5 fois plus lourds.
- **Effort** : XS. **Impact** : 3 · 3 · 2.

### 11 · Dépendances inutiles supprimées
- **Détecte** : `npx knip` ou `npx depcheck` ; repérer les paquets lourds et redondants (`moment`, `lodash` entier, `chart.js`, grosses bibliothèques d'icônes) ; comparer avec la taille du bundle.
- **Sans objet** : aucune dépendance front au-delà du framework.
- **Coût** : chaque kilo-octet de JS est téléchargé, analysé et exécuté sur le téléphone de l'utilisateur.
- **Effort** : S. **Impact** : 3 · 3 · 1.

### 15 · Lazy load des images sous l'écran
- **Détecte** : `<img` sans `loading="lazy"` hors zone visible, absence de `next/image` ou équivalent ; `scripts/scan-perf.mjs` liste les lignes.
- **Sans objet** : une seule image par page, ou images toutes dans le premier écran.
- **Coût** : les images du bas de page retardent celles du haut, sur un forfait mobile mesuré.
- **Effort** : XS. **Impact** : 3 · 3 · 1.

### 21 · Scripts tiers chargés après la page
- **Détecte** : balises `<script>` d'analytics, chat, pixel sans `async`/`defer`, ou chargées dans le `<head>` du layout ; chercher `gtag`, `hotjar`, `intercom`, `fbq`, `clarity`.
- **Sans objet** : aucun script tiers.
- **Coût** : un script tiers lent bloque le rendu ; l'utilisateur attend un service qui ne le concerne pas.
- **Effort** : XS. **Impact** : 3 · 3 · 1.

### 22 · JavaScript découpé par page
- **Détecte** : présence de `dynamic(`, `React.lazy`, `import(` dynamique pour les routes ; absence de découpage = un bundle unique pour tout le site (`next build` affiche la taille par route).
- **Sans objet** : application à une seule page.
- **Coût** : la page d'accueil télécharge le code du dashboard, de l'éditeur et des paramètres.
- **Effort** : S. **Impact** : 2 · 2 · 1.

### 27 · Cache navigateur sur les fichiers statiques
- **Détecte** : `curl -sI URL/_next/static/… | grep -i cache-control` ; chercher `immutable`, `max-age`, `Cache-Control` dans la config d'hébergement.
- **Sans objet** : aucun asset versionné, tout étant servi à la volée.
- **Coût** : les fichiers déjà vus sont retéléchargés à chaque visite, et le retour arrière sur le site repart de zéro.
- **Effort** : XS. **Impact** : 3 · 3 · 1.

### 29 · Polices auto-hébergées, deux graisses, WOFF2
- **Détecte** : `@import url(fonts.googleapis…)`, fichiers `.ttf`/`.otf`/`.woff` servis, nombre de `font-weight` déclarés ; `scripts/scan-perf.mjs` compte les graisses.
- **Sans objet** : aucune police personnalisée.
- **Coût** : une connexion DNS+TLS supplémentaire vers un domaine tiers, plus 100 à 400 Ko de polices inutilisées.
- **Effort** : S. **Impact** : 3 · 3 · 1.

## Couche 5 — Résilience et infra

### 12 · Timeouts sur les API externes
- **Détecte** : appels `fetch`/`axios` sans `AbortSignal.timeout`, `signal`, ni `timeout` ; `scripts/scan-perf.mjs` les compte.
- **Sans objet** : aucun appel réseau sortant.
- **Coût** : une API tierce lente bloque la page jusqu'au timeout du serveur, parfois 30 s, au lieu d'échouer proprement en 2 s.
- **Effort** : XS. **Impact** : 2 · 1 · 2.

### 13 · Réponses de l'IA en streaming
- **Détecte** : endpoint qui attend la réponse complète du modèle avant de renvoyer ; absence de `stream`, `ReadableStream`, `text/event-stream`.
- **Sans objet** : aucune fonctionnalité IA.
- **Coût** : 5 à 20 s d'écran figé avant le premier mot, alors que le premier token arrive en moins d'une seconde.
- **Effort** : S. **Impact** : 1 · 1 · 1.

### 18 · Traces OpenTelemetry sur le backend
- **Détecte** : présence de `@opentelemetry/*`, `dd-trace`, `sentry` avec tracing, ou d'un APM ; sinon, aucun moyen de savoir quelle requête est lente.
- **Sans objet** : aucun backend propre (site statique, BaaS seul).
- **Coût** : pas de coût utilisateur direct ; le coût est l'aveuglement — chaque régression met des jours à être localisée.
- **Effort** : M. **Impact** : 1 · 1 · 1.

### 19 · Serveurs près de la base
- **Détecte** : région du déploiement (`vercel.json`, `fly.toml`, variables d'environnement, Dockerfile) comparée à celle de la base (connection string, console de l'hébergeur).
- **Sans objet** : base locale sur la même machine, ou SQLite embarqué.
- **Coût** : chaque aller-retour base paie la distance ; un écran qui fait 5 requêtes ajoute 250 ms à 1 s.
- **Effort** : XS (changer une région) ou L (migrer la base). **Impact** : 3 · 3 · 2.

### 28 · Load balancing sur plusieurs instances
- **Détecte** : nombre d'instances déclarées (k8s `replicas`, `docker-compose`, config plateforme) face au trafic supposé.
- **Sans objet** : une seule instance suffit, ou le trafic est confidentiel.
- **Coût** : sans répartition, une instance saturée dégrade toutes les pages en même temps ; avec, la panne d'une instance est invisible.
- **Effort** : M (sessions, cache, jobs à rendre partageables). **Impact** : 1 · 1 · 1.

## Couche 6 — Mesure

### 30 · Monitoring de la vitesse réelle
- **Détecte** : présence de `web-vitals`, `@vercel/speed-insights`, `sentry` performance, RUM maison ; un dashboard CrUX existe pour tout site public.
- **Sans objet** : aucun utilisateur réel (prototype non déployé).
- **Coût** : sans mesure réelle, on optimise le laboratoire ; les utilisateurs sur mobile et réseau moyen restent lents sans que personne ne le voie.
- **Effort** : S. **Impact** : 3 · 3 · 1.

### 31 · Tests sur téléphone lent et réseau lent
- **Détecte** : trace Lighthouse mobile (4x CPU, réseau bridé), test Playwright avec throttling CDP, ou absence de toute mesure en conditions dégradées.
- **Sans objet** : application non web.
- **Coût** : un écran qui répond en 1 s sur un MacBook répond en 3 à 5 s sur un téléphone d'entrée de gamme ; sans test, la régression est livrée.
- **Effort** : XS (profil enregistré, rejoué). **Impact** : 1 · 1 · 1.

## Barème d'impact

| Dimension | 1 | 2 | 3 |
|---|---|---|---|
| Portée | une page secondaire | un parcours clé | toutes les pages |
| Fréquence | usage rare | usage courant | chaque visite |
| Criticité | hors chemin critique | ralentit le parcours | sur le chemin critique (LCP, paiement, recherche) |

`score = portée × fréquence × criticité / effort`, avec effort XS=1, S=2, M=3, L=4.

Les valeurs par défaut ci-dessus servent de point de départ. Elles se corrigent avec les faits du projet : une règle déjà appliquée ne se classe pas, une règle sans objet ne se classe pas, et une règle dont l'impact est surestimé par le contexte local redescend. Un score recopié sans ajustement est un score inventé.

## Classement par défaut

| Rang | Règles |
|---|---|
| 1 | 9, 6, 19 |
| 2 | 25 |
| 3 | 2, 15, 21, 27, 29 |
| 4 | 8, 17, 24 |
| 5 | 1, 11, 20, 30 |
| 6 | 4, 12, 16 |
| 7 | 3, 5 |
| 8 | 14, 22, 23, 26 |
| 9 | 7, 10 |
| 10 | 13, 28, 18, 31 |

Ce tableau n'est qu'un ordre de grandeur : le classement remis à l'utilisateur se recalcule sur les faits du projet, règle par règle.
