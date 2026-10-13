#!/usr/bin/env python3
import sys, re
def extract(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    # Extraire la description du frontmatter (entre description: et la prochaine ligne qui n est pas indentée)
    desc = ""
    lines = content.splitlines()
    in_desc = False
    for line in lines:
        if line.startswith("description:"):
            in_desc = True
            desc_line = line.split(":", 1)[1].strip()
            if desc_line:
                desc += desc_line + " "
        elif in_desc and (line.startswith("license:") or line.startswith("compatibility:") or line.startswith("metadata:") or line.startswith("---")):
            in_desc = False
        elif in_desc and line.startswith("  "):
            desc += line.strip() + " "
    desc = desc.strip()
    print(f"Longueur description: {len(desc)} caracteres")
    # Rechercher des phrases déclencheuses communes
    triggers = [w for w in desc.split() if len(w) > 3]
    print(f"Mots cles potentiels (extrait): {triggers[:10]}")
if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "SKILL.md"
    extract(path)
