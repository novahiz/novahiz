# Améliorations Novahiz — registre du 2026-10-31

Une ligne par défaut observé pendant la session admin (booking-website).
Une ligne n'est `done` que si `node --experimental-strip-types scripts/verify-improvements.mjs`
passe et si `npm test` reste vert.

Commandes de contrôle :

```bash
cd ~/.config/novahiz
npm test
npm run typecheck
node --experimental-strip-types scripts/verify-improvements.mjs
```

## Appliqué et vérifié

| ID | Symptôme observé | Correctif | Preuve |
|----|------------------|-----------|--------|
| NX-01 | Quatre skills design exigées pour un commentaire dans `navigation.ts` | Une règle `design-ui` ne s'applique plus aux fichiers non-interface (`.ts`, `.sql`, `.json`, `.md`) ; les sources d'interface (`.tsx`, `.vue`, `.dart`, `.swift`, `.css`) restent couvertes. Les skills purement design quittent aussi la roadmap quand le fichier est du code. | `verify-improvements` NX-01 et NX-01b ; suite 232/232 |
| NX-02 | `npm run typecheck` bloqué par le gate comme une écriture | `npm run typecheck`, `lint`, `check`, `verify`, `npx tsc --noEmit`, `npx eslint` (sans `--fix`) passent en lecture seule. `build`, `dev`, `test` et les scripts inconnus restent soumis au gate. | `verify-improvements` NX-02 |
| NX-18 | `novahiz_step` n'écrivait que sous une session, `close` en cherchait une autre | L'étape est écrite sous la session active, la session de la tâche et `default`. | Suite `roadmap-close` / `gate-alignment` verte |
| NX-05 / NX-13 | Aucun moyen d'écarter une étape non pertinente | `novahiz_step({ drop, reason })` écrit un statut `dropped`, et `close` compte `done` et `dropped`. Une raison est obligatoire. | Nouveau test `une etape droppee avec une raison ne bloque plus la fermeture` ; 232 tests verts |
| NX-44 | Le prompt citait un `todowrite` absent du catalogue | L'adaptateur OpenCode dit que le ledger `novahiz_task` est la liste durable, et qu'aucun outil absent ne doit être appelé. | `adapters/opencode/instructions.md` relu par l'hôte |
| NX-20 | Le refus de `close` ne disait pas quel scope avait été consulté | Le message nomme les scopes et donne la commande exacte pour le scope `default`. | Lecture de `src/ledger.ts` ; suite verte |
| NX-24 | `slot-067` pollué par le contenu messagerie | Fusion mémoire seulement sur un titre identique ou un `slotId` explicite ; un simple voisinage crée un nouveau slot. | Sonde : deux sujets distincts donnent deux slots, un titre identique met à jour le même slot |
| NX-25 | `slotId` inconnu renvoyait « slot inconnu » | Un `slotId` absent n'est plus une erreur : l'écriture crée un slot. | Sonde : `slotId: "slot-999"` crée le slot |
| NX-27 | Slots limités à 8 000 caractères / 200 lignes | 16 000 / 400, aligné dans `doctor`. | `verify-improvements` NX-27 ; typecheck |
| NX-34 | `Admin — Messages` classé « réglages » à cause du mot `admin` | `admin` retiré de la règle réglages, `messages`, `messagerie`, `inbox`, `conversation` ajoutés à la règle liste. | `verify-improvements` NX-34 |
| NX-12 | Une demande large armait le pipeline complet même pour une retouche de 300 caractères | Une édition de moins de 800 caractères sans `tier` explicite redescend en `lite` : les étapes de cadrage sortent, les étapes de domaine (implement, converge, revue) restent. Un `tier` passé à la main n'est jamais rétrogradé. | Probe CLI : `src/feature/paiement.ts`, 300 caractères → `tier: "lite"`, roadmap `feature`, étapes de cadrage absentes |
| NX-19 | `close` ne consultait que la session de la tâche et `default` | `close` consulte aussi la session passée en paramètre. | `roadmap-close` : l'étape écrite sous la session d'appel est retrouvée |
| NX-04 | Le message de blocage nommait les skills à charger sans jamais dire quel fichier l'avait déclenché | `mergeTargetReasons` remonte les raisons par cible dans le message court, dédoublonnées, avec le chemin seulement quand elles ne concernent pas toutes les cibles. | 6 tests `nx-targets-reasons` ; probe CLI : `reasons` passe de `[]` à deux lignes explicites |
| NX-16 / NX-17 | `novahiz_task action="new"` renvoyait la ligne brute : impossible de savoir sous quelle session les étapes seraient écrites, ni si le projet venait d'un argument ou du cwd | Le payload porte `session`, `sessionSource` (`argument`/`default-for-project`/`none`), `projectRoot` et `projectRootSource`. | Probe `--call novahiz_task` : `sessionSource: "argument"`, `projectRootSource: "cwd"` |
| NX-21 | `status`, `resume` et `current` partageaient une branche mais ne disaient ni quel alias avait répondu ni quel scope | Le payload commun porte `action`, `session` et `scope`. | Probe `--call` : `action: "status"`, `scope: "ses_probe_nx21"` |
| NX-48 | Le démon du gate laissait `process.exitCode = 2` après une requête qui lève : toutes les réponses suivantes étaient annoncées comme des refus, sans skill manquante ni raison, et toute écriture était refusée | `capture` vit dans `src/gate-capture.ts` et restaure le code de sortie dans le `finally`, donc même quand la commande lève. | 4 tests `gate-capture`, dont « une requête qui lève ne contamine pas la suivante » |
| NX-49 | `hasPlaceholder` lisait le spread JavaScript comme un marqueur de contenu : `[...existing]` bloquait une édition légitime | Les deux motifs d'ellipse exigent désormais une espace après les trois points ; un vrai « … existing code » reste détecté. | 2 tests `nx-targets-reasons` (spread refusé comme marqueur, marqueur réel détecté) |
| NX-39 | Le schéma MCP, la description de l'outil et la liste acceptée par le handler étaient trois littéraux : la description avait déjà perdu `history` | `TASK_ACTIONS` devient la source unique ; l'enum et la description en dérivent, le handler l'utilise. | 4 tests `mcp-task-actions` (enum = liste, chaque action décrite, unicité, `history` présent) |
| NX-41 | Rien n'obligeait une session à réclamer un chemin avant d'y écrire quand une autre session vivait sur le même projet | `gate.claims.required` (faux par défaut) refuse un chemin non réclamé dès qu'une autre session est vivante ; `claimedBy` expose le claim du demandeur. Le comportement solo ne change pas. | 5 tests `claims-required` : non réclamé refusé, réclamé accepté, défaut facultatif |
| NX-28 | L'index pouvait annoncer un titre ou un statut différents du frontmatter sans que rien ne le dise | `slotMetadataDrift` compare id, titre et statut entre l'index et chaque fichier ; `novahiz memory status` affiche une ligne « metadonnees ». | 2 tests `memory-frontmatter` ; `memory status` affiche « metadonnees: index et frontmatter d'accord » |
| NX-29 | `title: ${meta.title}` : un saut de ligne dans un titre injectait une clé (`status: archived`) dans le frontmatter, et une valeur `---` fermait le bloc | Les valeurs sont repliées sur une ligne, les caractères de contrôle retirés, et une valeur qui commence par `---` ou par un guillemet est citée puis déquotée à la lecture. | 3 tests `memory-frontmatter` : injection bloquée, `---` inerte, deux-points préservé |
| NX-42 | `supabase db push` ou `prisma migrate deploy` n'ont pas de chemin : le contrôle de claim ne les voyait jamais, deux sessions pouvaient appliquer la même migration | `migrationCommand` reconnaît les commandes qui écrivent le schéma ; `enforceLedgerChecks` reçoit le texte de la commande et exige, quand `gate.claims.required` est vrai et qu'une autre session vit sur le projet, un claim sur `supabase/migrations`. Une session seule n'est pas bloquée. | 6 tests `migration-lock` : détection, commandes de lecture laissées passer, session seule, refus sans claim, passage avec claim, claims désactivés |
| NX-50 | `novahiz memory status --dir <projet>` ignorait `--dir` en silence et lisait la mémoire canonique, en affichant son propre chemin | `--dir` est accepté comme alias de `--root` ; `--root` gagne, un désaccord est signalé sur stderr. | 5 tests `memory-root-flag` ; `memory status --dir <booking-website>` lit bien les 74 slots du projet au lieu des 6 de la maison |
| NX-43 | Un sous-agent ouvre sa propre session dans le même arbre : le gate le voyait comme un inconnu (claims refusés) ou comme un concurrent de son propre parent | Table `session_links` (schéma v7) et module `lineage.ts` ; l'adaptateur enregistre le lien quand il voit une délégation réussie (`novahiz_task action="link"`). Le gate calcule la famille : un claim détenu par un parent ou un enfant compte comme le sien, et un membre de la famille n'est pas une « autre session vivante ». | 7 tests `session-lineage` ; `--call` : `{"recorded":true}` ; doctor : schéma 7, copie du plugin à jour |
| NX-14 | Une revue portant des ajouts **et** un ordre calculé avant ces ajouts échouait : `reorderTodos` exigeait chaque todo exactement une fois | Les todos nés de la revue sont ajoutés à la fin de l'ordre demandé ; un identifiant étranger reste refusé. | 4 tests `review-order` : ajout + ordre ancien passe, ordre complet intact, identifiant étranger refusé, priorité de l'ordre |
| NX-40 | Un serveur de dev figé (TCP ouvert, HTTP muet) n'était compté nulle part : `dev doctor` affichait « aucun serveur » alors que le port était pris et que toutes les requêtes expiraient | `dev doctor` distingue les ports qui écoutent sans jamais répondre et émet un avertissement nommant le port et la marche à suivre (trouver le PID, l'arrêter). | 3 tests `devdoctor` (serveur sain, serveur figé, port fermé) ; sur le projet réel : port 3000 → 307, aucune alerte |
| NX-33 | Aucun contrôle du contrat des `SKILL.md` : un `name` absent, une description vide ou un nom porté par deux contenus différents passaient sans un mot, et l'index gardait une version en jetant l'autre | `novahiz skills --lint` vérifie frontmatter, correspondance nom/dossier, bornes de description, corps et doublons ; erreurs vs avertissements, sortie non nulle seulement sur erreur. Un miroir d'installation n'est pas un doublon. | 9 tests `skilllint` ; sur les skills installées : 147 fichiers, 2 erreurs (conflit `impeccable`), 19 avertissements |
| NX-45 / NX-46 | L'audit et la convergence ne pouvaient pas être exigés à la clôture autrement que par la roadmap de la catégorie | `ledger.close.requireAudit` et `requireConverge` (faux par défaut) ajoutent ces étapes à la liste exigée par `closeStepsFor`, sans doublon. Un projet peut imposer la même discipline partout sans changer le comportement des autres. | 7 tests `close-policy` : défauts à faux, ajout des étapes, absence de doublon, clôture refusée sans audit puis acceptée avec |
| NX-30 | Aucune mesure des skills : impossible de savoir lesquelles sont énormes ou partagent des blocs identiques avant de décider d'une compression | `novahiz skills --audit` mesure chaque skill (caractères, lignes, sections, plus grosse section) et liste les paragraphes strictement identiques entre skills. Les copies miroir sont dédupliquées par contenu. Aucune réécriture. | 5 tests `skillaudit` ; sur les 96 skills : 723 738 caractères, médiane 5 803, plus grosse `expo-skill-eval` (48 403), 0 bloc dupliqué |
| NX-32 | `novahiz-humanizer` chargeait 33 067 caractères, au-delà du contrat de 500 lignes, parce que le catalogue et ses exemples vivaient dans le corps | Divulgation progressive : le catalogue complet et ses 39 exemples partent dans `references/catalogue.md` ; SKILL.md garde la méthode, les règles et un index motif → sévérité → test. Aucun exemple perdu, règle inchangée. | `novahiz-humanizer` : 33 067 → **16 376 caractères**, 199 lignes, 27 motifs indexés, 39 exemples avant et après ; copie installée synchronisée (hash identique) ; lint 0 erreur ; 303 tests verts |
| NX-38 | Aucune preuve de rendu citable : une capture ne se vérifie pas sans œil humain, et un agent qui ne lit pas les images ne peut pas s'en servir | `novahiz render --url <url>` (ou `--file`) lit le HTML réellement servi et rend des faits vérifiables : titre, langue, plan de titres, images sans alt, liens et boutons sans nom, champs sans label, identifiants dupliqués, tabindex positifs, repères, styles en ligne. Sortie non nulle seulement sur constat bloquant. | 9 tests `renderproof` ; sur le site : `/fr` 0 erreur, `/es` 0 erreur après correction, fiche bien 0 erreur |
| NX-35 / NX-36 | L'heuristique wireframe tombait en `default` sur un vrai registre, et `mark approved` jetait le verdict de la revue | Cycle réel « Admin — Paiements » : `paiement` (singulier) était rangé dans *formulaire*, et aucun mot de registre n'existait. Vocabulaire corrigé (`paiements`, `registre`, `encaissements`, `factures`, `impayés`, `trésorerie` en *list*). `mark approved` renvoie désormais `resumeApprobation` : verdict, sections vérifiées, questions, nombre de manques. | 7 tests `wireframe-class` (dont le registre de paiements classé `list`, et le résumé d'approbation) ; cycle réel : revue `pass`, 4 sections, approbation acceptée |
| NX-51 | `novahiz render` ne savait pas vérifier une page authentifiée : sans cookie, `/admin/*` renvoie la page de connexion | `--cookie "a=1,b=2"` et `--header "Nom: valeur"` (plusieurs en-têtes séparés par `|`). `entetesRender` est une fonction pure, donc testable sans réseau. | 6 tests `entetesRender` (cookies joints, cookie invalide ignoré, deux-points préservés, en-têtes multiples). Limite : la preuve live sur `/admin` n'a pas été faite, les cookies de session étant httpOnly (illisibles depuis la page, et les recopier ici aurait exposé un jeton). |
| NX-52 | Une sonde écrite dans `%TEMP%` héritait du pipeline d'évaluation (5 skills) parce que la classification venait du prompt | `isTempPath` : un fichier sous le dossier temporaire du système, hors projet, est traité comme ignoré. Un fichier du projet reste évalué normalement. | 2 tests `gate-alignment` : sonde temporaire ignorée (`allow: true`, aucune skill), fichier du projet toujours évalué |
| NX-37 | Le serveur Playwright tournait avec `--browser=msedge` mais **sans `--user-data-dir`** : chaque démarrage créait un profil, donc une session différente. Mesuré : **11 dossiers** `mcp-msedge-*`, et deux sessions qui se marchent dessus sans message | Profil unique et explicite : `--user-data-dir=C:\Users\Tawhid\.opencode\playwright-profile` ajouté à la configuration, dossier créé. `verifierPolitiquePlaywright` contrôle Edge, le profil obligatoire et l'absence de `--isolated` ; `doctor` publie un contrôle « Browser policy » et compte les profils historiques sans en supprimer aucun. | 8 tests `playwright-policy` ; `doctor` : « Edge et profil explicite — 11 profils historiques (aucun supprimé) » |

## Partiellement appliqué

| ID | État | Reste à faire |
|----|------|---------------|
| — | — | — |

## Non appliqué (documenté, pas oublié)

| ID | Raison |
|----|--------|
| NX-22 | Preuve non vide : déjà appliqué par le ledger (tests `edit sans preuve est refusé`), rien à changer |
| NX-23 | `novahiz_verify` et `evidence:<id>` existent déjà et sont testés |

## Constaté, rien à corriger

| ID | Constat |
|----|---------|
| NX-03 | Aucune dépendance de skill n'existe : les 96 skills de l'index ne déclarent aucun champ `requires`. Il n'y a donc rien à développer dans le message de blocage. À rouvrir le jour où une skill déclarera une dépendance. |
| NX-15 | Les identifiants partagés (`plan`, `clarify`, `tasks`, `analyse`, `implement`, `converge`, `review`) sont identiques dans toutes les catégories. Les deux entrées de `flutter`, `analyse` et `analyze`, ne sont pas un doublon : la première est la lecture du code affecté (`novahiz-analyse`), la seconde l'analyse statique Dart (`dart-run-static-analysis`). Aucun renommage : il casserait les étapes déjà enregistrées dans les tâches en cours. |
| NX-47 | Le rapport de session est déjà structuré et reproductible : `novahiz report --json` sort les mêmes clés à chaque exécution (compteurs, décisions, outils, skills attendues et chargées, sessions). Rien à ajouter. |
| NX-26 | `memory_get` vide n'est pas reproductible : un identifiant inconnu renvoie une erreur explicite (`slot inconnu`), un slot valide renvoie son résumé et ses détails. La cause probable du symptôme est la dégradation de racine : un `root` hors workspace n'échoue pas, il est ramené à la mémoire du workspace et la réponse porte `degraded: true`, `degradeReason` et la racine réellement utilisée. Vérifié en session le 2026-10-31. |
| NX-31 | Aucun bloc strictement identique entre deux skills dans les 96 installées : l'audit (`skills --audit`) en trouve **0**. Il n'y a donc rien à fusionner mécaniquement. Une fusion resterait une décision éditoriale, skill par skill, sans levier automatique. |

## Conflit `impeccable` — résolu

Le lint signalait deux fichiers `impeccable/SKILL.md` de contenus différents :
`~/.agents/skills/impeccable` et `~/.config/opencode/skills/impeccable`. Les deux
copies ont été sauvegardées puis supprimées, et le pack a été réinstallé depuis
la source amont.

**Contrainte réseau mesurée** : ~0,27 Mo/s (≈2,2 Mbps), latence 1–1,5 s. La
commande officielle (`npx -y skills@1.7.0 add pbakaus/impeccable …`) échoue dans
ce contexte : son clone complet expire au bout de 300 s (`Failed to clone
repository`, `Clone timed out after 300s`).

**Méthode qui passe** : clone superficiel puis installation depuis le chemin
local, ce que l'outil recommande lui-même.

```bash
git clone --depth 1 https://github.com/pbakaus/impeccable.git <tmp>/impeccable-src
npx -y skills@1.7.0 add <tmp>/impeccable-src --skill impeccable -g -a opencode -y
```

Résultat : **exit 0**, une seule copie dans `~/.agents/skills/impeccable`,
version 0.1.18, `npx impeccable --version` → 4.5.2. `skills --lint` passe de
2 erreurs à **0** (146 fichiers, 17 avertissements). `novahiz sync` rescane
96 skills, et le gate liste bien `impeccable` dans `missingSkills` d'une tâche
design — la skill est indexée, pas orpheline.

Sauvegardes : `impeccable-backup-20261031\agents-0.1.18` (copie de travail
précédente) et `impeccable-backup-20261031\agents`, `…\opencode` (les deux
copies d'origine).

## État du déploiement

Le serveur MCP `novahiz-tools` et le plugin OpenCode chargent `gate.ts`,
`memory.ts` et `wireframe.ts` au démarrage. Le redémarrage a eu lieu le
2026-10-31 et le comportement en session a été rejoué, pas supposé :

- `novahiz_gate` sur `app/[locale]/admin/biens/actions.ts` (catégorie
  `design-ui`, 900 caractères) → `allow: true`, aucune skill exigée ;
- `novahiz_gate` sur `login_view.dart` → les skills design restent exigées ;
- `novahiz_step({ drop: "wireframe", reason: … })` → statut `dropped` relu ;
- `memory_write` → `slot-074`/`slot-075` distincts pour deux sujets,
  `slot-074` réutilisé pour un titre identique, `slot-076` créé pour un
  `slotId` inconnu.

Les correctifs sont donc actifs en session, pas seulement en CLI.

Deux défauts trouvés pendant cette passe, et corrigés avec leurs tests :

- **NX-48** — le démon du gate laissait `process.exitCode = 2` après une requête
  qui lève ; toutes les réponses suivantes étaient annoncées comme des refus,
  sans skill manquante ni raison, et toute écriture échouait. `capture` vit
  maintenant dans `src/gate-capture.ts` et restaure le code dans le `finally`.
- **NX-49** — `hasPlaceholder` lisait le spread JavaScript comme un marqueur :
  `[...existing]` bloquait une édition légitime. Les motifs d'ellipse exigent
  désormais une espace après les trois points.

Le serveur `novahiz-tools` garde son code au démarrage : NX-16/17 et NX-21 sont
prouvés par `node mcp/novahiz-tools/index.mjs --call novahiz_task`, mais ne
s'appliquent à la session qu'après un redémarrage d'OpenCode.

Le 2026-10-31, `novahiz setup --yes` a réinstallé l'adaptateur : NX-43 exige ce
redémarrage pour que l'enregistrement des liens de délégation soit actif en
session. D'ici là, la lignée reste vide et le gate se comporte comme avant
(claims stricts).

## Ce qui n'est pas fait

Le registre est vide de correctifs ouverts. NX-22 et NX-23 sont satisfaits sans
modification. Trois réserves, nommées ici plutôt que masquées :

- **NX-51** : `--cookie` / `--header` sont testés en unité et vérifiés en CLI sur
  une page publique. La preuve live sur `/admin` n'a pas été faite : les cookies
  de session Supabase sont `httpOnly`, illisibles depuis la page, et les recopier
  ici aurait exposé un jeton.
- **NX-52** : actif pour le CLI. Le démon du gate et le plugin gardent leur code
  au démarrage ; il faut un redémarrage pour que la session en bénéficie.
- **Profils navigateur** : les onze profils historiques ont été supprimés le
  2026-10-31, après accord explicite et vérification qu'aucun processus ne les
  utilisait (11 → 0). `doctor` ne les signale plus.


Sauvegarde des fichiers modifiés :
`C:\Users\Tawhid\AppData\Local\Temp\opencode\novahiz-backup-20261031`.
