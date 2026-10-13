# Schemas et codes de sortie

Reference unique des artefacts produits par les scripts, et des codes de
sortie. En cas d'ecart entre le corps du SKILL.md et un script, **le
script fait foi** : cette page le reflete, pas l'inverse.

## Artefacts

### evals.json

Entree du workflow. Voir `evals-spec.md` pour la syntaxe des attentes.

```json
{
  "skill_name": "string, obligatoire",
  "version": "string, conseille",
  "evals": [
    {
      "id": "entier, unique",
      "title": "string, conseille",
      "prompt": "string, obligatoire, non vide",
      "expected_output": "string, conseille",
      "expectations": ["string, obligatoire, liste non vide"]
    }
  ]
}
```

### run.json

Produit par `run-eval.py --record`. Metriques d'un transcript, **sans
jugement de reussite**.

```json
{
  "skill_name": "string",
  "eval_id": "entier",
  "recorded_at": "ISO 8601",
  "transcript": "chemin vers le transcript archive",
  "expectations": ["string, recopiees pour reference"],
  "metrics": {
    "chars": "entier",
    "lines": "entier",
    "words": "entier",
    "fences": "entier",
    "fences_balanced": "booleen",
    "non_empty_lines": "entier",
    "sha256": "16 premiers hex",
    "truncated": "booleen",
    "eval_id": "entier",
    "eval_prompt_chars": "entier",
    "expectation_hits": [
      { "expectation": "string", "literal_hit": "booleen | null" }
    ]
  }
}
```

`literal_hit` vaut `null` pour toute attente avec prefixe (`contains:`,
`regex:`...). Une comparaison litterale de `"min_lines:30"` contre le
transcript n'aurait aucun sens et produirait un resultat faux.

### grading.json

Produit par `generate-grading.py`.

```json
{
  "skill_name": "string",
  "eval_id": "entier | string",
  "transcript": "chemin",
  "graded_at": "ISO 8601",
  "expectations": [
    {
      "expectation": "string",
      "kind": "contains|absent|regex|regex_absent|file_exists|min_lines|min_words|contains(libre)|invalid",
      "passed": "booleen",
      "evidence": "string, ce qui a ete teste"
    }
  ],
  "summary": {
    "passed": "entier",
    "failed": "entier",
    "total": "entier",
    "pass_rate": "flottant 0.0..1.0"
  },
  "min_rate": "flottant, seuil applique"
}
```

### comparison.json

Produit par `generate-comparison.py`.

```json
{
  "compared_at": "ISO 8601",
  "blind": "booleen, toujours true",
  "blind_meaning": "string : ce que l'aveuglement couvre, precisement",
  "a": { "source": "chemin", "pass_rate": "flottant", "passed": "entier",
         "failed": "entier", "total": "entier", "eval_id": "entier",
         "failed_kinds": ["string"] },
  "b": { "source": "chemin", "pass_rate": "flottant", "...": "identique a a" },
  "winner": "a | b | tie",
  "outcome": "won | tie",
  "margin": "flottant",
  "reason": "string : le critere decideur",
  "recommendation": "string",
  "is_current_best": "booleen, false si tie"
}
```

**A designe toujours `--a`, B toujours `--b`.** L'aveuglement porte sur
le calcul : le verdict ne lit ni chemin, ni nom de skill, ni `eval_id`.
Il ne melange jamais les fichiers, sinon le rapport attribuerait a A des
chiffres venant de B.

### history.json

Optionnel jusqu'a la premiere comparaison. Une seule entree
`current_best: true`.

```json
{
  "skill_name": "string",
  "history": [
    { "date": "YYYY-MM-DD", "grade_file": "chemin",
      "pass_rate": "flottant", "current_best": "booleen" }
  ]
}
```

## Codes de sortie

Les scripts empruntent la meme grammaire. Un code different de 0 est
toujours une information, jamais un oubli.

| Code | Sens | Scripts |
|---|---|---|
| `0` | operation reussie | tous |
| `1` | verification echouee (FAIL) | validate-frontmatter, scan-skill, extract-description, check-memory, generate-grading |
| `1` | fichier invalide | run-eval (evals.json mal forme) |
| `2` | erreur d'utilisation : fichier absent, argument manquant, dossier introuvable | tous |

Attention a deux distinctions :

- `generate-grading.py` sort `1` quand **une attente echoue**, et `2`
  quand le transcript est introuvable. L'un est un resultat, l'autre un
  abus.
- `generate-comparison.py` sort **toujours `0`** quand la comparaison a
  ete produite, y compris sur un exaequo. Un exaequo est un resultat
  valide, pas un echec.

## Verification

```
python scripts/run-eval.py --help
python scripts/generate-grading.py --help
python scripts/generate-comparison.py --help
```

Chaque script documente ses propres codes dans son aide. Si cette page
et une aide de script divergent, corrigez cette page.
