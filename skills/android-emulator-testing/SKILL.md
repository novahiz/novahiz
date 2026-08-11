# Skill: android-emulator-testing

# Android Emulator Testing — Open App + Validate Rendering

Vous êtes le spécialiste de l'ouverture d'une application Expo/React Native sur l'émulateur Android et de la validation du rendu. Ce skill documente le processus FIABLE, testé et reproduisible à chaque session.

## Quand utiliser

- L'utilisateur demande d'ouvrir le projet dans l'émulateur Android
- Test du rendu d'une app mobile sur Android
- Vérification visuelle après une modification UI
- Diagnostic d'un écran blanc / erreur sur Android
- Validation d'une nouvelle fonctionnalité sur Android
- Test de compatibilité après mise à jour d'Expo/React Native
- Débogage d'un crash spécifique à Android

## Prérequis

- **Android SDK** installé (avec `platform-tools` et `emulator`)
- **Emulator** configuré avec au moins un AVD (ex: `Pixel_9`)
- **Node.js** et **npm** installés
- **Expo CLI** disponible (`npx expo start`)
- **PowerShell 7** (pwsh) — jamais cmd/bash/WSL
- **Connexion réseau** active (pour le deep link)

Vérifier les prérequis :
```powershell
# Vérifier adb
adb version

# Vérifier emulator
emulator -version

# Vérifier Node.js
node --version

# Vérifier PowerShell
$PSVersionTable.PSVersion
```

## Règles d'or

1. **JAMAIS** `expo run:android` / `expo run:ios` / `eas build` sans confirmation explicite (AGENTS.md §Expo Build Rules)
2. **TOUJOURS** `npx expo start` pour le développement (pas de build natif)
3. **TOUJOURS** vérifier l'émulateur AVANT de lancer Metro
4. **TOUJOURS** valider le rendu par screenshot + état d'activité (pas juste "l'app s'ouvre")
5. Sur Windows: `pwsh` (PowerShell 7), jamais cmd/bash/WSL
6. **JAMAIS** utiliser le hostname dans le deep link Expo — l'émulateur ne résout pas les noms d'hôtes locaux. Toujours l'**IP locale**.
7. **TOUJOURS** démarrer l'émulateur en **cold boot** (`-no-snapshot-load`) — jamais de quick boot. Un snapshot peut contenir des états stale (apps crashées, cache corrompu, sessions expirées) qui faussent les tests.
8. **TOUJOURS** nettoyer les anciens logs avant une relance (évite les confusions)
9. **TOUJOURS** vérifier l'état du bundle Android dans les logs Metro
10. **PRIVILÉGIER** l'IP de la plage privée (192.168.x.x, 10.x.x.x) plutôt qu'une IP link-local (169.254.x.x)

## Workflow complet

### Étape 1 — Vérifier l'état existant

```powershell
# Emulateur connecté ?
adb devices

# Metro actif ?
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
```

| Émulateur | Metro | Action |
|-----------|-------|--------|
| `device` | Port 8081 actif | → Étape 4 (direct deep link) |
| `device` | Port 8081 libre | → Étape 3 (lancer Metro) |
| vide | — | → Étape 2 (démarrer émulateur) |
| `offline` | — | Attendre `sys.boot_completed=1` |

### Étape 2 — Démarrer l'émulateur (si nécessaire)

```powershell
# Lister les AVDs disponibles
emulator -list-avds

# Démarrage en arrière-plan — COLD BOOT (-no-snapshot-load)
# Jamais de quick boot : un snapshot peut contenir des états stale
Start-Process -FilePath "emulator" -ArgumentList "-avd", "Pixel_9", "-no-snapshot-load"

# Attendre que le device apparaisse et que le boot soit terminé
adb wait-for-device
adb shell getprop sys.boot_completed   # attendre "1"
```

**Pourquoi cold boot ?** Le quick boot restaure un état sauvegardé (snapshot). Cet état peut contenir :
- Apps crashées ou en état d'erreur
- Cache corrompu ou expiré
- Sessions authentification stale
- Variables d'environnement obsolètes

Un cold boot repart de zéro — c'est plus lent (~30s de plus) mais fiable.

**Vérifications post-boot** :
```powershell
# Vérifier le niveau de batterie (utile pour les tests de persistance)
adb shell "dumpsys battery | grep level"

# Vérifier l'état réseau
adb shell "dumpsys connectivity | grep NetworkAgentInfo"

# Vérifier la mémoire disponible
adb shell "cat /proc/meminfo | grep MemTotal"
```

### Étape 3 — Lancer Metro (si pas déjà actif)

**Méthode FIABLE** — `Start-Process pwsh` avec redirection de logs:

```powershell
# Nettoyer les anciens logs
Remove-Item -LiteralPath "C:\Users\tawhi\AppData\Local\Temp\opencode\expo-start.log" -ErrorAction SilentlyContinue

$log = "C:\Users\tawhi\AppData\Local\Temp\opencode\expo-start.log"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; npx expo start --android *> '$log'" -WindowStyle Hidden
Start-Sleep -Seconds 20
Get-Content $log -Tail 20
```

