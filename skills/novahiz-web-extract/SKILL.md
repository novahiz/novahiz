---
name: novahiz-web-extract
description: |
  novahiz-web-extract : extraction de contenu web propre, conversion HTML en Markdown,
  suppression du bruit, récupération du contenu principal. Use when fetching web pages,
  extracting article content, converting HTML to clean markdown, or scraping structured data.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-web-extract

Extraire le contenu principal d'une page et le rendre en Markdown lisible, sans le bruit qui l'entoure.

## Objectif

Garder l'essentiel, retirer le reste : navigation et menus, publicités et trackers, pied de page et sidebars, scripts et styles, gadgets sociaux et popups.

## Méthode

### 1. Choisir le conteneur principal

```javascript
const selectors = [
  'article',
  '[role="main"]',
  'main',
  '.content',
  '.post',
  '.article',
  '#content',
  '#main'
];
```

Parcourir la liste dans l'ordre et prendre le premier conteneur non vide.

### 2. Nettoyer le HTML

```javascript
const removeSelectors = [
  'nav', 'header', 'footer',
  '.sidebar', '.advertisement', '.ad',
  '.cookie-banner', '.popup',
  'script', 'style', 'noscript',
  '.social-share', '.comments',
  '.related-posts', '.newsletter-signup'
];
```

### 3. Convertir en Markdown

| HTML | Markdown |
|------|----------|
| h1 à h6 | `#` à `######` |
| p | double saut de ligne |
| strong, b | `**texte**` |
| em, i | `*texte*` |
| a href | `[texte](url)` |
| img | `![alt](url)` |
| ul, ol | tirets ou numéros |
| blockquote | `>` |
| code | code inline |
| pre | bloc de code |
| table | tableau Markdown |

## Formats d'extraction

### Article de blog

```markdown
# Titre de l'article

**Auteur:** Nom | **Date:** 2024-01-15 | **Lecture:** 5 min

---

Contenu principal...

## Sous-titre

Plus de contenu...

- Élément
- Élément

> Citation importante

`code block`
```

### Documentation technique

```markdown
# Nom de l'API

## Description
Description de l'endpoint.

## Méthode
POST /api/v1/users

## Paramètres
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| name | string | Oui | Nom de l'utilisateur |

## Exemple
`json
{ "name": "John" }
`

## Réponse
`json
{ "id": 1, "name": "John" }
`
```

### Page produit

```markdown
# Nom du produit

**Prix:** 99.99 EUR | **Disponibilité:** En stock

## Caractéristiques
- Fonction 1
- Fonction 2

## Description
Description du produit...

## Avis
4.2/5 (128 avis)
```

## Gestion des erreurs

| Erreur | Action |
|--------|--------|
| 404 Not Found | Signaler, pas de contenu |
| 403 Forbidden | Nouvelle tentative avec User-Agent |
| Timeout | Retry avec backoff |
| HTML invalide | Parsing best-effort |
| Contenu vide | Rapport avec la raison |

## Économie de tokens

Stratégie : n'extraire que ce qui est demandé, tronquer intelligemment (début, fin, mots-clés), dédupliquer les répétitions, résumer seulement si le volume l'exige.

| Type de contenu | Limite |
|----------------|--------|
| Page standard | extraction complète |
| SPA | contenu initial seulement |
| PDF | texte brut |
| Images | alt text |
| Vidéo | métadonnées |

## Intégration

```
URL -> novahiz-web-extract -> markdown -> novahiz-analyse
```

Avec la recherche : `novahiz-web-extract` produit le contenu propre, l'analyse de fond s'occupe de la synthèse.

## Anti-patterns

À éviter : coller tout le HTML brut, ignorer les erreurs, perdre l'URL source, réécrire le contenu pendant l'extraction.

À faire : valider le format de l'URL, gérer les timeouts avec backoff, respecter robots.txt quand il existe, garder les résultats pour les recherches suivantes.
