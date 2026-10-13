#!/usr/bin/env python3
"""Verifier la coherence de la memoire projet avec le code actuel.

Contrairement a ce que son nom pouvait laisser croire, ce script ne dit
pas PASS par defaut. Il relit les notes et cherche du concret :

  1. les citations de documentation au format novahiz-docs/<lib>@<version>
     - la bibliotheque existe-t-elle dans le catalogue docs ?
     - la version citee existe-t-elle encore ?
  2. les chemins absolus de machine, qu'aucune note ne doit porter
  3. les secrets ou jetons en clair
  4. les notes vides ou trop anciennes pour etre encore fiables

Sans catalogue consultable, la verification de version est impossible :
le script le dit (WARN), il ne pretends pas que tout va bien.

Sortie : rapport + code 0 (propre) ou 1 (probleme).
"""
import argparse
import datetime as _dt
import json
import os
import re
import sys

USAGE = """usage: check-memory.py [--root DIR] [--catalog FILE] [--max-age-days N]
                       [--json] [--help]

Verifier la coherence memoire / code.

options:
  --root DIR           racine du projet (defaut: cwd). Cherche MEMORY.md
                       et project-memory/slots/*.md en dessous.
  --catalog FILE       catalogue docs (defaut: mcp/novahiz-docs/data/catalog.json)
  --max-age-days N     age au-dela duquel une note est signalee (defaut: 60)
  --json               rapport JSON sur stdout

verifie:
  - citations novahiz-docs/<lib>@<version> : bibliotheque et version
  - chemins absolus de machine dans les notes
  - secrets / jetons en clair
  - notes vides ou trop anciennes

codes de sortie:
  0  memoire coherente (des WARN sont possibles)
  1  au moins un probleme
  2  dossier introuvable

exemples:
  python check-memory.py --root .
  python check-memory.py --root . --catalog ../../mcp/novahiz-docs/data/catalog.json
"""

CITATION = re.compile(r"novahiz-docs/([A-Za-z0-9][\w.\-]*)@([^\s`)\],;]+)")
ABSOLUTE_PATH = re.compile(r"([A-Za-z]:\\|/(?:Users|home|root)/)[^\s`\"')]+")
SECRET_PATTERNS = [
    (re.compile(r"\bsk-[A-Za-z0-9]{16,}"), "format de cle API"),
    (re.compile(r"\bghp_[A-Za-z0-9]{20,}"), "token GitHub"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "cle AWS"),
    (re.compile(r"(?i)\b(api[_-]?key|secret|passwd|password)\b\s*[:=]\s*['\"]?[A-Za-z0-9/+_-]{12,}"),
     "secret en clair"),
]
FRONTMATTER_DATE = re.compile(r"(?im)^\s*(?:updated|date|created)\s*:\s*(\d{4}-\d{2}-\d{2})")


def collect_notes(root):
    """Chemin -> contenu, pour MEMORY.md et les slots."""
    notes = {}
    memory_md = os.path.join(root, "MEMORY.md")
    if os.path.isfile(memory_md):
        notes[memory_md] = _read(memory_md)
    slots_dir = os.path.join(root, "project-memory", "slots")
    if os.path.isdir(slots_dir):
        for name in sorted(os.listdir(slots_dir)):
            if name.endswith(".md"):
                path = os.path.join(slots_dir, name)
                notes[path] = _read(path)
    return notes


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def load_catalog(path):
    """Retourne {lib: set(versions)} ou None si indisponible."""
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None

    libraries = {}
    if isinstance(data, list):
        entries = data
    elif isinstance(data, dict):
        entries = data.get("libraries", data.get("entries", []))
        if isinstance(entries, dict):
            entries = [{"name": k, **(v if isinstance(v, dict) else {})}
                       for k, v in entries.items()]
    else:
        # JSON valide mais de la mauvaise forme (chaine, nombre, bool) :
        # on refuse plutot que de planter sur .get() d'un scalaire.
        return None
    if not isinstance(entries, list):
        return None
    for item in entries:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("library") or item.get("id")
        if not name:
            continue
        versions = item.get("versions") or item.get("version")
        if isinstance(versions, str):
            versions = [versions]
        libraries[str(name)] = set(str(v) for v in (versions or []))
    return libraries or None


