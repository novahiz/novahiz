# Audit structure/code — Novahiz (`C:\Users\hiz\.config\novahiz`)

Compétence chargée : `code-standards`. Audit basé sur fichiers réels du repo (HEAD lu directement), sans simulation. Gate passé après chargement des compétences requises (`novahiz-plan`, `novahiz-clarify`, `novahiz-analyse`, `novahiz-implement`, `novahiz-converge`, `novahiz-task`, `novahiz-code-review`).

## Structure (vérifiée par `Get-ChildItem` et `Get-Content`)

| Dossier | État | Remarque (ligne réelle) |
|---|---|---|
| `src/` | ✅ 17 modules TS | `gate.ts`, `catalog.ts`, `cli.ts`, `spec.ts`, `ledger.ts`, `db.ts` |
| `tests/` | ✅ 29 fichiers `.test.ts` | `gate.test.ts`, `cli.test.ts`, `catalog.scan.test.ts` |
| `adapters/` | ✅ `adapters/opencode/` | `novahiz.ts` (plugin, 27 366 B) |
| `docs/` | ✅ 15 `.md` | `CONFIGURATION.md`, `RULES.md`, `GATE.md` |
| `catalog/` | ✅ 4 JSON | `categories.json` (28 165 B), `rules.json` (3 893 B) |
| `mcp/` | ✅ présent | `mcp/novahiz-tools/index.mjs` |
| `plugins/` | ❌ **absent du repo** | Référencé dans `docs/GATE.md` et `docs/audit-2026-09-25.md` ; seul `adapters/opencode/novahiz.ts` existe |

## Findings (id CODE-XXX, chemin + ligne réelle, impact, recommandation)

### Code / adapter

| Id | Fichier : ligne | Description (citée du fichier) | Impact | Recommandation |
|---|---|---|---|---|
| CODE-001 | `adapters/opencode/novahiz.ts:27-55` | Tableau `AR_EN` : regex avec `?????|????` (caractères corrompus / `?`). Aucune correspondance arabe possible. | Réécriture de prompt non fonctionnelle pour prompts non-anglais. | Restaurer `AR_EN` depuis `src/prompt-rewriter.ts` (source original non corrompu) ou supprimer le tableau dans l'adaptateur. |
| CODE-002 | `adapters/opencode/novahiz.ts:7-8` (commentaire) + `adapters/opencode/novahiz.ts` (structure) | Duplication explicite : « Inlined from src/prompt-rewriter.ts » et « Inlined from src/autodocs.ts ». L'adaptateur copie 3 modules source au lieu d'importer. | Dérive entre `src/` et `adapters/` (déjà signalée audit `audit-2026-09-25.md` : `plugins/novahiz.ts:INFO`). | Créer un module partagé (`shared/`) importé par le plugin, ou générer l'adaptateur au build au lieu de copier manuellement. |
| CODE-003 | `adapters/opencode/novahiz.ts:568-572` | Garde anti-traversal : `resolve()` non vérifié pour chemins absolus étrangers (`absolutePath`). | TOCTOU sur le répertoire `.novahiz`. | Appliquer la même validation `resolve()` + check `startsWith` avant `readFileSync`. |

### Architecture / pipeline gate (lignes confirmées par `docs/audit-2026-09-25.md` et lecture `src/gate.ts`)

| Id | Fichier : ligne (audit / source) | Description | Impact | Recommandation |
|---|---|---|---|---|
| CODE-004 | `src/gate.ts:280` (audit) + `src/gate.ts` (tier sur contenu édité) | Tier calculé sur le contenu édité et non sur le prompt → roadmap `plan` sautée quand l'édition est courte. | Pipeline gate `fail-open` : aucune exigence de compétence sur éditions courtes. | Corriger `tier` pour utiliser `spec` / `prompt` (pas `content`) dans `gate.ts`. |
| CODE-005 | `src/commands/gate.ts:48` (audit) | `gate.enabled: false` dans `novahiz.config.json` désactive tout sans barrière ni log visible. | Kill-switch silencieux, éditable par la même session protégée. | Exiger un second facteur (env `NOVAHIZ_GATE=off` + audit log obligatoire) même en mode désactivé. |
| CODE-006 | `src/spec.ts:137` (audit) | Index skills lu sous `**/build/**` (`build/installed-skills.json`) ; retrait d'un skill = `unmatchedRequired` jamais exigé. | 11 skills invisibles au gate (audit : `eas-*` ×7, `supabase`, etc.). | Déplacer l'index hors du répertoire `build/` ou ajouter un hash de vérification (`skills-lock.json` est vide : `docs/skills-lock.json` montre `{"version":1,"skills":{}}`). |

### Tests (29 fichiers, qualité vérifiée)

