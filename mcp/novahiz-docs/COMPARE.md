# A/B interne : novahiz-docs vs context7

Comparaison réalisée le 04/10/2026 (environ 10 h 38–10 h 41 locales) avec un
harnais identique des deux côtés : processus stdio, `initialize` legacy,
`tools/list`, puis les équivalents de résolution et de lecture chronométrés au
round-trip.

**Usage interne uniquement.** Le contrat de context7 interdit de publier des
benchmark : ce document sert à décider chez nous, pas à être diffusé.

## Méthode

- Même script (`ab-docs.mjs`, Temp opencode) pour les deux serveurs.
- Côté context7 : `npx -y @upstash/context7-mcp@4.1.1 --transport stdio`
  (l'entrée exacte d'`opencode.jsonc`).
- Côté novahiz-docs : `node mcp/novahiz-docs/index.mjs`, index local
  `data/index.sqlite` (rempli par l'ingestion du jour : react 28 passages,
  typescript 5).
- Requêtes : trouver `react`, lire `useState`.
- context7 relancé deux fois pour distinguer un raté d'un état stable.

## Mesures

| Étape | context7 (run 1 / run 2) | novahiz-docs (run 1 / run 2) |
|---|---|---|
| `initialize` (démarrage) | 2 680 ms / 2 348 ms | 89 ms / 97 ms |
| `tools/list` | 1,8 ms / 1,4 ms | 0,7 ms / 0,3 ms |
| résolution (`resolve-library-id` / `find_library`) | 6 418 ms / 10 528 ms → **erreur** | 10,1 ms / 12,1 ms → `react` |
| lecture (`query-docs` / `read_docs`) | indisponible / 124 caractères sans URL | 2,1 ms / 2,6 ms (interne 1,1 ms) |
| citation retournée | aucune | `react.dev/llms.txt`, licence MIT, `headingPath`, `fetchedAt` |

Les deux runs context7 ont échoué de la même façon :

```
Error searching libraries: TypeError: fetch failed
```

Son serveur hébergé était injoignable depuis cette machine pendant toute la
fenêtre de mesure, alors que le réseau sortant général fonctionnait (l'ingestion
react.dev de la même session, 20 minutes plus tôt, a réussi). La lecture
`query-docs` n'a donc rien pu documenter de citable (124 caractères, aucune
URL).

## Lecture structurelle

| Axe | context7 | novahiz-docs |
|---|---|---|
| Exécution | npx (≈ 2,3 s) + backend hébergé | fichier local, zéro dépendance |
| Réseau | obligatoire pour toute réponse | aucune (FTS5 local), ingestion dédiée |
| Clés / quota | quota annoncé 1 000 req/mois (recherche) | aucun, aucune limite |
| Catalogue | très large, hébergé | bouquet curé de 51 librairies |
| Citation | dépend du backend | obligatoire par passage (origine, licence, horodatage) |
| Respect des sources | à la charge du service | robots.txt (RFC 9309) + `Content-Signal` vérifiés à l'ingestion |
| Protocole | ère unique | double-ère (`initialize` + `server/discover`) |
| Code | coquille MIT, service privé | original maison, testé (62/62) |

## État de l'art (relevé du 04/10/2026)

Concurrents retenus au clarify produit et par les recherches A/B/C :

- **mandex** (mandex.dev, chonkie-inc) — le concurrent le plus proche de
  l'axe choisi. Registre de *packages* de documentation : l'auteur publie un
  index SQLite/FTS5 compressé, l'agent le télécharge (`mx pull`) puis cherche
  localement (40 ms annoncées, BM25 + reranking neuronal local, épinglage de
  version, mode MCP via `mx serve`). Forces : pinglage de version exacte,
  volant d'enregistrement auteur→outil. Dépendance assumée : le registre et le
  CDN tiers de mandex, et la publication par les auteurs. novahiz-docs prend
  l'autre branche : ingestion directe des sources primaires
  (`llms.txt` → raw → sitemap), aucun registre intermédiaire, aucune
  dépendance hors le dépôt source lui-même, licence relevée et citée par
  passage.
- **context7** (cloud MCP) — mesuré ci-dessus. Le free tier recule d'année en
  année (de ~6 000 à 500 req/mois selon mandex, ~1 000/mois dans nos relevés
  propres), et son ToS interdit les benchmarks publics.
- **@neuledge/context**, **Docfork** — MCP locaux ou hébergés indexant des
  dépôts git (couverture large, reconstruction par chaque utilisateur).
- **ContextMCP**, **docs-mcp-server** — alternatives auto-hébergées fondées
  sur des embeddings (OpenAI/Pinecone/Ollama) : puissant, mais clés API et
  infrastructure au prix du zéro friction.

Leçons des recherches retenues dans la chaîne d'ingestion : AGPL (Firecrawl)
exclu pour éviter toute contamination de licence, MDN (CC-BY-SA) non retenu
comme source primaire, spécification `llms.txt` sous Apache-2.0 compatible,
GitHub raw lu en lecture seule conformément à la clause de réciprocité IA des
ToS.

## Verdict pour cette machine

Sur l'axe du zéro friction, le seul retenu pour v1, novahiz-docs gagne de
facture : il répond en millisecondes quand l'autre dépend d'un backend qui
pouvait être absent. context7 conserve un avantage réel quand son service
répond : la largeur de son catalogue — la nôtre est volontairement fermée à 51
entrées.

Les comparaisons ci-dessus sont internes ; rien de ce document ne doit être
republié comme benchmark public.
