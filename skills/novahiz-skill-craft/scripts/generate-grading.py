#!/usr/bin/env python3
"""Noter un transcript d'evaluation contre les attentes declares.

C'est le gradeur de la Phase 2. Il compare un transcript produit par
l'agent aux attentes de evals.json, ecrit grading.json et rend un code
de sortie exploitable par la CI.

Syntaxe d'une attente (dans evals.json, champ "expectations") :
  contains:TEXTE     le transcript contient TEXTE (insensible a la casse)
  absent:TEXTE       le transcript ne contient PAS TEXTE
  regex:PATTERN      le motif PCRE/Python matche
  regex_absent:P     le motif ne matche PAS
  file_exists:CHEMIN le chemin existe (relatif au cwd)
  min_lines:N        le transcript a au moins N lignes
  min_words:N        le transcript a au moins N mots
  TEXTE LIBRE        equivalent a contains:TEXTE

Sortie : grading.json + resume sur stdout, code 0 si tout passe, 1 sinon.
"""
import argparse
import datetime as _dt
import json
import os
import re
import sys

USAGE = """usage: generate-grading.py --transcript FILE [--evals FILE] [--id ID]
                          [--out FILE] [--min-rate N] [--json] [--help]

Noter un transcript contre les attentes de evals.json.

options:
  --transcript FILE   transcript produit par l'agent (requis)
  --evals FILE        evals.json (defaut: evals.json)
  --id ID             id de l'evaluation (defaut: 1, ou unique si une seule)
  --out FILE          fichier de sortie (defaut: grading.json)
  --min-rate N        taux de reussite minimal, 0..1 (defaut: 1.0)
  --json              n'ecrit rien, imprime le JSON sur stdout

syntaxe d'une attente:
  contains:TEXTE | absent:TEXTE | regex:PATTERN | regex_absent:PATTERN
  file_exists:CHEMIN | min_lines:N | min_words:N | TEXTE LIBRE

codes de sortie:
  0  toutes les attentes sont satisfaites et taux >= --min-rate
  1  au moins une attente echoue
  2  entrees introuvables

exemples:
  python generate-grading.py --transcript evals/runs/1.md --evals evals.json --id 3
  python generate-grading.py --transcript t.md --min-rate 0.8
"""

PREFIXES = ("contains:", "absent:", "regex:", "regex_absent:",
            "file_exists:", "min_lines:", "min_words:")


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def check_one(expectation, transcript):
    """Retourne (passed, kind, evidence)."""
    exp = expectation.strip()

    if exp.startswith("contains:"):
        needle = exp[len("contains:"):]
        ok = needle.lower() in transcript.lower()
        return ok, "contains", f"recherche de: {needle[:80]}"

    if exp.startswith("absent:"):
        needle = exp[len("absent:"):]
        ok = needle.lower() not in transcript.lower()
        return ok, "absent", f"ne doit pas contenir: {needle[:80]}"

    if exp.startswith("regex:"):
        pattern = exp[len("regex:"):]
        try:
            ok = re.search(pattern, transcript, re.IGNORECASE | re.MULTILINE) is not None
        except re.error as exc:
            return False, "regex", f"motif invalide ({exc})"
        return ok, "regex", f"/{pattern[:80]}/"

    if exp.startswith("regex_absent:"):
        pattern = exp[len("regex_absent:"):]
        try:
            ok = re.search(pattern, transcript, re.IGNORECASE | re.MULTILINE) is None
        except re.error as exc:
            return False, "regex_absent", f"motif invalide ({exc})"
        return ok, "regex_absent", f"/{pattern[:80]}/"

    if exp.startswith("file_exists:"):
        target = exp[len("file_exists:"):]
        ok = os.path.exists(target)
        return ok, "file_exists", target

    if exp.startswith("min_lines:"):
        raw = exp[len("min_lines:"):]
        try:
            want = int(raw)
        except ValueError:
            return False, "min_lines", f"seuil non entier: {raw}"
        got = len(transcript.splitlines())
        return got >= want, "min_lines", f"{got} ligne(s), {want} attendu(es)"

    if exp.startswith("min_words:"):
        raw = exp[len("min_words:"):]
        try:
            want = int(raw)
        except ValueError:
            return False, "min_words", f"seuil non entier: {raw}"
        got = len(re.findall(r"\S+", transcript))
        return got >= want, "min_words", f"{got} mot(s), {want} attendu(s)"

    ok = exp.lower() in transcript.lower()
    return ok, "contains(libre)", f"recherche de: {exp[:80]}"


def grade(transcript, eval_item):
    expectations = eval_item.get("expectations") or []
    results = []
    for expectation in expectations:
        if not isinstance(expectation, str):
            results.append({"expectation": str(expectation), "kind": "invalid",
                            "passed": False, "evidence": "attente non textuelle"})
            continue
        passed, kind, evidence = check_one(expectation, transcript)
        results.append({"expectation": expectation, "kind": kind,
                        "passed": passed, "evidence": evidence})
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    return {
        "expectations": results,
        "summary": {
            "passed": passed,
            "failed": total - passed,
            "total": total,
            "pass_rate": round(passed / total, 4) if total else 0.0,
        },
    }


def main(argv):
    parser = argparse.ArgumentParser(
        prog="generate-grading.py", add_help=False,
        description="Noter un transcript contre les attentes de evals.json."
    )
    parser.add_argument("--help", "-h", action="store_true")
    parser.add_argument("--transcript")
    parser.add_argument("--evals", default="evals.json")
    parser.add_argument("--id")
    parser.add_argument("--out", default="grading.json")
    parser.add_argument("--min-rate", type=float, default=1.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.help:
        print(USAGE)
        return 0
    if not args.transcript:
        print(USAGE)
        return 2

    if not os.path.isfile(args.transcript):
        print(f"FAIL: transcript introuvable: {args.transcript}")
        return 2

    if os.path.isfile(args.evals):
        data = load_json(args.evals)
        evals = data.get("evals", [])
        if args.id is not None:
            match = [e for e in evals if str(e.get("id")) == str(args.id)]
            if not match:
                print(f"FAIL: aucun eval d'id {args.id}")
                return 2
            eval_item = match[0]
        elif len(evals) == 1:
            eval_item = evals[0]
        else:
            ids = [e.get("id") for e in evals]
            print(f"FAIL: plusieurs evals {ids}, preciser --id")
            return 2
        skill_name = data.get("skill_name")
    else:
        eval_item = {"id": args.id or "adhoc", "expectations": []}
        skill_name = "ad-hoc"
        print(f"WARN: {args.evals} absent : notation ad hoc sans attente declaree")

    with open(args.transcript, "r", encoding="utf-8", errors="replace") as handle:
        transcript = handle.read()

    graded = grade(transcript, eval_item)
    payload = {
        "skill_name": skill_name,
        "eval_id": eval_item.get("id"),
        "transcript": args.transcript,
        "graded_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "expectations": graded["expectations"],
        "summary": graded["summary"],
        "min_rate": args.min_rate,
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"Grade de l'eval {eval_item.get('id')} ({skill_name}):")
        for item in graded["expectations"]:
            mark = "PASS" if item["passed"] else "FAIL"
            print(f"  [{mark}] {item['kind']:<15} {item['expectation'][:70]}")
        summary = graded["summary"]
        print(f"  {summary['passed']}/{summary['total']} satisfaites "
              f"(taux {summary['pass_rate']:.0%}, seuil {args.min_rate:.0%})")
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
        print(f"Ecrit: {args.out}")

    ok = graded["summary"]["failed"] == 0 and graded["summary"]["pass_rate"] >= args.min_rate
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
