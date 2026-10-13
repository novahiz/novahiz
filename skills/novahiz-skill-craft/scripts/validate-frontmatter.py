#!/usr/bin/env python3
"""Valider le frontmatter d'un SKILL.md Novahiz.

Contrat honnete : ce script ne fait QUE du lint statique sur le bloc YAML
d'en-tete. Il ne juge ni la qualite du corps, ni le declenchement reel.

Sortie : PASS/FAIL sur stdout, detail des erreurs, code de sortie 0/1.
"""
import re
import sys

USAGE = """usage: validate-frontmatter.py [SKILL.md] [--help]

Valide le frontmatter YAML d'un SKILL.md Novahiz.

arguments:
  SKILL.md          chemin du fichier (defaut: SKILL.md)

verifie:
  - separateur --- en debut de fichier et frontmatter ferme
  - YAML analysable
  - name        kebab-case [a-z0-9-], <= 64 car., sans tiret en bord
  - description non vide, <= 1024 car., sans balise XML
  - license     presente
  - compatibility et metadata (author, version) : WARN si absentes
  - aucun secret ni chemin absolu machine dans le frontmatter

codes de sortie:
  0  PASS (des WARN sont possibles)
  1  FAIL
  2  erreur d'utilisation (fichier absent)

exemples:
  python validate-frontmatter.py SKILL.md
  python validate-frontmatter.py ../novahiz-prd/SKILL.md
"""

SECRET_PATTERNS = [
    (re.compile(r"(?i)\b(api[_-]?key|secret|token|passwd|password)\b\s*[:=]\s*\S+"),
     "valeur qui ressemble a un secret"),
    (re.compile(r"\bsk-[A-Za-z0-9]{16,}"), "format de cle API"),
    (re.compile(r"\bghp_[A-Za-z0-9]{20,}"), "token GitHub"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "cle AWS"),
]
ABSOLUTE_PATH = re.compile(r"([A-Za-z]:\\|/(?:Users|home|root)/)\S+")
NAME_RE = re.compile(r"^[a-z0-9-]+$")


def split_frontmatter(content):
    """Retourne (frontmatter, reste, erreur)."""
    if not content.startswith("---"):
        return None, content, "le fichier doit commencer par ---"
    lines = content.splitlines()
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "\n".join(lines[1:i]), "\n".join(lines[i + 1:]), None
    return None, content, "separateur --- de fin manquant"


def parse_yaml(front):
    """Analyse le YAML. PyYAML si present, repli structure sinon."""
    try:
        import yaml  # type: ignore
        return yaml.safe_load(front), None
    except ImportError:
        data, current = {}, None
        for line in front.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if line.startswith("  ") and current:
                if isinstance(data[current], dict):
                    m = re.match(r"^\s+([\w-]+):\s*(.*)$", line)
                    if m:
                        data[current][m.group(1)] = m.group(2).strip()
                continue
            m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
            if m:
                current = m.group(1)
                raw = m.group(2).strip()
                data[current] = raw if raw else {}
        return data, None
    except Exception as exc:
        return None, f"YAML invalide : {exc}"


def validate(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except OSError as exc:
        print(f"FAIL: impossible de lire {path} : {exc.strerror}")
        return 2

    front, _body, err = split_frontmatter(content)
    if err:
        print(f"FAIL: {err}")
        return 1

    data, err = parse_yaml(front)
    if err:
        print(f"FAIL: {err}")
        return 1
    if not isinstance(data, dict):
        print("FAIL: le frontmatter n'est pas un mapping YAML")
        return 1

    errors, warns = [], []

    name = data.get("name")
    if name is None:
        errors.append("champ name manquant")
    else:
        name = str(name)
        if not name:
            errors.append("name vide")
        if len(name) > 64:
            errors.append(f"name trop long ({len(name)} > 64)")
        if not NAME_RE.match(name):
            errors.append("name doit etre kebab-case [a-z0-9-]")
        if name.startswith("-") or name.endswith("-"):
            errors.append("name ne doit pas commencer/finir par tiret")

    desc = data.get("description")
    if desc is None:
        errors.append("champ description manquant")
    else:
        desc = str(desc).strip()
        if not desc:
            errors.append("description vide")
        if len(desc) > 1024:
            errors.append(f"description trop longue ({len(desc)} > 1024)")
        if "<" in desc or ">" in desc:
            errors.append("description contient des balises XML (< >)")
        if len(desc) < 40:
            warns.append("description tres courte: elle ne portera pas le routage")

    if not data.get("license"):
        errors.append("champ license manquant")

    if not data.get("compatibility"):
        warns.append("champ compatibility absent (opencode recommande)")
    meta = data.get("metadata")
    if not isinstance(meta, dict) or not meta:
        warns.append("metadata absent (author, version attendus)")
    else:
        for key in ("author", "version"):
            if key not in meta:
                warns.append(f"metadata.{key} absent")

    for pattern, label in SECRET_PATTERNS:
        if pattern.search(front):
            errors.append(f"frontmatter: {label}")
    if ABSOLUTE_PATH.search(front):
        warns.append("frontmatter: chemin absolu machine present")

    for message in warns:
        print(f"WARN: {message}")
    if errors:
        print("FAIL:")
        for message in errors:
            print(f"  - {message}")
        return 1

    print("PASS: frontmatter valide")
    return 0


def main(argv):
    if "--help" in argv or "-h" in argv:
        print(USAGE)
        return 0
    return validate(argv[0] if argv else "SKILL.md")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
