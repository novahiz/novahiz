#!/usr/bin/env python3
"""Analyser la description d'un SKILL.md comme un routeur.

La description est le seul texte toujours charge en contexte. Ce script
mesure ce qui decide du declenchement : les declencheurs, le
differenciateur vis-a-vis des autres skills, et la specificite lexicale.

Contrat honnete : analyse lexicale statistique, pas un jugement de
qualite editoriale. Un PASS veut dire "routable", pas "bien ecrit".
"""
import os
import re
import sys

USAGE = """usage: extract-description.py [SKILL.md] [--dir ../skills] [--help]

Analyse la description d'un SKILL.md comme element de routage.

arguments:
  SKILL.md     chemin du fichier (defaut: SKILL.md)

options:
  --dir DIR    dossier des skills pour mesurer la collision lexicale

mesure:
  - longueur en caracteres (fenetre utile: 60 a 1024)
  - declencheurs: verbes et marqueurs "quand / use when / triggered on"
  - differenciateur: marqueurs comparatifs ("unlike", "plutot que", "ne ... pas")
  - specificite: part des termes rares dans le corpus des skills
  - red flags: tautologies, balises XML, "etc.", triades forcees

codes de sortie:
  0  description routable
  1  description non routable (trop courte, sans declencheur)
  2  erreur d'utilisation

exemples:
  python extract-description.py SKILL.md
  python extract-description.py SKILL.md --dir ../../skills
"""

TRIGGER_MARKERS = [
    "use when", "use for", "use instead", "useful for", "triggers on",
    "trigger on", "triggered on", "useful when", "invoke when",
    "quand", "declenche", "declenche sur", "se declenche", "utilise quand",
    "utiliser quand", "a utiliser quand", "sert quand", "s'active quand",
    "on utilise", "lorsque", "avant toute", "obligatoirement avant",
]
DIFFERENTIATOR_MARKERS = [
    "unlike", "not the same as", "rather than", "instead of", "differs from",
    "do not use", "dont use", "different from", "different de",
    "ne pas confondre", "a ne pas confondre", "pas le meme", "plutot que",
    "contrairement", "se distingue", "pas pour", "ne couvre pas",
]
# Les marqueurs sont compares en minuscules : aucun doublon, aucune entree
# n'a de raison d'exister deux fois. Un mot absent de words() (minuscules)
# ne peut jamais apparaitre dans FILLER utile : pas de variantes de casse.
FILLER = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
    "you", "your", "when", "use", "using", "used", "can", "will", "has", "have",
    "not", "but", "any", "all", "les", "des", "une", "est", "sur", "dans",
    "pour", "avec", "qui", "que", "quoi", "plus", "tout", "tous", "toute",
    "aux", "par", "son", "sa", "ses", "comme", "mais", "donc", "ou", "et",
    "de", "la", "le", "un", "du", "au", "ce", "cette", "il", "elle", "ils",
    "on", "se", "ne", "pas", "y", "une", "les", "des",
}
RED_FLAGS = [
    (re.compile(r"(?i)\betc\.?\b"), "usage de 'etc.' : la portee devient floue"),
    (re.compile(r"(?i)\b(various|several|multiple|diverse|différents?|plusieurs)\b"),
     "quantificateur vague sans enumeration"),
    (re.compile(r"<[a-zA-Z/][^>]*>"), "balise XML dans la description (interdite)"),
    (re.compile(r"[—–]"), "tiret long : souvent residue d'ecriture generatee"),
    (re.compile(r"(?i)\bnot only\b.*\bbut also\b"), "contraste 'not X but Y' force"),
    (re.compile(r"(?i)\b(seamless|powerful|robust|comprehensive|effortless|robuste|puissant|complet|seamless)\b"),
     "adjectif promotionnel sans information"),
]


def words(text):
    return [w for w in re.findall(r"[a-zA-ZÀ-ÿ]{3,}", text.lower())]


def corpus_terms(skill_dir):
    """Termes rares sur l'ensemble des skills du corpus."""
    counts = {}
    total = 0
    if not skill_dir or not os.path.isdir(skill_dir):
        return {}, 0
    for entry in os.listdir(skill_dir):
        path = os.path.join(skill_dir, entry, "SKILL.md")
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                content = handle.read()
        except OSError:
            continue
        match = re.search(r"(?ms)^description:\s*(.*?)(?=^\w+:|\Z)", content)
        chunk = match.group(1) if match else content
        for word in set(words(chunk)):
            if word in FILLER:
                continue
            counts[word] = counts.get(word, 0) + 1
            total += 1
    return counts, total