def check(root, catalog_path, max_age):
    report = {"root": root, "notes": 0, "problems": [], "warnings": [],
              "citations": [], "catalog": "absent"}

    if not os.path.isdir(root):
        report["problems"].append(f"dossier introuvable: {root}")
        return report

    notes = collect_notes(root)
    report["notes"] = len(notes)
    if not notes:
        report["warnings"].append("aucune note trouvee (MEMORY.md ni project-memory/slots)")
        return report

    catalog = load_catalog(catalog_path)
    report["catalog"] = "present" if catalog else "absent"
    if catalog is None:
        report["warnings"].append(
            "catalogue docs indisponible : existence des bibliotheques et versions "
            "non verifiable. Passez --catalog."
        )

    today = _dt.date.today()
    citations = 0

    for path, content in notes.items():
        rel = os.path.relpath(path, root)
        if not content.strip():
            report["problems"].append(f"{rel}: note vide")
            continue

        # Compteur PAR note. L'ancienne version testait un compteur global :
        # des qu'une note cite, plus aucune note suivante n'est signalee,
        # ce qui rendait l'avertissement dependant de l'ordre de lecture.
        note_citations = 0
        for match in CITATION.finditer(content):
            note_citations += 1
            citations += 1
            lib, version = match.group(1), match.group(2)
            entry = {"note": rel, "library": lib, "version": version}
            if catalog is not None:
                if lib not in catalog:
                    report["problems"].append(
                        f"{rel}: cite novahiz-docs/{lib}@{version} mais '{lib}' "
                        "est absente du catalogue docs"
                    )
                elif catalog[lib] and version not in catalog[lib]:
                    report["warnings"].append(
                        f"{rel}: version {version} de '{lib}' hors catalogue "
                        f"(disponibles: {sorted(catalog[lib])[:5]})"
                    )
                    entry["version_drift"] = True
            report["citations"].append(entry)

        if note_citations == 0 and len(content) > 400:
            report["warnings"].append(
                f"{rel}: note substantielle sans aucune citation novahiz-docs/<lib>@<version>"
            )

        for match in ABSOLUTE_PATH.finditer(content):
            report["problems"].append(
                f"{rel}: chemin absolu de machine ({match.group(0)[:60]})"
            )

        for pattern, label in SECRET_PATTERNS:
            if pattern.search(content):
                report["problems"].append(f"{rel}: {label}")

        dates = [d for d in FRONTMATTER_DATE.findall(content)]
        if dates:
            try:
                latest = max(_dt.date.fromisoformat(d) for d in dates)
                age = (today - latest).days
                if age > max_age:
                    report["warnings"].append(
                        f"{rel}: derniere date {latest} ({age} j > {max_age} j): "
                        "verifier qu'elle est encore valide avant de s'y fier"
                    )
            except ValueError:
                report["warnings"].append(f"{rel}: date de frontmatter mal formee")

    report["citations_found"] = citations
    if citations == 0:
        report["warnings"].append(
            "aucune citation novahiz-docs/<lib>@<version> : les decisions liees a une "
            "bibliotheque ne sont pas verifiables ulterieurement"
        )
    return report


def main(argv):
    parser = argparse.ArgumentParser(
        prog="check-memory.py", add_help=False,
        description="Verifier la coherence memoire / code (ne dit pas PASS par defaut)."
    )
    parser.add_argument("--help", "-h", action="store_true")
    parser.add_argument("--root", default=".")
    parser.add_argument("--catalog", default=os.path.join(
        "mcp", "novahiz-docs", "data", "catalog.json"))
    parser.add_argument("--max-age-days", type=int, default=60)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.help:
        print(USAGE)
        return 0

    report = check(args.root, args.catalog, args.max_age_days)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"Memoire de {os.path.abspath(args.root)}: {report['notes']} note(s), "
              f"catalogue docs {report['catalog']}, "
              f"{report.get('citations_found', 0)} citation(s)")
        for warning in report["warnings"]:
            print(f"WARN: {warning}")
        for problem in report["problems"]:
            print(f"FAIL: {problem}")
        if report["problems"]:
            print(f"RESULTAT: {len(report['problems'])} probleme(s)")
        else:
            print("PASS: aucun probleme structurel detecte")

    if any(p.startswith("dossier introuvable") for p in report["problems"]):
        return 2
    return 1 if report["problems"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
