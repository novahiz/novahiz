#!/usr/bin/env python3
"""Auditer la structure d'un dossier de skill Novahiz.

Contrat honnete : lecture seule, aucun fichier modifie. Signale ce qui
manque, ce qui depasse, et ce qui contredit les regles du contrat
(frontmatter, disclosure progressive, fences equilibrees).

Sortie : rapport texte + code de sortie 1 si un probleme est signale.
"""
import os
import re
import sys

USAGE = """usage: scan-skill.py [DOSSIER] [--help] [--json]

Audite la structure d'un dossier de skill Novahiz.

arguments:
  DOSSIER     dossier du skill (defaut: .)

options:
  --json      sort un JSON au lieu du rapport texte

verifie:
  - presence de SKILL.md, et coherence name <-> nom du dossier
  - corps du SKILL.md <= 500 lignes (au-dela: deplacer dans references/)
  - fences ``` equilibrees
  - references/ lues au niveau 1 (# titre), reliques par pointeur
  - scripts/ executables et dotés d'un --help
  - aucun fichier de sauvegarde (*.novahiz-bak) ni binaire embarque

codes de sortie:
  0  structure saine
  1  au moins un probleme
  2  dossier introuvable

exemples:
  python scan-skill.py .
  python scan-skill.py ../novahiz-wireframe --json
"""

BODY_LINE_LIMIT = 500
SKILL_NAME_RE = re.compile(r"^[a-z0-9-]+$")
BACKUP_SUFFIXES = (".novahiz-bak", ".bak", ".orig", ".swp", ".tmp")
BINARY_SUFFIXES = (".exe", ".dll", ".so", ".dylib", ".bin", ".zip", ".gz")


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def scan(skill_dir):
    report = {"dir": skill_dir, "problems": [], "warnings": [], "info": {}}

    if not os.path.isdir(skill_dir):
        report["problems"].append(f"dossier introuvable: {skill_dir}")
        return report

    entries = sorted(os.listdir(skill_dir))
    files = [e for e in entries if os.path.isfile(os.path.join(skill_dir, e))]
    dirs = [e for e in entries if os.path.isdir(os.path.join(skill_dir, e))]

    report["info"]["files"] = files
    report["info"]["dirs"] = dirs

    if "SKILL.md" not in files:
        report["problems"].append("SKILL.md absent")
        return report

    body = read_text(os.path.join(skill_dir, "SKILL.md")) or ""
    body_lines = body.splitlines()
    report["info"]["body_lines"] = len(body_lines)

    if len(body_lines) > BODY_LINE_LIMIT:
        report["problems"].append(
            f"corps du SKILL.md trop long ({len(body_lines)} > {BODY_LINE_LIMIT} lignes): "
            "deplacer le detail dans references/ avec des pointeurs"
        )

    fences = len(re.findall(r"```", body))
    report["info"]["fences"] = fences
    if fences % 2 != 0:
        report["problems"].append(f"fences ``` non equilibrees ({fences})")

    if not body.lstrip().startswith("---"):
        report["problems"].append("SKILL.md sans frontmatter (doit commencer par ---)")
    else:
        m = re.search(r"(?m)^name:\s*(\S+)", body)
        if m:
            declared = m.group(1)
            report["info"]["declared_name"] = declared
            folder = os.path.basename(os.path.abspath(skill_dir))
            if declared != folder and not SKILL_NAME_RE.match(declared):
                report["problems"].append(
                    f"name '{declared}' invalide: kebab-case [a-z0-9-] attendu"
                )
            elif declared != folder:
                report["warnings"].append(
                    f"name '{declared}' differe du dossier '{folder}': "
                    "le routage par nom peut echouer"
                )

    for missing in ("references", "scripts"):
        if missing not in dirs:
            report["warnings"].append(f"dossier {missing}/ absent")

    for name in files:
        if name.endswith(BACKUP_SUFFIXES):
            report["problems"].append(f"fichier de sauvegarde embarque: {name}")
        if name.lower().endswith(BINARY_SUFFIXES):
            report["warnings"].append(f"binaire embarque: {name}")

    refs_dir = os.path.join(skill_dir, "references")
    if os.path.isdir(refs_dir):
        for name in sorted(os.listdir(refs_dir)):
            path = os.path.join(refs_dir, name)
            if not os.path.isfile(path):
                continue
            text = read_text(path) or ""
            if name.endswith(".md"):
                if not re.search(r"(?m)^#\s+\S", text):
                    report["problems"].append(f"references/{name}: titre de niveau 1 absent")
                if len(text.splitlines()) > 300 and not re.search(
                    r"(?i)sommaire|table des mati|contents", text
                ):
                    report["warnings"].append(
                        f"references/{name} > 300 lignes sans sommaire"
                    )
            if not text.strip():
                report["problems"].append(f"references/{name} vide")

    scripts_dir = os.path.join(skill_dir, "scripts")
    if os.path.isdir(scripts_dir):
        for name in sorted(os.listdir(scripts_dir)):
            path = os.path.join(scripts_dir, name)
            if not os.path.isfile(path):
                continue
            text = read_text(path) or ""
            if not text.strip():
                report["problems"].append(f"scripts/{name} vide")
                continue
            if not re.search(r"--help|-h\b", text):
                report["problems"].append(f"scripts/{name}: aucune aide --help implementee")
            if text.lstrip().startswith("#!") and os.name != "nt" and not os.access(path, os.X_OK):
                report["warnings"].append(f"scripts/{name}: shebang sans bit executable")

    return report


def render(report):
    print(f"Scan de {report['dir']}:")
    info = report["info"]
    if "files" in info:
        print(f"  fichiers racine : {', '.join(info['files']) or '(aucun)'}")
        print(f"  dossiers        : {', '.join(info['dirs']) or '(aucun)'}")
    for key in ("declared_name", "body_lines", "fences"):
        if key in info:
            print(f"  {key:<16}: {info[key]}")
    for warning in report["warnings"]:
        print(f"WARN: {warning}")
    for problem in report["problems"]:
        print(f"FAIL: {problem}")
    if not report["problems"]:
        print("PASS: structure saine")
    else:
        print(f"RESULTAT: {len(report['problems'])} probleme(s), "
              f"{len(report['warnings'])} avertissement(s)")


def main(argv):
    if "--help" in argv or "-h" in argv:
        print(USAGE)
        return 0
    args = [a for a in argv if not a.startswith("--")]
    as_json = "--json" in argv
    report = scan(args[0] if args else ".")
    if as_json:
        import json
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        render(report)
    if any(p.startswith("dossier introuvable") for p in report["problems"]):
        return 2
    return 1 if report["problems"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
