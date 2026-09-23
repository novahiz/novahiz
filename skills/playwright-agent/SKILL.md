---
name: playwright-agent
description: |
  Skill global pour l'utilisation de Playwright dans OpenCode. Force le démarrage du serveur
  de développement dans un terminal externe avant toute interaction navigateur. Fournit les
  bonnes pratiques, le protocole de connexion, et les commandes courantes.
  Use when using Playwright, navigating to localhost, taking screenshots, or interacting with a web app.
  Triggers on: "playwright", "navigateur", "localhost", "serveur", "dev server", "screenshot", "page web".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# playwright-agent : exécution Playwright sous OpenCode

## Contrainte de départ : le serveur vit hors de la session

Une tâche Playwright qui vise un site local commence toujours par lancer le serveur dans un terminal PowerShell externe.

Le navigateur piloté par le serveur MCP Playwright s'exécute dans un contexte réseau distinct de celui de la session OpenCode. Un serveur démarré via `Start-Job` PowerShell meurt quand la session se ferme. Seul `Start-Process`, qui ouvre un vrai terminal persistant, maintient le processus en vie après la fin de la commande.

## Protocole de démarrage

### 1. Identifier la pile du projet

```bash
Test-Path package.json      # Node.js (Vite, Next.js, CRA...)
Test-Path Cargo.toml        # Rust
Test-Path pyproject.toml    # Python
Test-Path go.mod            # Go
```

### 2. Ouvrir le terminal externe

**Node.js / Vite / Next.js / React :**
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; npm run dev"
```

**Port imposé :**
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; npx vite --port 3000"
```

**Hôte explicite (si nécessaire) :**
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; npx vite --host 0.0.0.0"
```

**Python (Flask, FastAPI, Django) :**
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; python -m flask run"
# ou
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; uvicorn main:app --reload"
```

**Rust (Actix, Axum) :**
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; cargo run"
```

### 3. Attendre que le port réponde

```powershell
Start-Sleep -Seconds 5
Test-NetConnection -ComputerName localhost -Port <PORT> -WarningAction SilentlyContinue | Select-Object TcpTestSucceeded
```

Passer à la suite uniquement quand `TcpTestSucceeded` vaut `True`.

### 4. Naviguer

```
playwright_browser_navigate(url="http://localhost:<PORT>/")
```

## Pannes fréquentes

| Erreur | Cause probable | Correctif |
|---|---|---|
| `ERR_CONNECTION_REFUSED` | Serveur absente ou port faux | relancer le serveur, relire le port dans package.json |
| `ERR_CONNECTION_REFUSED` (localhost joignable via `Test-NetConnection`) | IPv6 contre IPv4 | ajouter `--host 0.0.0.0` au serveur |
| `net::ERR_SOCKET_NOT_CONNECTED` | Démarrage en cours | laisser plus de temps avant de reconnecter |
| Terminal fermé | Processus tué | rouvrir un `Start-Process` |

## Commandes Playwright

### Navigation
```
playwright_browser_navigate(url="http://localhost:5173/")
playwright_browser_navigate_back()
playwright_browser_tabs(action="list")
playwright_browser_tabs(action="new", url="http://localhost:5173/page2")
```

### Interaction
```
playwright_browser_click(target="<ref>", element="<description>")
playwright_browser_type(target="<ref>", text="hello")
playwright_browser_fill_form(fields=[...])
playwright_browser_select_option(target="<ref>", values=["option1"])
playwright_browser_hover(target="<ref>")
```

### Capture
```
playwright_browser_take_screenshot(scale="css")
playwright_browser_take_screenshot(scale="device", fullPage=true)
playwright_browser_snapshot()
```

### Inspection
```
playwright_browser_find(text="bouton")
playwright_browser_console_messages(level="error")
playwright_browser_network_requests(static=false)
```

### Attente
```
playwright_browser_wait_for(text="Chargé")
playwright_browser_wait_for(textGone="Loading")
playwright_browser_wait_for(time=3)
```

## Habitudes de travail

1. **Lire le port, ne pas le supposer.** 5173 est une convention Vite, pas une vérité. Ouvrir package.json ou le script de démarrage.
2. **Photographier avant de toucher.** Screenshot ou snapshot avant le premier clic : l'état réel de la page est alors figé.
3. **Nommer la cible.** Passer `element` (description lisible) en plus de `target` (référence technique) sur chaque clic.
4. **Vérifier la console.** Après chaque navigation : `playwright_browser_console_messages(level="error")`.
5. **Intercepter les dialogues.** `playwright_browser_handle_dialog(accept=true)` pour confirmer sans bloquer.
6. **Le screenshot fait preuve.** Une étape importante se clôt par une capture qui servira de preuve au moment de la convergence.

## Place dans Novahiz

Ce skill s'active quand la catégorie `browser` est détectée. Il complète :

- `novahiz-plan` : cadrer l'objectif
- `novahiz-task` : découper les étapes
- `novahiz-converge` : vérification finale

Le serveur externe est un prérequis technique. Il ne se substitue ni à la planification ni à la convergence.
