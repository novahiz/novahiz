#!/usr/bin/env python3
# Minimal frontmatter checker for stitch-design-fidelity SKILL.md
import yaml, sys
from pathlib import Path
p = Path(sys.argv[1] if len(sys.argv) > 1 else "SKILL.md")
data = yaml.safe_load(p.read_text("utf-8").split("---")[1])
errors = []
if not data.get("name") or not data["name"].startswith("stitch-"):
    errors.append("name must be kebab-case starting with stitch-")
if data.get("license") != "Apache-2.0": errors.append("license")
print("PASS" if not errors else "FAIL: " + ", ".join(errors))
