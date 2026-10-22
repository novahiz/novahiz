---
name: novahiz-capture
description: |
  Reliable screenshot capture for the physical Playwright browser (Edge) when
  browser_take_screenshot returns stale, blank or cut images. Triggers on:
  screenshot, capture, capture d'ecran, prise de capture, viewport CSS,
  screenshot vide, screenshot stale, bande morte, fromSurface, sauver
  l'image de la page, verifier le rendu. Computes the CSS-true viewport
  (display scale + screen-height ceiling), captures through CDP
  Page.captureScreenshot fromSurface:false saved via a data-URL download,
  waits for hydration, and names files theme-section-viewport.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
---

# novahiz-capture: capture le navigateur sans mentir

Le rituel de capture du navigateur physique (Edge, Playwright MCP) tel qu'il a
été éprouvé session après session : les 4 modes d'échec ci-dessous ont chacun
coûté une redécouverte. Une capture n'est "faite" que quand elle est ouverte et
regardée ; jamais déclarée d'après l'absence d'erreur.

## Quand l'utiliser

- `browser_take_screenshot` a rendu une image **stale ou vide** (page non peinte,
  composite figé) → rituel CDP direct, sans réessayer l'outil tel quel.
- Tu dois prouver le rendu à un viewport CSS précis (fidelité, responsive).
- Tu captures au sommet d'un scroll ou après un saut d'ancre (reveals en vol).

## Étape 1 — viewport CSS : la conversion avant le clic

`setViewportSize` s'exprime en pixels **physiques** ; l'écran affiche en CSS à
l'échelle du système (125 % sur la machine de référence). Donc :

```
setViewport(w_css * echelle, h_css * echelle)  ->  innerWidth == w_css
```

Échelles mesurées à jour sur la machine de référence (1800×900 physiques) :

| CSS voulu | setViewportSize | Résultat réel |
|---|---|---|
| 1440 (desktop) | (1800, 900) | inner 1440×720 |
| 1024 (desktop) | (1280, 800) | inner 1024×640 |
| 768 (tablette) | (960, 900) | inner 768×720 |
| 320 (mobile) | (400, 850) | inner 320×680 |

**Plafond écran** : une hauteur `setViewport` au-delà de la hauteur physique de
l'écran produit une **bande morte en bas de l'image** (1800×1125 sur un écran de
900 → bande vide ; c'est une limite de capture, pas un bug d'UI). Ne dépasse
jamais `hauteur échelle × 1`. Le helper calcule et prévient :

```bash
node scripts/shot-spec.mjs --css 1440 --scale 1.25 --screen 1800x900
node scripts/shot-spec.mjs --help
```

## Étape 2 — rituel CDP `fromSurface:false`

Dans `browser_run_code_unsafe` (le download d'un data-URL contourne le composite
de surface qui rend l'outil standard stale) :

```js
const cdp = await page.context().newCDPSession(page);
const shot = await cdp.send("Page.captureScreenshot", {
  format: "png",
  fromSurface: false,
  captureBeyondViewport: false
});
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.evaluate((b64) => {
    const a = document.createElement("a");
    a.href = "data:image/png;base64," + b64;
    a.download = "capture.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, shot.data)
]);
await download.saveAs("screenshots/cible.png");
```

`fromSurface: false` est le cœur : la page est peinte depuis le process, pas
depuis une surface de compositing parfois figée.

## Étape 3 — attentes : l'hydratation avant le déclic

- Chargement en haut de page : **4200 ms** (hydratation dev + reveals).
- Après un saut d'ancre (scrollspy, TOC) : **3400 ms**.
- Une **ligne barrée** ou un élément à moitié animé dans la capture = le
  reveal était en vol : attends qu'il finisse (ou désactive les reveals) et
  reprends. Ne compose, ne retouche jamais pour masquer ça.

## Étape 4 — nommage, nettoyage, relecture

- Nommage : `<theme>-<section>-<viewport>.png`, suffixe viewport CSS toujours
  présent (`blog-01-fr-dark-top-1440.png`, `blog-27-fr-dark-mobile320-top.png`).
- Avant d'écrire : supprimer les prédécesseurs corrompus/obsolètes du même nom
  de famille — un dossier de captures mélangé vérité et déchets fausse les
  comparaisons.
- **Ouvre chaque image** (aperçu, une par une) avant de déclarer une capture
  valide : vide, bande morte, artefact et révélation manquante ne se voient
  pas dans le JSON de l'outil.

## Pièges connus (les 4 modes d'échec)

| Symptôme | Cause | Remède |
|---|---|---|
| Image stale/vide | surface de compositing figée | CDP `fromSurface:false` |
| Bande morte en bas | hauteur `setViewport` > écran | plafond = hauteur physique |
| innerWidth ≠ CSS voulu | échelle système 125 % | multiplier par l'échelle |
| Élément à moitié animé | reveal en vol | attendre, reprends |

## Sortie attendue

Un fichier PNG réel dans `screenshots/`, nommé avec son viewport, ouvert et
inspecté — plus la ligne de preuve au ledger qui cite le chemin et l'état
constaté (clair/sombre, viewport, section).
