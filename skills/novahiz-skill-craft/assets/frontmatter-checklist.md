# Checklist de livraison d'un skill

Onze points, dans l'ordre ou les defauts coutent le plus cher. Un point
coche sans verification reelle est un point faux : chaque ligne indique
la commande qui le prouve.

## Frontmatter (le plus cher, toujours en contexte)

1. [ ] `name` en kebab-case `[a-z0-9-]`, <= 64 caracteres, et **identique
   au nom du dossier**
   `python scripts/validate-frontmatter.py SKILL.md`

2. [ ] `description` avec declencheurs, differenciateur et anti-cas,
   <= 1024 caracteres, sans balise XML
   `python scripts/extract-description.py SKILL.md --dir ../`

3. [ ] `license` presente
   `python scripts/validate-frontmatter.py SKILL.md`

4. [ ] `compatibility` et `metadata` (`author`, `version`) renseignes
   `python scripts/validate-frontmatter.py SKILL.md`

5. [ ] Aucun secret, aucun chemin absolu de machine
   `python scripts/validate-frontmatter.py SKILL.md`

## Structure

6. [ ] Corps du `SKILL.md` <= 500 lignes, fences ``` equilibrees
   `python scripts/scan-skill.py .`

7. [ ] Chaque fichier de `references/` porte du contenu reel, avec un
   titre de niveau 1, et n'est pas un stub de quelques lignes
   `python scripts/scan-skill.py .`

8. [ ] `evals.json` present et JSON valide, 3 evaluations minimum
   (obligatoire selon la Phase 2)
   `python scripts/scan-skill.py .`
   `python scripts/run-eval.py --validate --evals evals.json`

## Scripts

9. [ ] Chaque script de `scripts/` a un `--help` qui documente son
   contrat et ses codes de sortie
   `python scripts/scan-skill.py .`
   puis `python scripts/<script>.py --help` pour relire le contrat

10. [ ] Aucun script n'imprime un succes inconditionnel. Un script qui
    dit toujours `PASS` ne verifie rien : il faut soit implementer la
    verification, soit declarer dans l'aide qu'elle n'est pas faite.
    Relire `scripts/` — c'est le seul point qui ne se verifie pas par
    commande, il faut ouvrir les fichiers.

## Memoire (si le skill s'appuie sur la memoire projet)

11. [ ] Les decisions citees portent une reference
    `novahiz-docs/<lib>@<version>` verifiable
    `python scripts/check-memory.py --root <projet> --catalog <catalogue>`

## Ce que cette checklist ne couvre pas

Elle ne verifie pas la **qualite editoriale** du corps, ni le declenchement
reel du skill en production. Un skill qui passe les dix points peut
toujours ne jamais se declencher, parce que la description route mal sur
un vocabulaire que personne n'emploie. C'est exactement pour cela que
`evals.json` existe : la checklist valide la forme, les evaluations
valident l'usage.

## Verification globale

```
python scripts/validate-frontmatter.py SKILL.md
python scripts/extract-description.py SKILL.md --dir ../
python scripts/scan-skill.py .
python scripts/run-eval.py --validate --evals evals.json
```