| Id | Fichier | Description | Impact | Recommandation |
|---|---|---|---|---|
| CODE-007 | `tests/gate.test.ts:24-42` | Assertions « vacuous » (`R1-docs` / `R1-code-prose`) corrigées : utilisation du vrai `rulesCatalog` (`catalog/rules.json`) et `humanizerRuleMatched`. | Les anciens tests passaient même sans règle correspondante. | Ajouter un test de régression sur `sessionID` vide (`audit: plugins/novahiz.ts:486`) et sur le chemin court (`CODE-004`). |
| CODE-008 | `tests/` (global) | Aucun test couvrant `adapters/opencode/novahiz.ts` (plugin copié) ; `tests/plugin.test.ts` et `tests/plugin.hygiene.test.ts` existent mais ne testent pas le contenu du plugin copié. | Couverture manquante sur le point d'entrée réel (`opencode.jsonc`). | Créer `tests/adapter.test.ts` qui charge `novahiz.ts`, vérifie `rewritePrompt` (arabe + anglais) et le comportement `fail-open`. |

### Docs / drift

| Id | Doc | Code / réalité | Écart | Recommandation |
|---|---|---|---|---|
| CODE-009 | `docs/GATE.md` et `docs/audit-2026-09-25.md` | Mentionnent le dossier `plugins/`. | `plugins/` n'existe pas dans le repo (`novahiz`) ; seul `adapters/opencode/novahiz.ts` existe. | Aligner la doc : soit créer `plugins/` et déplacer le plugin, soit mettre à jour toutes les références (`docs/GATE.md`, `docs/ARCHITECTURE.md`, `audit-2026-09-25.md`) pour pointer vers `adapters/opencode/`. |
| CODE-010 | `docs/CONFIGURATION.md` | `envEscape: "NOVAHIZ_GATE"` décrit comme non-configurable (conforme au code). | `docs/CONFIGURATION.md:envEscape` et `docs/GATE.md` sont cohérents entre eux. | Aucun écart fonctionnel — la doc est honnête sur la non-configurabilité du kill-switch. |
| CODE-011 | `docs/ARCHITECTURE.md` / `docs/CLASSIFICATION.md` | Décrivent le pipeline, la classification, le catalogue. | `catalog/categories.json` et `catalog/rules.json` existent et sont lus par `loadSpec` (`src/spec.ts`). | Conforme. Aucune action requise. |

## Architecture (pipeline, plugin, MCP)

- **Pipeline gate** (`src/gate.ts` + `src/commands/gate.ts`) : 3 failles critiques confirmées par audit existant (`docs/audit-2026-09-25.md` : 3 CRITICAL, 16 HIGH, 35 MEDIUM). Le gate échoue en `fail-open` sur classification vide, config éditable et index skills.
- **Plugin** (`adapters/opencode/novahiz.ts`) : duplique `prompt-rewriter.ts`, `autodocs.ts` et le catalogue inline. Le tableau `AR_EN` est corrompu (`CODE-001`). Aucune injection shell (`CWE-78` non applicable, conforme audit `plugins/novahiz.ts:INFO`).
- **MCP** (`mcp/`) : référencé dans `package.json` (`bin.novahiz-mcp`) ; `tests/mcp.test.ts` existe mais ne couvre pas le chemin `fail-open` (`sessionID` vide, `CODE-006`).

## Qualité tests (312 pass ?)

Le nombre « 312 pass » n'est pas directement vérifiable dans le repo (pas de sortie `npm test` enregistrée). L'audit existant (`docs/audit-2026-09-25.md`) indique 131 findings au total, dont plusieurs sur la qualité des tests (`vacous` corrigés). Les 29 fichiers `.test.ts` sont présents et `tests/gate.test.ts` montre des assertions réelles sur le catalogue (`CODE-007`). Recommandation : générer un rapport de test (`npm test`) et l'archiver dans `tests/results/`.

## 3 actions (priorisées)

1. **CODE-001 + CODE-002 (adapter)** : réparer le tableau `AR_EN` corrompu (`adapters/opencode/novahiz.ts:27-55`) et remplacer la duplication inline (`novahiz.ts:7-8`) par un import partagé vers `src/` (ou générer l'adaptateur au build).
2. **CODE-004 (gate)** : corriger le calcul du tier dans `src/gate.ts` (utiliser `spec` / prompt au lieu du contenu édité) et ajouter un test `tests/gate.test.ts` couvrant le chemin court (`CODE-007`).
3. **CODE-009 (docs / structure)** : aligner la documentation (`docs/GATE.md`, `docs/ARCHITECTURE.md`, `docs/audit-2026-09-25.md`) avec la structure réelle : soit créer `plugins/` et y déplacer le plugin, soit mettre à jour toutes les références pour pointer vers `adapters/opencode/`.

---
*Rapport généré depuis `C:\Users\hiz\.config\novahiz`. Toutes les lignes citées proviennent des fichiers lus directement (`Get-Content`, `cat`) dans cette session. Aucune ligne simulée.*
