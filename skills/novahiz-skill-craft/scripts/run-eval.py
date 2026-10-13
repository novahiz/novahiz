#!/usr/bin/env python3
"""Structurer et mesurer une evaluation de skill.

CONTRAT HONNETE - lisez ceci avant de l'utiliser.

Ce script N'INVOQUE AUCUN MODELE. Executer un prompt contre un skill
exige une session d'agent : c'est vous (l'agent) qui lancez le prompt
dans votre session, puis qui deposersez le transcript obtenu.

Ce script fait exactement trois choses, et rien d'autre :
  1. --validate  : verifie qu'un evals.json est bien forme.
  2. mesure      : lit le transcript fourni et en extrait des metriques.
  3. --record    : archive le transcript + ses metriques sous evals/runs/.

Il ne note PAS la reussite (c'est le role de generate-grading.py) et ne
compare PAS deux versions (generate-comparison.py).

Sortie : metriques sur stdout, run.json si --record, code 0/1.
"""
import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import sys

USAGE = """usage: run-eval.py (--validate | --transcript FILE) [options] [--help]

Structurer et mesurer une evaluation de skill. NE LANCE AUCUN MODELE :
vous produisez le transcript dans votre session d'agent, puis vous le
passez ici.

modes:
  --validate              verifie la forme de evals.json et sort
  --transcript FILE       mesure le transcript produit par l'agent

options:
  --evals FILE            evals.json (defaut: evals.json)
  --id ID                 id de l'evaluation concernee (defaut: 1)
  --skill DIR             dossier du skill evalue (optionnel)
  --record                archive sous evals/runs/<ISO>/<id>.md + run.json
  --out DIR               racine d'archive (defaut: evals/runs)
  --json                  sort les metriques en JSON

codes de sortie:
  0  operation reussie
  1  evals.json invalide
  2  transcript ou evals.json introuvable

workflow reel:
  1. definir evals.json            (voir references/evals-spec.md)
  2. python run-eval.py --validate
  3. dans votre session d'agent, lancer chaque prompt et capturer la sortie
  4. python run-eval.py --transcript sortie.md --id 1 --record
  5. python generate-grading.py --transcript evals/runs/<run>/1.md --evals evals.json
"""

REQUIRED_EVAL_KEYS = {"id", "prompt"}


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_evals(evals_path):
    """Verifie la forme de evals.json. Retourne (data, erreurs)."""
    problems = []
    try:
        data = load_json(evals_path)
    except FileNotFoundError:
        return None, [f"introuvable: {evals_path}"]
    except json.JSONDecodeError as exc:
        return None, [f"JSON invalide: {exc}"]

    if not isinstance(data, dict):
        return None, ["la racine doit etre un objet"]
    if "skill_name" not in data:
        problems.append("champ 'skill_name' manquant")
    evals = data.get("evals")
    if not isinstance(evals, list) or not evals:
        problems.append("'evals' doit etre une liste non vide")
        return data, problems

    seen = set()
    for i, item in enumerate(evals):
        where = f"evals[{i}]"
        if not isinstance(item, dict):
            problems.append(f"{where}: doit etre un objet")
            continue
        missing = REQUIRED_EVAL_KEYS - set(item)
        if missing:
            problems.append(f"{where}: cles manquantes {sorted(missing)}")
        eid = item.get("id")
        if eid in seen:
            problems.append(f"{where}: id {eid} en double")
        seen.add(eid)
        if not str(item.get("prompt", "")).strip():
            problems.append(f"{where}: prompt vide")
        expectations = item.get("expectations")
        if expectations is not None:
            if not isinstance(expectations, list):
                problems.append(f"{where}: 'expectations' doit etre une liste")
            elif not expectations:
                problems.append(f"{where}: 'expectations' vide : aucune attente verifiable")
            else:
                for j, exp in enumerate(expectations):
                    if not isinstance(exp, str) or not exp.strip():
                        problems.append(f"{where}.expectations[{j}]: doit etre une chaine non vide")
    return data, problems


def find_eval(data, wanted):
    for item in data.get("evals", []):
        if str(item.get("id")) == str(wanted):
            return item
    return None


