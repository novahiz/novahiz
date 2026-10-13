#!/usr/bin/env python3
"""Valider le frontmatter d un SKILL.md Novahiz."""
import sys, yaml, re
def validate(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if not content.startswith("---"):
        print("FAIL: le fichier doit commencer par ---")
        return False
    parts = content.split("---", 2)
    if len(parts) < 3:
        print("FAIL: separateur --- manquant apres le frontmatter")
        return False
    front = parts[1].strip()
    try:
        data = yaml.safe_load(front)
    except Exception as e:
        print(f"FAIL: YAML invalide : {e}")
        return False
    errors = []
    if "name" not in data:
        errors.append("champ name manquant")
    else:
        name = str(data["name"])
        if len(name) > 64:
            errors.append(f"name trop long ({len(name)} > 64)")
        if not re.match(r"^[a-z0-9-]+$", name):
            errors.append("name doit etre kebab-case [a-z0-9-]")
        if name.startswith("-") or name.endswith("-"):
            errors.append("name ne doit pas commencer/finir par tiret")
    if "description" not in data:
        errors.append("champ description manquant")
    else:
        desc = str(data["description"])
        if len(desc) == 0:
            errors.append("description vide")
        if len(desc) > 1024:
            errors.append(f"description trop longue ({len(desc)} > 1024)")
        if "<" in desc or ">" in desc:
            errors.append("description contient des balises XML (< >)")
    if "license" not in data:
        errors.append("champ license manquant")
    if errors:
        print("FAIL:")
        for e in errors:
            print(f"  - {e}")
        return False
    print("PASS: frontmatter valide")
    return True
if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "SKILL.md"
    ok = validate(path)
    sys.exit(0 if ok else 1)
