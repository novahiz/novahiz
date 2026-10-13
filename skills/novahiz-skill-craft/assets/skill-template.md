# Template de SKILL.md

Copiez ce fichier, remplacez les blocs `...`, puis validez avec
`scripts/validate-frontmatter.py`. Les commentaires entre `<!-- -->`
sont des instructions : supprimez-les avant de livrer.

---

```markdown
---
name: nom-en-kebab-case
description: |
  Ce que le skill fait, en une phrase. Utiliser quand [declencheur 1],
  quand [declencheur 2], ou quand [declencheur 3]. Ne pas confondre avec
  [autre skill] qui [difference]. Ne pas utiliser pour [anti-cas].
license: Apache-2.0
compatibility: opencode
metadata:
  author: Votre nom
  version: "1.0.0"
---

# Titre du skill

<!-- 3 a 5 lignes. Le "pourquoi" et le contrat honnete : ce que le skill
     fait, et surtout ce qu'il ne fait pas. Un lecteur qui n'a que ca
     doit pouvoir decider s'il doit continuer a lire. -->

## Quand l'utiliser

<!-- Deux a quatre cas reels, formules comme les mots de l'utilisateur,
     pas comme les noms de vos fichiers. -->

## Contrat

<!-- Ce que le skill garantit, et ce qu'il ne garantit pas. Si un script
     ne fait pas une chose que le nom laisse croire, dites-le ici. -->

## Etapes

<!-- Ordre reel du travail. Une etape par bloc, avec la preuve attendue. -->

1. ...
2. ...
3. ...

## Verification

<!-- Comment savoir que c'est fini. Une commande avec un code de sortie
     attendu vaut mieux qu'un adjectif. -->

```
python scripts/mon-script.py --help
```

## Limites

<!-- Les cas ou le skill echoue ou refuse. Un skill sans section Limites
     est un skill dont le contrat est sous-estime. -->
```

---

## Regles de remplissage

**La description porte tout le routage.** Elle est chargee en permanence,
pour tous les skills. Dire quand ne **pas** l'utiliser reduit les
declenchements parasites autant que dire quand l'utiliser.

**Chaque scripts/ doit avoir un `--help`.** L'aide est le contrat : elle
doit dire ce que le script fait, ce qu'il ne fait pas, et ses codes de
sortie. Un script sans aide est un script que personne n'osera lancer.

**Aucun PASS inconditionnel.** Un script qui imprime toujours `PASS` ne
verifie rien : il transforme une verification en reassureur decoratif.
Si la verification n'est pas encore implementee, dites-le dans l'aide
plutot que de simuler le succes.

**Pas de stubs dans references/.** Un fichier de six lignes n'est pas une
reference. Soit il porte du contenu reel, soit il n'existe pas.

**Pas de chemins absolus, pas de secrets.** Ni dans le frontmatter, ni
dans le corps, ni dans les scripts. Le skill part dans un depot public.

## Validation

```
python scripts/validate-frontmatter.py SKILL.md
python scripts/extract-description.py SKILL.md --dir ../
python scripts/scan-skill.py .
```
