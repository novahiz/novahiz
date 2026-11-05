# Mesurer avant et après

Les règles 30 et 31 ne se devinent pas. Ce fichier donne les commandes, et ce qu'une valeur veut dire.

## Seuils de référence (Core Web Vitals, mobile, p75)

| Métrique | Bon | À corriger | Mauvais |
|---|---|---|---|
| LCP | < 2,5 s | 2,5 à 4,0 s | > 4,0 s |
| INP | < 200 ms | 200 à 500 ms | > 500 ms |
| CLS | < 0,1 | 0,1 à 0,25 | > 0,25 |
| TTFB | < 800 ms | 800 ms à 1,8 s | > 1,8 s |

Ces seuils sont ceux du terrain (75e percentile des visites réelles), pas du laboratoire. Un Lighthouse à 95 sur un laptop ne dit rien du téléphone d'entrée de gamme.

## Laboratoire : Lighthouse, profil mobile

```bash
npx lighthouse "<url>" --only-categories=performance \
  --form-factor=mobile --throttling-method=simulate \
  --output=json --output-path=./lh-before.json \
  --chrome-flags="--headless=new"
```

Sur une application locale, lancer d'abord le serveur de production (`next build && next start`, `vite build && vite preview`). Mesurer un serveur de développement fausse tout : il n'est ni minifié ni compressé.

## Données réelles : PageSpeed Insights / CrUX

```bash
curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<url>&strategy=mobile" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify(j.loadingExperience?.metrics??j.originLoadingExperience?.metrics,null,2))})"
```

Sans données CrUX (site récent ou peu visité), le champ revient vide : noter `non mesurée`, pas `bonne`.

## Réseau bridé et CPU bridé : Playwright

```js
const client = await context.newCDPSession(page);
await client.send("Network.enable");
await client.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,   // 1,6 Mbps
  uploadThroughput: (750 * 1024) / 8,             // 750 kbps
});
await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
```

Chronométrer au minimum : navigation complète, première interaction utile, et la même interaction sous throttling. C'est la seule façon de reproduire la règle 31.

## En-têtes d'une réponse

```bash
curl -sI -H "Accept-Encoding: br,gzip" "<url>/"            | grep -iE "content-encoding|cache-control|age|cf-cache"
curl -sI "<url>/_next/static/chunks/<fichier>.js"          | grep -iE "cache-control|age|x-cache|cf-cache"
```

- `content-encoding: br` ou `gzip` → règle 9 appliquée.
- `cache-control: public, max-age=31536000, immutable` sur un fichier versionné → règle 27 appliquée.
- `age` ou `x-cache: HIT` → la réponse traverse un cache (règle 6 probablement appliquée).

## Poids du JavaScript

```bash
npx next build          # tableau taille par route
npx vite build          # puis npx vite-bundle-visualizer
npx source-map-explorer "dist/**/*.js"
npx knip                # dépendances et exports non utilisés
npx depcheck
```

Le chiffre qui compte est le JS **transféré** sur la page auditée, compression comprise, pas la somme de tous les chunks du projet.

## Images

```bash
node skills/novahiz-webperf-audit/scripts/scan-perf.mjs --images --root .
du -sh public/images 2>/dev/null || true
```

Une image au-dessus de 200 Ko affichée en 400 px de large est un défaut, quel que soit son format.

## Base de données

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ... ;   -- PostgreSQL
```

Un `Seq Scan` sur une table de plus de quelques milliers de lignes, sur une colonne filtrée, signale un index manquant (règle 17). Côté ORM, activer le log des requêtes sur une page de liste : 50 requêtes pour 50 lignes, c'est un N+1 (règle 8).

## Après chaque correction

1. Rejouer la même mesure, même profil, même page, même machine.
2. Consigner avant / après dans le journal du rapport.
3. Vérifier qu'aucune autre métrique n'a régressé : gagner 300 ms de LCP en cassant le CLS n'est pas un gain.
4. Si la métrique ne bouge pas, la correction ne compte pas : soit elle est inutile ici, soit elle n'a pas été déployée.