**Points critiques** :
- Utiliser `pwsh` (PowerShell 7), PAS `powershell` (5.1)
- Rediriger les logs vers un fichier
- Si le port 8081 est déjà utilisé → Metro tourne déjà, passer à l'étape 4
- **Toujours** `Start-Process` en background (timeout 60s tue Metro au premier plan)
- Nettoyer les anciens logs avant relance (évite les confusions)

**Vérification que Metro est prêt** :
```powershell
# Attendre que le serveur soit prêt
$timeout = 60
$elapsed = 0
while ($elapsed -lt $timeout) {
    $port = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
    if ($port) { break }
    Start-Sleep -Seconds 2
    $elapsed += 2
}
if ($elapsed -ge $timeout) { Write-Host "Timeout: Metro pas prêt après $timeout secondes" }
```

### Étape 4 — Obtenir l'IP locale (CRITIQUE)

```powershell
# Méthode 1 : IP de la plage privée (recommandée)
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' } | Select-Object -First 1).IPAddress

# Méthode 2 : Toute IP non-loopback (fallback)
if (-not $ip) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress
}

Write-Host "IP: $ip"
```

**⚠️ Piège fréquent** : `hostname` (ex: `novahiz`) ne résout PAS dans l'émulateur Android. L'émulateur est un device réseau séparé — il a besoin de l'**adresse IP** de la machine hôte. Utiliser `exp://<IP>:8081`, JAMAIS `exp://<hostname>:8081`.

**Pourquoi privilégier l'IP de plage privée ?** Les IP link-local (169.254.x.x) peuvent poser des problèmes de connectivité dans certains réseaux. Les IP de plage privée (192.168.x.x, 10.x.x.x, 172.16-31.x.x) sont plus stables.

### Étape 5 — Ouvrir l'app via deep link

```powershell
# Si l'app est déjà ouverte, la recharger
adb shell "am force-stop host.exp.exponent"
Start-Sleep -Seconds 2

# Ouvrir via deep link (avec l'IP, PAS le hostname)
adb shell "am start -a android.intent.action.VIEW -d exp://${ip}:8081 host.exp.exponent"
```

