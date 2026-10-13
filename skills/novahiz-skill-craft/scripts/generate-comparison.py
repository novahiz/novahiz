#!/usr/bin/env python3
"""Comparer deux notes de skill de maniere aveugle (A/B).

Deux grading.json (sortie de generate-grading.py) entrent, un verdict
sort. Un exaequo est un resultat valide, pas un echec.

AVEUGLEMENT - ce que cela veut dire ici, precisement :
  le calcul n'utilise QUE les chiffres. Il ignore les chemins de
  fichiers, les noms de skills et les eval_id. Rien n'est melange ni
  reassigne : A designe TOUJOURS le fichier passe avec --a, et B celui
  de --b, de sorte que chaque chiffre reste attribuable a sa source.
  Un "aveuglement" qui melangerait les fichiers produirait un rapport
  dont l'attribution est fausse : c'est un piege, pas une garantie.

Departage, dans l'ordre :
  1. taux de reussite le plus eleve
  2. en cas d'egalite, le moins d'attentes echouees
  3. puis le moins d'attentes au total (une version qui en promet
     moins ne doit pas gagner sur un silence complice)
  4. sinon exaequo

Sortie : comparison.json + verdict sur stdout, code 0.
"""
import argparse
import datetime as _dt
import json
import sys

USAGE = """usage: generate-comparison.py --a GRADE1 --b GRADE2 [--out FILE]
                              [--json] [--help]

Comparer deux grading.json de maniere aveugle.

options:
  --a FILE     premier grading.json (rapporte comme A)
  --b FILE     second grading.json (rapporte comme B)
  --out FILE   fichier de sortie (defaut: comparison.json)
  --json       imprime le JSON sur stdout au lieu d'ecrire --out

aveuglement:
  le calcul ignore chemins, noms de skills et eval_id. A designe
  toujours --a et B toujours --b : rien n'est melange, chaque chiffre
  reste attribuable a sa source.

departage (dans l'ordre):
  1. taux de reussite   2. moins d'echecs   3. moins d'attentes   4. exaequo

codes de sortie:
  0  comparaison produite (un exaequo est un resultat valide)

workflow reel:
  1. version A -> evals.json -> transcripts -> generate-grading.py --out a.json
  2. version B -> memes evals          -> generate-grading.py --out b.json
  3. python generate-comparison.py --a a.json --b b.json
  4. le gagnant devient current_best dans history.json
"""

MANDATORY = ("summary",)


def load(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def signature(payload):
    """Resume d'un grading, sans nom de skill ni chemin (aveuglement)."""
    summary = payload.get("summary") or {}
    failed = [e for e in payload.get("expectations", []) if not e.get("passed")]
    return {
        "eval_id": payload.get("eval_id"),
        "pass_rate": float(summary.get("pass_rate", 0.0)),
        "passed": int(summary.get("passed", 0)),
        "failed": int(summary.get("failed", 0)),
        "total": int(summary.get("total", 0)),
        "failed_kinds": sorted({e.get("kind", "?") for e in failed}),
    }


def decide(sig_a, sig_b):
    """Departage en aveugle. Retourne (gagnant, raison)."""
    if sig_a["pass_rate"] != sig_b["pass_rate"]:
        winner = "a" if sig_a["pass_rate"] > sig_b["pass_rate"] else "b"
        return winner, "taux de reussite"
    if sig_a["failed"] != sig_b["failed"]:
        winner = "a" if sig_a["failed"] < sig_b["failed"] else "b"
        return winner, "nombre d'attentes echouees"
    if sig_a["total"] != sig_b["total"]:
        winner = "a" if sig_a["total"] < sig_b["total"] else "b"
        return winner, "nombre d'attentes declarees (plus compact)"
    return "tie", "resultats identiques sur les trois criteres"


def main(argv):
    parser = argparse.ArgumentParser(
        prog="generate-comparison.py", add_help=False,
        description="Comparer deux grading.json de maniere aveugle."
    )
    parser.add_argument("--help", "-h", action="store_true")
    parser.add_argument("--a")
    parser.add_argument("--b")
    parser.add_argument("--out", default="comparison.json")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.help:
        print(USAGE)
        return 0
    if not args.a or not args.b:
        print(USAGE)
        return 2
    for path in (args.a, args.b):
        try:
            load(path)
        except OSError as exc:
            print(f"FAIL: {path} introuvable")
            return 2
        except json.JSONDecodeError as exc:
            print(f"FAIL: {path} JSON invalide ({exc})")
            return 2

    gradings = {"a": load(args.a), "b": load(args.b)}
    for key, payload in gradings.items():
        for field in MANDATORY:
            if field not in payload:
                print(f"FAIL: {key} sans champ '{field}' : ce n'est pas un grading.json")
                return 2

    # L'aveuglement porte sur le CALCUL : signature() ne retient que des
    # chiffres (pas de chemin, pas de nom de skill), et decide() ne lit
    # que ces chiffres. On ne reassigne JAMAIS un fichier a l'autre étiquette,
    # sinon le rapport attribuerait a A des chiffres venant de B.
    sig_a = signature(gradings["a"])
    sig_b = signature(gradings["b"])
    winner, reason = decide(sig_a, sig_b)

    if winner == "tie":
        outcome = "tie"
        margin = 0.0
        recommendation = "exaequo : le choix revient a l'utilisateur"
    else:
        outcome = "won"
        margin = round(abs(sig_a["pass_rate"] - sig_b["pass_rate"]), 4)
        recommendation = (f"version {winner.upper()} en tete : elle satisfait "
                          f"{max(sig_a['passed'], sig_b['passed'])}/"
                          f"{max(sig_a['total'], sig_b['total'])} attentes")

    payload = {
        "compared_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "blind": True,
        "blind_meaning": ("le calcul ignore chemins, noms de skills et eval_id; "
                          "A designe toujours --a, B toujours --b"),
        "a": {"source": args.a, **sig_a},
        "b": {"source": args.b, **sig_b},
        "winner": winner,
        "outcome": outcome,
        "margin": margin,
        "reason": reason,
        "recommendation": recommendation,
        "is_current_best": winner != "tie",
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"A ({args.a}): taux {sig_a['pass_rate']:.0%} "
              f"({sig_a['passed']}/{sig_a['total']}), {sig_a['failed']} echec(s)")
        print(f"B ({args.b}): taux {sig_b['pass_rate']:.0%} "
              f"({sig_b['passed']}/{sig_b['total']}), {sig_b['failed']} echec(s)")
        print(f"VERDICT: {winner.upper()} - {reason}")
        print(f"  marge: {margin:.0%} - {recommendation}")
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
        print(f"Ecrit: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
