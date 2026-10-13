#!/usr/bin/env python3
import sys, os
def scan(skill_dir):
    files = os.listdir(skill_dir)
    has_skill_md = "SKILL.md" in files
    has_scripts = "scripts" in files
    has_references = "references" in files
    has_assets = "assets" in files
    print(f"Scan de {skill_dir}:")
    print(f"  SKILL.md: {'oui' if has_skill_md else 'non'}")
    print(f"  scripts/: {'oui' if has_scripts else 'non'}")
    print(f"  references/: {'oui' if has_references else 'non'}")
    print(f"  assets/: {'oui' if has_assets else 'non'}")
if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "."
    scan(path)
