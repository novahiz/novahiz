---
name: playwright-agent
description: |
  Skill global pour l'utilisation de Playwright dans OpenCode. Force le démarrage du serveur
  de développement dans un terminal externe avant toute interaction navigateur. Fournit les
  bonnes pratiques, le protocole de connexion, et les commandes courantes.
  Use when using Playwright, navigating to localhost, taking screenshots, or interacting with a web app.
  Triggers on: "playwright", "navigateur", "localhost", "serveur", "dev server", "screenshot", "page web".
license: MIT
compatibility: opencode
---

# playwright-agent : Protocole Playwright OpenCode

## Règle absolue — Serveur externe obligatoire

**Toute tâche Playwright nécessitant un serveur local DOIT d'abord démarrer ce serveur dans un terminal externe.**

Pourquoi : le navigateur Playwright (MCP) tourne dans un contexte réseau isolé. Un serveur lancé en arrière-plan PowerShell (`Start-Job`) meurt avec la session. Seul un terminal PowerShell externe (`Start-Process`) maintient le serveur en vie.

## Protocole de démarrage

### Étape 1 — Détecter le type de projet

```bash
# Vérifier la présence de fichiers de config
Test-Path package.json      # Node.js (Vite, Next.js, CRA...)
Test-Path Cargo.toml        # Rust
Test-Path pyproject.toml    # Python
Test-Path go.mod            # Go
```

### Étape 2 — Lancer le serveur dans un terminal externe

**Node.js / Vite / Next.js / React :**
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; npm run dev"
```

**Avec port personnalisé :**
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '<CHEMIN_PROJET>'; npx vite --port 3000"
```

**Avec host explicite (si nécessaire) :**
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

### Étape 3 — Attendre et vérifier la disponibilité

```powershell
Start-Sleep -Seconds 5
Test-NetConnection -ComputerName localhost -Port <PORT> -WarningAction SilentlyContinue | Select-Object TcpTestSucceeded
```

Ne passer à l'étape suivante que si `TcpTestSucceeded` est `True`.

### Étape 4 — Naviguer avec Playwright

```
playwright_browser_navigate(url="http://localhost:<PORT>/")
```

## Erreurs courantes et solutions

| Erreur | Cause | Solution |
|---|---|---|
| `ERR_CONNECTION_REFUSED` | Serveur pas lancé ou port faux | relancer le serveur, vérifier le port |
| `ERR_CONNECTION_REFUSED` (localhost mais `Test-NetConnection` OK) | IPv6 vs IPv4 | ajouter `--host 0.0.0.0` au serveur |
| `net::ERR_SOCKET_NOT_CONNECTED` | Serveur en cours de démarrage | attendre plus longtemps |
| Session PowerShell fermée | Serveur arrêté | relancer le terminal externe |

## Commandes Playwright utiles

### Navigation
```
playwright_browser_navigate(url="http://localhost:5173/")
playwright_browser_navigate_back()
playwright_browser_tabs(action="list")
playwright_browser_tabs(action="new", url="http://localhost:5173/page2")
```

### Interactions
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

## Bonnes pratiques

1. **Toujours vérifier le port** — ne jamais supposer que le serveur tourne sur 5173. Lire `package.json` ou la sortie du serveur.
2. **Capturer avant d'agir** — faire un screenshot ou snapshot avant une interaction pour vérifier l'état de la page.
3. **Nommer les éléments** — toujours passer `element` (description lisible) en plus de `target` (ref technique) pour les clics.
4. **Vérifier les erreurs console** — après navigation, vérifier `playwright_browser_console_messages(level="error")`.
5. **Gérer les popups** — `playwright_browser_handle_dialog(accept=true)` pour les confirmations.
6. **Screenshot = preuve** — chaque étape importante se termine par un screenshot qui sert de preuve de vérification.

## Intégration Novahiz

Ce skill est invoqué automatiquement quand la catégorie `browser` est détectée. Il complète :
- `novahiz-plan` (étape 1 : cadrer l'objectif)
- `novahiz-task` (étape 2 : découper les étapes)
- `novahiz-converge` (vérification finale)

Le serveur externe est un prérequis technique, pas une étape du pipeline. Il ne remplace pas la planification.
