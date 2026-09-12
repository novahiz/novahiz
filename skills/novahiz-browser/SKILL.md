---
name: novahiz-browser
description: |
  Automatisation navigateur pour Novahiz : Playwright sur Chrome, en mode headed, avec le
  profil persistant C:\Users\hiz\.config\playwright\chrome-profile. Sessions, cookies et
  cache survivent entre les exécutions.
  Use when a task needs a real page: navigating, extracting content, filling a form,
  clicking through a flow, capturing a screenshot, or validating UI behaviour.
  Triggers on: browser, navigateur, playwright, screenshot, formulaire web, cliquer,
  scraper une page dynamique, tester une UI, vérifier une page.
license: MIT
compatibility: opencode
---

# novahiz-browser : Playwright sur Chrome, profil persistant

Tu conduis un vrai navigateur, visible. Le profil garde les sessions, les cookies et le cache entre les exécutions.

## Configuration imposée

| Réglage | Valeur |
|---|---|
| Moteur | Chrome (`channel: 'chrome'`), jamais le Chromium embarqué |
| Mode | `headless: false`, toujours |
| Profil | `C:\Users\hiz\.config\playwright\chrome-profile` |

```ts
import { launchPersistent } from 'C:/Users/hiz/.config/playwright/launch';
const { browser, context, page } = await launchPersistent();
```

## Règles

1. Jamais `headless: true`. L'utilisateur voit ce que tu fais.
2. Toujours ce profil, jamais un dossier temporaire : il porte les connexions de l'utilisateur.
3. Ne jamais supprimer le profil.
4. En fin de session, `await context.close()` puis `await browser?.close()`, sinon l'état n'est pas écrit.
5. Un téléchargement qui expire se rattrape en augmentant `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`.

## Inspecter

`browser_snapshot` renvoie l'arbre d'accessibilité : c'est la référence pour agir. La capture d'écran sert à montrer, pas à décider.

Pour extraire des données, `browser_evaluate` renvoie du compact. Sur une longue liste, préfère-le à un snapshot intégral. `browser_find` localise un élément sans charger tout l'arbre.

## L'erreur classique

```
Browser is already in use for .../chrome-profile
```

Un Chrome est resté sur le profil et le verrouille. Ferme uniquement les processus dont la ligne de commande contient `playwright\chrome-profile`. Le Chrome personnel de l'utilisateur et Edge ne doivent pas être touchés, et le dossier du profil reste intact.

## Multi-onglets

`browser_tabs` avec `list`, `new`, `select`, `close`. Ferme dans l'ordre inverse d'ouverture. Après un `select`, reprends un snapshot avant d'agir : les références d'éléments ne survivent pas à un changement d'onglet.

## Anti-patterns

- Cliquer sans snapshot préalable.
- Supposer qu'un élément existe.
- Enchaîner les actions sans vérifier entre deux.
- Laisser des onglets ouverts.
- Décider d'une action à partir d'un screenshot.
- Toucher au profil ou aux fenêtres personnelles de l'utilisateur.