def extract(path, skill_dir=None):
    """Analyse la description. skill_dir est le corpus pour la specificite.

    L'analyse des arguments est faite par main() : ce module ne relit JAMAIS
    sys.argv ici, sinon un appel en import ou un --dir sans positionnel
    ferait passer le dossier cible pour le fichier a lire.
    """
    # Windows leve PermissionError sur un dossier, POSIX IsADirectoryError :
    # deux exceptions sœurs, donc on interroge le systeme AVANT l'ouverture.
    if os.path.isdir(path):
        print(f"FAIL: {path} est un dossier, pas un fichier SKILL.md")
        return 2
    try:
        with open(path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except OSError as exc:
        print(f"FAIL: impossible de lire {path} : {exc.strerror}")
        return 2

    match = re.search(r"(?ms)^---\s*\n(.*?)\n---", content)
    if not match:
        print("FAIL: aucun frontmatter detecte")
        return 1

    front = match.group(1)
    m = re.search(r"(?ms)^description:\s*(.*?)(?=^\w[\w-]*:)", front + "\n")
    if not m:
        print("FAIL: champ description absent")
        return 1
    raw = m.group(1).strip()
    if raw.startswith("|"):
        raw = "\n".join(line.strip() for line in raw.splitlines()[1:])
    elif raw.startswith(">"):
        raw = raw[1:].strip()
    description = " ".join(raw.split())

    print(f"Longueur description: {len(description)} caracteres")
    problems, warnings = [], []

    if len(description) < 40:
        problems.append(f"trop courte ({len(description)} car.): elle ne portera pas le routage")
    elif len(description) < 60:
        warnings.append("courte: precisez les declencheurs")
    if len(description) > 1024:
        problems.append(f"trop longue ({len(description)} > 1024 car.)")

    lower = description.lower()
    found_triggers = [m for m in TRIGGER_MARKERS if m in lower]
    found_diff = [m for m in DIFFERENTIATOR_MARKERS if m in lower]
    print(f"Declencheurs trouves : {found_triggers or '(aucun)'}")
    print(f"Differenciateurs      : {found_diff or '(aucun)'}")
    if not found_triggers:
        problems.append("aucun marqueur de declenchement: la description ne dit PAS quand agir")
    if not found_diff:
        warnings.append("aucun differenciateur: rien ne la distingue des skills voisins")

    counts, total = corpus_terms(skill_dir)
    terms = [w for w in words(description) if w not in FILLER]
    if counts and total:
        rare = [w for w in set(terms) if counts.get(w, 0) <= 2]
        ratio = len(rare) / max(len(set(terms)), 1)
        print(f"Specificite lexicale  : {ratio:.0%} ({len(rare)}/{len(set(terms))} termes rares)")
        if ratio < 0.35:
            warnings.append(
                f"specificite faible ({ratio:.0%}): trop de vocabulaire partage avec les autres skills"
            )
        if terms:
            print(f"Termes porteurs       : {', '.join(sorted(set(rare))[:12])}")

    seen = set()
    for pattern, label in RED_FLAGS:
        if pattern.search(description) and label not in seen:
            warnings.append(label)
            seen.add(label)

    for warning in warnings:
        print(f"WARN: {warning}")
    if problems:
        print("FAIL:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("PASS: description routable")
    return 0


def parse_args(argv):
    """Separe le fichier cible de --dir. Retourne (path, skill_dir, erreur).

    La valeur de --dir ne doit JAMAIS tomber dans les positionnels : sans
    cette separation, "extract-description.py --dir ../skills" prend
    "../skills" pour le fichier a lire, et echoue sur Permission denied.
    """
    positional, skill_dir = [], None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--dir":
            if i + 1 >= len(argv):
                return None, None, "--dir exige un dossier (valeur manquante)"
            skill_dir = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--dir="):
            skill_dir = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--"):
            return None, None, f"option inconnue: {arg}"
        positional.append(arg)
        i += 1

    if len(positional) > 1:
        return None, None, f"un seul fichier attendu, {len(positional)} donnes"
    path = positional[0] if positional else "SKILL.md"
    if skill_dir and os.path.isdir(path):
        # --dir donne, mais le fichier pointe un dossier : message clair
        # plutot qu'un Permission denied sur Windows.
        return None, None, f"{path} est un dossier, passez le chemin de SKILL.md"
    return path, skill_dir, None


def main(argv):
    if "--help" in argv or "-h" in argv:
        print(USAGE)
        return 0
    path, skill_dir, error = parse_args(argv)
    if error:
        print(f"FAIL: {error}")
        print("  aide: python extract-description.py --help")
        return 2
    return extract(path, skill_dir)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
