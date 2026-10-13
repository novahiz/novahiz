# Specification du frontmatter

Le frontmatter est le seul texte toujours charge en contexte. C'est lui
qui decide du declenchement : un defaut ici ne se rattrape pas dans le
corps, parce que le corps ne sera jamais lu si le skill ne se declenche pas.

## Structure

Le fichier commence par `---`, le frontmatter se termine par un second
`---`, puis vient le corps. Un `---` de fin manquant est un echec dur.

```markdown
---
name: novahiz-exemple
description: |
  Ligne une. Ligne deux.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  version: "1.0.0"
---
Corps du skill ici.
```

## Champs

| Champ | Obligation | Contrainte | Verifier avec |
|---|---|---|---|
| `name` | obligatoire | kebab-case `[a-z0-9-]`, <= 64 car., ni tiret en debut ni en fin | `validate-frontmatter.py` |
| `description` | obligatoire | non vide, <= 1024 car., **aucune balise XML** | `extract-description.py` |
| `license` | obligatoire | presente et non vide | `validate-frontmatter.py` |
| `compatibility` | recommande | `opencode` sauf motif | `validate-frontmatter.py` (WARN) |
| `metadata.author` | recommande | nom de l'auteur | `validate-frontmatter.py` (WARN) |
| `metadata.version` | recommande | semver | `validate-frontmatter.py` (WARN) |

Un champ absent qui est marque « recommande » ne bloque pas, mais il est
signale. Une absence repetee sur tout le corpus est un defaut de methode.

## Coherence name / dossier

Le champ `name` doit correspondre au nom du dossier apres normalisation
NFKC. Le routage s'appuie sur le nom : un ecart produit des declenchements
fantomes ou des skills orphelins. `scan-skill.py` signale l'ecart en WARN.

## Secrets et chemins machine

Le frontmatter ne doit contenir aucun secret ni chemin absolu de machine.
`validate-frontmatter.py` teste quatre formats de cles (`sk-`, `ghp_`,
`AKIA`, et tout `api_key`/`secret`/`password` affecte) et signale tout
chemin `C:\...`, `/Users/...`, `/home/...` ou `/root/...`.

C'est une regle de securite, pas de style : le frontmatter part dans le
registre des skills et se retrouve souvent dans des depots publics.

## Erreurs frequentes

**Description trop courte.** Sous 60 caracteres, la description ne porte
pas le routage : elle dit ce que le skill fait sans dire quand l'appeler.

**Description avec balises XML.** `<file>`, `<!-- -->` et autres balises
dans la description cassent le parser YAML de certains runtimes. Le
corps les autorise, le frontmatter non.

**`name` copie depuis le nom d'un dossier Windows.** Les majuscules et les
espaces sont normalises parfois, mais pas toujours. Ecrire le kebab-case
a la main coute moins cher qu'un declenchement manquant en production.

## Verification

```
python scripts/validate-frontmatter.py SKILL.md
python scripts/validate-frontmatter.py ../autre-skill/SKILL.md
python scripts/scan-skill.py .        # couvre aussi name <-> dossier
```
