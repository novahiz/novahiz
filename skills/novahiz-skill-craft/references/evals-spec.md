# Specification des evaluations

Un skill sans evaluation n'est pas un skill livre, c'est une hypothesis.
Cette spec definit le format `evals.json` et la syntaxe des attentes.

## Format evals.json

```json
{
  "skill_name": "novahiz-exemple",
  "version": "1.0.0",
  "evals": [
    {
      "id": 1,
      "title": "Titre lisible de l'evaluation",
      "prompt": "Le prompt execute dans une session d'agent.",
      "expected_output": "Description du resultat attendu.",
      "expectations": [
        "contains:du texte attendu",
        "absent:un texte interdit",
        "regex:(?i)un motif",
        "file_exists:CHANGELOG.md",
        "min_lines:30"
      ]
    }
  ]
}
```

| Champ | Obligation | Note |
|---|---|---|
| `skill_name` | obligatoire | nom du skill evalue |
| `evals` | obligatoire | liste non vide |
| `evals[].id` | obligatoire | entier, unique dans le fichier |
| `evals[].prompt` | obligatoire | non vide, c'est le stimulus reel |
| `evals[].expectations` | obligatoire | liste non vide d'attentes verifiables |
| `evals[].title` | conseille | rend le rapport lisible |
| `evals[].expected_output` | conseille | contrat humain, non lu par le script |

Un `evals` vide, un `id` en double ou un `prompt` vide sont des echecs
durs : `run-eval.py --validate` refuse le fichier.

## Syntaxe des attentes

| Attente | Verifie |
|---|---|
| `contains:TEXTE` | `TEXTE` present, insensible a la casse |
| `absent:TEXTE` | `TEXTE` absent |
| `regex:PATTERN` | motif Python matche (`IGNORECASE` + `MULTILINE`) |
| `regex_absent:P` | motif ne matche pas |
| `file_exists:CHEMIN` | le chemin existe, relatif au cwd |
| `min_lines:N` | au moins N lignes |
| `min_words:N` | au moins N mots |
| `TEXTE LIBRE` | equivalent a `contains:TEXTE` |

Le texte libre est pratique pour un brouillon, mais il rend le rapport
ambigu : on ne sait pas si l'attente portait sur une presence ou un motif.
Ensuite de la phase de prototypage, prefixez explicitement.

## Ce qu'une attente ne peut pas dire

Une attente porte sur le **transcript**, pas sur la verite du monde.
`contains:fichier cree` ne verifie pas qu'un fichier a ete cree : il
verifie que les mots apparaissez. Pour un fait materiel, utilisez
`file_exists:chemin`, ou sortez le fait du transcript et notez-le hors
transcript. C'est la difference entre un skill qui rapporte et un skill
qui agit.

## Nombre d'evaluations

Trois a six. Moins de trois, le corpus ne couvre pas les cas limites.
Plus de six, la suite devient un coup d'entretien et se derespecte.

Chaque skill doit contenir au moins :
- un cas nominal (le prompt courant),
- un cas ou le skill doit **refuser** ou signaler ses limites,
- un cas ou l'utilisateur est ambigu (le skill devrait clarifier).

## Workflow reel

Ce chainage suppose que **vous** produisez les transcripts : aucun script
de ce skill n'invoque un modele.

```
# 1. definir les evaluations
$EDITOR evals.json

# 2. verifier la forme
python scripts/run-eval.py --validate --evals evals.json

# 3. pour chaque eval : lancer le prompt dans votre session d'agent,
#    capturer la sortie dans un fichier
#    (par exemple evals/transcripts/1.md)

# 4. mesurer et archiver
python scripts/run-eval.py --transcript evals/transcripts/1.md \
    --evals evals.json --id 1 --record

# 5. noter
python scripts/generate-grading.py --transcript evals/runs/<run>/1.md \
    --evals evals.json --id 1 --out grade.json

# 6. comparer deux versions du skill
python scripts/generate-comparison.py --a grade-avant.json --b grade-apres.json
```

## Historique

`history.json` n'est pas obligatoire au depart. Il le devient quand une
comparaison a deja eu lieu :

```json
{
  "skill_name": "novahiz-exemple",
  "history": [
    {
      "date": "2026-10-13",
      "grade_file": "evals/grades/2026-10-13.json",
      "pass_rate": 1.0,
      "current_best": true
    }
  ]
}
```

Une seule entree porte `current_best: true`. Avant de l'ecrire, verifiez
par `generate-comparison.py` que la nouvelle version gagne bien : c'est
le seul point ou une affirmation de reussite est acceptee, et elle doit
etre precedee d'un verdict.

## Verification

```
python scripts/run-eval.py --validate --evals evals.json
python scripts/generate-grading.py --transcript <f> --evals evals.json --id 1
```