**Alternative : Expo Go** :
Si l'app n'est pas installée (utilisation d'Expo Go), le deep link fonctionne automatiquement avec Expo Go.

**Gestion des erreurs de deep link** :
```powershell
# Si le deep link échoue, essayer avec le package spécifique
adb shell "am start -a android.intent.action.VIEW -d exp://${ip}:8081 -p host.exp.exponent"
```

### Étape 6 — Vérifier que l'app est au premier plan

```powershell
adb shell "dumpsys window | grep mCurrentFocus"
```

| Résultat | Signification | Action |
|----------|---------------|--------|
| `ExperienceActivity` | App ouverte ✅ | → Étape 7 |
| `ErrorActivity` | Erreur d'affichage | Vérifier logs Metro (Étape 8) |
| `nexuslauncher` | App pas ouverte | Réessayer deep link |
| `LauncherActivity` | Expo Go ouvert | Vérifier le deep link |

**Vérification de l'état de l'app** :
```powershell
# Vérifier si l'app est en premier plan
adb shell "dumpsys activity activities | grep mResumedActivity"

# Vérifier la mémoire utilisée par l'app
adb shell "dumpsys meminfo host.exp.exponent | grep TOTAL"
```

### Étape 7 — Vérifier les logs Metro (erreurs runtime)

```powershell
Get-Content <fichier-log> -Tail 20
```

**Indicateurs de succès** :
- `Android Bundled XXXXms ... (N modules)` → bundle OK
- `LOG [RootLayout] ready=true user=true ...` → session chargée
- Absence de `ERROR` / `WARN` rouges

**Indicateurs d'erreur** :
- `ERROR` ou `WARN` en rouge
- `Something went wrong` → bundle crash
- `Unable to resolve module` → dépendance manquante
- `SyntaxError` → erreur de syntaxe JavaScript/TypeScript

**Actions correctives** :
```powershell
# Si erreurs de compilation
npx expo start --clear

# Si erreurs de dépendances
npx expo install --check

# Si erreurs de cache
npx expo start --clear && npx expo start --android
```

### Étape 8 — Valider le rendu (screenshot)

```powershell
# Créer le dossier screen s'il n'existe pas
New-Item -ItemType Directory -Path "<PROJET>\screen" -Force

# Prendre le screenshot
adb shell screencap -p /sdcard/screen.png
adb pull /sdcard/screen.png "<PROJET>\screen\mon-capture.png"
```

**Règles screenshots** (global-rules.md §7) :
- Toujours dans `screen/` à la racine du projet
- Nom descriptif kebab-case
- Inclure la date/heure si multiple screenshots

**Validation visuelle** :
- Vérifier que l'écran affiche le contenu attendu
- Vérifier l'absence d'erreurs visuelles (overflows, couleurs manquantes)
- Vérifier la navigation (onglets, boutons)
- Vérifier les animations si applicable

## Diagnostique rapide

| Symptôme | Cause probable | Fix |
|----------|---------------|-----|
| `adb devices` vide | Émulateur pas démarré | `Start-Process emulator -avd Pixel_9` |
| `offline` | Boot en cours | Attendre `sys.boot_completed=1` |
| Port 8081 non actif | Metro pas lancé | Relancer `Start-Process pwsh` |
| `ErrorActivity` | Deep link avec hostname | Utiliser l'**IP locale** (Étape 4) |
| `Something went wrong` dans Expo Go | Bundle crash | `npx expo start --clear` |
| Écran blanc | CSS/Metro compile error | `npx expo start --clear` |
| Notification jaune en bas | Dev indicator Expo | `app.json` → `"development": { "indicator": false }` |
| Metro killed par timeout | Commande au premier plan | Toujours `Start-Process` + logs |
| `Unable to resolve module` | Dépendance manquante | `npx expo install <module>` |
| `SyntaxError` | Erreur de syntaxe | Vérifier le code source |
| `Network request failed` | Problème de connectivité | Vérifier IP et port |
| `auth/invalid-email` | Configuration Supabase | Vérifier `.env` |
| L'app se ferme immédiatement | Crash au démarrage | Vérifier logs Metro + adb logcat |
| Performance lente | Mémoire insuffisante | Fermer les apps en arrière-plan |
| Orientation incorrecte | Configuration non respectée | Vérifier `app.json` → `orientation` |

## Notes projet (Fortunica Mobile)

- AVD: `Pixel_9`
- Bundle ID: `com.fortunica.mobile`
- Metro: port `8081`
- L'app route vers `/(tabs)` (client) ou `/(admin)` selon `profiles.is_admin`
- Logs: `segment=(tabs) pathname=/` = OK
- Palette: `#f5f0eb` (beige chaud), pas de dark mode
- Accent: `#059669` (emerald green)

## Expo MCP (si disponible)

Le MCP Expo remote (`https://mcp.expo.dev/mcp`) donne des tools natifs pour :
- `automation_take_screenshot` — screenshot natif sans adb
- `automation_tap` — tap sur des coordonnées
- `automation_find_view` — trouver des vues par accessibility label
- `open_devtools` — ouvrir les devtools React Native

Pour activer les capacités locales : `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start`

## Tests automatisés (optionnel)

Pour les tests automatisés, utiliser `adb shell input` :
```powershell
# Tap sur des coordonnées
adb shell input tap 500 1000

# Saisie de texte
adb shell input text "test@example.com"

# Swipe
adb shell input swipe 500 1500 500 500 300

# Appui sur un bouton
adb shell input keyevent 4  # Retour
adb shell input keyevent 3  # Accueil
```

## Conseils pour les performances

1. **Fermer les apps en arrière-plan** : `adb shell "am kill-all"`
2. **Libérer la mémoire** : `adb shell "echo 3 > /proc/sys/vm/drop_caches"`
3. **Désactiver les animations** (pour les tests de performance) :
   ```powershell
   adb shell "settings put global window_animation_scale 0"
   adb shell "settings put global transition_animation_scale 0"
   adb shell "settings put global animator_duration_scale 0"
   ```
4. **Activer les animations** (pour les tests visuels) :
   ```powershell
   adb shell "settings put global window_animation_scale 1"
   adb shell "settings put global transition_animation_scale 1"
   adb shell "settings put global animator_duration_scale 1"
   ```

## Mises à jour

### Après mise à jour d'Expo
```powershell
# Vérifier les dépendances
npx expo install --check

# Mettre à jour les dépendances native
npx expo prebuild --clean

# Tester sur l'émulateur
npx expo start --android
```

### Après mise à jour de React Native
```powershell
# Nettoyer le cache
npx expo start --clear

# Vérifier les dépendances native
npx expo prebuild --clean
```

## Anti-patterns

- ❌ `npx expo start` au premier plan (timeout 60s tue Metro)
- ❌ `powershell` 5.1 au lieu de `pwsh` (échoue silencieusement)
- ❌ Utiliser `hostname` dans le deep link Expo (l'émulateur ne résout pas)
- ❌ Quick boot sans `-no-snapshot-load` (états stale, erreurs fantômes)
- ❌ Confirmer le rendu sans screenshot ni état d'activité
- ❌ `expo run:android` sans confirmation utilisateur
- ❌ Ne pas nettoyer les anciens logs avant relance
- ❌ Oublier de reconnecter le MCP après `expo start`/`expo stop`
- ❌ Utiliser une IP link-local (169.254.x.x) sans vérifier la connectivité
- ❌ Ignorer les erreurs dans les logs Metro
- ❌ Ne pas vérifier l'état du bundle Android
- ❌ Oublier de valider la navigation après chargement
- ❌ Ne pas nettoyer le cache après une mise à jour
- ❌ Utiliser des commandes adb non testées