def metrics(transcript, eval_item=None):
    """Metriques du transcript. Aucune pretention a la reussite."""
    lines = transcript.splitlines()
    fences = len(re.findall(r"```", transcript))
    words = re.findall(r"\S+", transcript)
    out = {
        "chars": len(transcript),
        "lines": len(lines),
        "words": len(words),
        "fences": fences,
        "fences_balanced": fences % 2 == 0,
        "non_empty_lines": sum(1 for l in lines if l.strip()),
        "sha256": hashlib.sha256(transcript.encode("utf-8")).hexdigest()[:16],
        "truncated": transcript.endswith("...") or len(transcript) > 200000,
    }
    if eval_item:
        out["eval_id"] = eval_item.get("id")
        out["eval_prompt_chars"] = len(str(eval_item.get("prompt", "")))
        # Un appariement litteral n'a de sens que pour une attente sans
        # prefixe. "min_lines:30" ne doit surtout pas etre cherche tel quel
        # dans le transcript : ce serait un resultat faux et trompeur.
        expectations = eval_item.get("expectations") or []
        lowered = transcript.lower()
        plain, structured = [], []
        for exp in expectations:
            if not isinstance(exp, str):
                continue
            if re.match(r"^(contains:|absent:|regex:|regex_absent:|file_exists:|"
                        r"min_lines:|min_words:)", exp):
                structured.append({"expectation": exp, "literal_hit": None})
            else:
                plain.append({"expectation": exp,
                              "literal_hit": exp.lower() in lowered})
        out["expectation_hits"] = plain + structured
    return out


def record(data, eval_item, transcript, out_root):
    stamp = _dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    run_dir = os.path.join(out_root, stamp)
    os.makedirs(run_dir, exist_ok=True)
    eid = str(eval_item.get("id"))
    transcript_path = os.path.join(run_dir, f"{eid}.md")
    with open(transcript_path, "w", encoding="utf-8") as handle:
        handle.write(transcript)
    payload = {
        "skill_name": data.get("skill_name"),
        "eval_id": eval_item.get("id"),
        "recorded_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "transcript": transcript_path,
        "expectations": eval_item.get("expectations", []),
        "metrics": metrics(transcript, eval_item),
    }
    run_path = os.path.join(run_dir, "run.json")
    with open(run_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    return run_dir, transcript_path, run_path


def main(argv):
    parser = argparse.ArgumentParser(
        prog="run-eval.py", add_help=False,
        description="Structurer et mesurer une evaluation de skill (aucun modele invoque)."
    )
    parser.add_argument("--help", "-h", action="store_true")
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--transcript")
    parser.add_argument("--evals", default="evals.json")
    parser.add_argument("--id", default="1")
    parser.add_argument("--skill")
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--out", default=os.path.join("evals", "runs"))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.help:
        print(USAGE)
        return 0

    if not args.validate and not args.transcript:
        print(USAGE)
        return 2

    data, problems = validate_evals(args.evals)
    if problems:
        print(f"FAIL: {args.evals} invalide:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    if args.validate:
        count = len(data.get("evals", []))
        if args.json:
            print(json.dumps({"valid": True, "skill_name": data.get("skill_name"),
                              "evals": count}, indent=2, ensure_ascii=False))
        else:
            print(f"PASS: {args.evals} bien forme ({count} evaluation(s), "
                  f"skill: {data.get('skill_name')})")
        return 0

    if not os.path.isfile(args.transcript):
        print(f"FAIL: transcript introuvable: {args.transcript}")
        return 2

    eval_item = find_eval(data, args.id)
    if eval_item is None:
        ids = [e.get("id") for e in data.get("evals", [])]
        print(f"FAIL: aucun eval d'id {args.id} (disponibles: {ids})")
        return 1

    with open(args.transcript, "r", encoding="utf-8", errors="replace") as handle:
        transcript = handle.read()

    result = metrics(transcript, eval_item)

    if args.record:
        run_dir, transcript_path, run_path = record(data, eval_item, transcript, args.out)
        result["run_dir"] = run_dir
        result["transcript"] = transcript_path
        result["run_json"] = run_path

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Metriques du transcript (eval {eval_item.get('id')}, "
              f"{data.get('skill_name')}):")
        for key in ("chars", "lines", "words", "non_empty_lines", "fences", "sha256"):
            print(f"  {key:<16}: {result[key]}")
        if not result["fences_balanced"]:
            print("WARN: fences ``` non equilibrees dans le transcript")
        if result.get("truncated"):
            print("WARN: transcript tronque ou tres volumineux")
        for hit in result.get("expectation_hits", []):
            # None = attente structuree : l'appariement litteral ne s'applique
            # pas, on ne doit ni afficher "present" ni "ABSENT".
            if hit["literal_hit"] is None:
                mark = "str."
            else:
                mark = "present" if hit["literal_hit"] else "ABSENT"
            print(f"  [{mark:<8}] {hit['expectation']}")
        print("NOTE: ce script ne note pas la reussite. Ensuite :")
        print("  python generate-grading.py --transcript <fichier> --evals", args.evals)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
