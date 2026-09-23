#!/usr/bin/env python3
"""Offline license compliance checker for dependency manifests.

Reads declared licenses across eight ecosystems, classifies them into
families, and tests combinations against a policy level.

Usage:
    python3 license_checker.py /path/to/project
    python3 license_checker.py /path/to/project --policy strict --format json -o out.json
    python3 license_checker.py /path/to/project --fail-on-conflict

Exit codes:
    0  policy satisfied (or --fail-on-conflict not set)
    1  policy conflicts found with --fail-on-conflict
    2  bad invocation
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

FAMILY_PERMISSIVE = "permissive"
FAMILY_WEAK = "weak_copyleft"
FAMILY_STRONG = "strong_copyleft"
FAMILY_PROPRIETARY = "proprietary"
FAMILY_UNKNOWN = "unknown"

FAMILY_RANK = {
    FAMILY_PERMISSIVE: 0,
    FAMILY_WEAK: 1,
    FAMILY_UNKNOWN: 2,
    FAMILY_PROPRIETARY: 3,
    FAMILY_STRONG: 4,
}

SPDX_MAP = {
    "mit": FAMILY_PERMISSIVE,
    "apache-2.0": FAMILY_PERMISSIVE,
    "apache 2.0": FAMILY_PERMISSIVE,
    "bsd-2-clause": FAMILY_PERMISSIVE,
    "bsd-3-clause": FAMILY_PERMISSIVE,
    "isc": FAMILY_PERMISSIVE,
    "zlib": FAMILY_PERMISSIVE,
    "unlicense": FAMILY_PERMISSIVE,
    "cc0-1.0": FAMILY_PERMISSIVE,
    "0bsd": FAMILY_PERMISSIVE,
    "mpl-2.0": FAMILY_WEAK,
    "mpl": FAMILY_WEAK,
    "lgpl-2.1": FAMILY_WEAK,
    "lgpl-2.1-only": FAMILY_WEAK,
    "lgpl-3.0": FAMILY_WEAK,
    "lgpl-3.0-only": FAMILY_WEAK,
    "epl-2.0": FAMILY_WEAK,
    "epl-1.0": FAMILY_WEAK,
    "cddl-1.0": FAMILY_WEAK,
    "gpl-2.0": FAMILY_STRONG,
    "gpl-2.0-only": FAMILY_STRONG,
    "gpl-3.0": FAMILY_STRONG,
    "gpl-3.0-only": FAMILY_STRONG,
    "agpl-3.0": FAMILY_STRONG,
    "agpl-3.0-only": FAMILY_STRONG,
    "sspl-1.0": FAMILY_STRONG,
    "osl-3.0": FAMILY_STRONG,
    "cc-by-nc-4.0": FAMILY_PROPRIETARY,
    "proprietary": FAMILY_PROPRIETARY,
    "commercial": FAMILY_PROPRIETARY,
}

POLICIES = {
    "strict": {"allowed": {FAMILY_PERMISSIVE}, "warn": {FAMILY_WEAK}, "fail": {FAMILY_STRONG, FAMILY_PROPRIETARY}},
    "permissive": {"allowed": {FAMILY_PERMISSIVE, FAMILY_WEAK}, "warn": {FAMILY_UNKNOWN}, "fail": {FAMILY_STRONG}},
    "loose": {"allowed": {FAMILY_PERMISSIVE, FAMILY_WEAK, FAMILY_STRONG, FAMILY_PROPRIETARY}, "warn": set(), "fail": set()},
}

STATUS_OK = "ok"
STATUS_WARN = "warn"
STATUS_FAIL = "fail"


@dataclass
class LicenseRow:
    package: str
    ecosystem: str
    declared: str
    family: str
    source: str
    status: str = STATUS_OK
    reason: str = ""


@dataclass
class LicenseReport:
    root: str
    generated_at: str
    policy: str
    project_license: str
    rows: List[LicenseRow] = field(default_factory=list)
    conflicts: List[str] = field(default_factory=list)
    stats: Dict[str, int] = field(default_factory=dict)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def first_existing(root: Path, names: List[str]) -> Optional[Path]:
    for name in names:
        candidate = root / name
        if candidate.is_file():
            return candidate
    return None


def classify(declared: str) -> str:
    if not declared or not declared.strip():
        return FAMILY_UNKNOWN
    text = declared.strip().lower()
    if "see license" in text or text in {"none", "n/a", "tbd", "?"}:
        return FAMILY_UNKNOWN
    or_parts = re.split(r"\s+or\s+|\s*\|\s*", text)
    and_parts = re.split(r"\s+and\s+|\s*&\s*", text)
    candidates = [p.strip(" ()") for p in (or_parts + and_parts)]
    families = set()
    for cand in candidates:
        key = cand.strip()
        if key in SPDX_MAP:
            families.add(SPDX_MAP[key])
            continue
        matched = False
        for spdx, family in SPDX_MAP.items():
            if spdx in key:
                families.add(family)
                matched = True
                break
        if not matched:
            if "agpl" in key or "sspl" in key or "gpl" in key:
                families.add(FAMILY_STRONG)
            elif "lgpl" in key or "mpl" in key or "epl" in key:
                families.add(FAMILY_WEAK)
            elif "apache" in key or "mit" in key or "bsd" in key or "isc" in key:
                families.add(FAMILY_PERMISSIVE)
            else:
                families.add(FAMILY_UNKNOWN)
    if FAMILY_STRONG in families:
        return FAMILY_STRONG
    if FAMILY_PROPRIETARY in families:
        return FAMILY_PROPRIETARY
    if FAMILY_WEAK in families:
        return FAMILY_WEAK
    if families == {FAMILY_UNKNOWN}:
        return FAMILY_UNKNOWN
    if FAMILY_UNKNOWN in families and FAMILY_PERMISSIVE in families:
        return FAMILY_UNKNOWN
    return FAMILY_PERMISSIVE if families else FAMILY_UNKNOWN


def detect_project_license(root: Path) -> str:
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "LICENCE"):
        candidate = root / name
        if not candidate.is_file():
            continue
        head = read_text(candidate)[:1500].lower()
        if "apache license" in head and "2.0" in head:
            return "Apache-2.0"
        if "mit license" in head:
            return "MIT"
        if "gnu affero" in head:
            return "AGPL-3.0"
        if "gnu general public license" in head and "version 3" in head:
            return "GPL-3.0"
        if "gnu general public license" in head:
            return "GPL-2.0"
        if "bsd 3-clause" in head or "redistribution and use" in head:
            return "BSD-3-Clause"
    package_json = root / "package.json"
    if package_json.is_file():
        try:
            data = json.loads(read_text(package_json))
            if isinstance(data.get("license"), str):
                return data["license"]
        except json.JSONDecodeError:
            pass
    return "unknown"


def apply_status(row: LicenseRow, policy: str) -> LicenseRow:
    rules = POLICIES[policy]
    if row.family in rules["fail"]:
        row.status = STATUS_FAIL
        row.reason = f"family {row.family} rejected by policy {policy}"
    elif row.family in rules["warn"]:
        row.status = STATUS_WARN
        row.reason = f"family {row.family} requires review under policy {policy}"
    elif row.family in rules["allowed"]:
        row.status = STATUS_OK
        row.reason = "within policy"
    else:
        row.status = STATUS_WARN
        row.reason = f"family {row.family} not explicitly allowed"
    return row


def scan_project(root: Path) -> List[LicenseRow]:
    rows: List[LicenseRow] = []

    def push(package: str, ecosystem: str, declared: str, source: str) -> None:
        rows.append(LicenseRow(
            package=package,
            ecosystem=ecosystem,
            declared=declared.strip() if declared else "",
            family=classify(declared),
            source=source,
        ))

    manifest = first_existing(root, ["package.json"])
    if manifest:
        try:
            data = json.loads(read_text(manifest))
        except json.JSONDecodeError:
            data = {}
        push(data.get("name", "package.json#project"), "javascript",
             str(data.get("license", "")), manifest.name)
        for section in ("dependencies", "devDependencies"):
            for name in (data.get(section) or {}):
                push(name, "javascript", "", f"{manifest.name}:{section}")

    for req_name in ("requirements.txt",):
        req = root / req_name
        if req.is_file():
            for line in read_text(req).splitlines():
                line = line.strip()
                if line and not line.startswith(("#", "-")):
                    pkg = re.split(r"[=<>!~\[;]", line, 1)[0].strip()
                    if pkg:
                        push(pkg, "python", "", req.name)

    pyproject = first_existing(root, ["pyproject.toml"])
    if pyproject:
        text = read_text(pyproject)
        m = re.search(r'^license\s*=\s*["\']([^"\']+)["\']', text, re.M)
        if m:
            push("project", "python", m.group(1), pyproject.name)
        deps = re.findall(r'^([A-Za-z0-9._-]+)\s*=', text, re.M)
        for name in deps:
            if name not in {"name", "version", "description", "license", "readme"}:
                push(name, "python", "", pyproject.name)

    cargo = first_existing(root, ["Cargo.toml"])
    if cargo:
        text = read_text(cargo)
        m = re.search(r'^license\s*=\s*"([^"]+)"', text, re.M)
        if m:
            push("project", "rust", m.group(1), cargo.name)
        in_deps = False
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                in_deps = stripped == "[dependencies]"
                continue
            if in_deps:
                dm = re.match(r'^([A-Za-z0-9_-]+)\s*=', stripped)
                if dm:
                    push(dm.group(1), "rust", "", cargo.name)

    gomod = first_existing(root, ["go.mod"])
    if gomod:
        for m in re.finditer(r"^\s*([^\s//]+)\s+v\d", read_text(gomod), re.M):
            push(m.group(1), "go", "", gomod.name)

    pom = first_existing(root, ["pom.xml"])
    if pom:
        try:
            import xml.etree.ElementTree as ET
            tree = ET.fromstring(read_text(pom))
        except ET.ParseError:
            tree = None
        if tree is not None:
            ns = ""
            if tree.tag.startswith("{"):
                ns = tree.tag.split("}")[0] + "}"
            project_license = tree.findtext(f".//{ns}licenses/{ns}license/{ns}name")
            if project_license:
                push("project", "java", project_license, pom.name)
            for dep in tree.iter(f"{ns}dependency"):
                group = (dep.findtext(f"{ns}groupId") or "").strip()
                artifact = (dep.findtext(f"{ns}artifactId") or "").strip()
                if group and artifact:
                    push(f"{group}:{artifact}", "java", "", pom.name)

    composer = first_existing(root, ["composer.json"])
    if composer:
        try:
            data = json.loads(read_text(composer))
        except json.JSONDecodeError:
            data = {}
        declared = data.get("license")
        if isinstance(declared, list):
            declared = " or ".join(str(x) for x in declared)
        push(data.get("name", "project"), "php", str(declared or ""), composer.name)
        for name in (data.get("require") or {}):
            if not name.startswith("ext-") and name != "php":
                push(name, "php", "", composer.name)

    for proj in sorted(root.rglob("*.csproj")):
        if any(part in {".git", "node_modules", "vendor"} for part in proj.parts):
            continue
        text = read_text(proj)
        for m in re.finditer(r'<PackageReference\s+Include="([^"]+)"', text):
            push(m.group(1), "dotnet", "", proj.name)

    return rows


def project_family_ok(project_license: str, dep_family: str, policy: str) -> Tuple[bool, str]:
    project = classify(project_license)
    if dep_family == FAMILY_STRONG and policy == "strict":
        return False, "strong copyleft rejected under strict policy"
    if dep_family == FAMILY_STRONG and project in {FAMILY_PERMISSIVE, FAMILY_PROPRIETARY, FAMILY_UNKNOWN}:
        return False, f"{project_license or 'this project'} cannot ship a strong copyleft dependency without a licensing decision"
    if dep_family == FAMILY_STRONG and project == FAMILY_STRONG:
        return True, "both sides strong copyleft; confirm version compatibility"
    if dep_family == FAMILY_WEAK:
        return True, "weak copyleft: keep boundary and notices intact"
    return True, "compatible"


def build_report(root: Path, policy: str) -> LicenseReport:
    project_license = detect_project_license(root)
    report = LicenseReport(
        root=str(root),
        generated_at=datetime.now(timezone.utc).isoformat(),
        policy=policy,
        project_license=project_license,
    )
    rows = scan_project(root)
    for row in rows:
        apply_status(row, policy)
        if row.family in {FAMILY_STRONG, FAMILY_WEAK, FAMILY_UNKNOWN, FAMILY_PROPRIETARY}:
            ok, note = project_family_ok(project_license, row.family, policy)
            if not ok and row.status != STATUS_FAIL:
                row.status = STATUS_FAIL
                row.reason = note
            elif row.status == STATUS_OK and row.family != FAMILY_PERMISSIVE:
                row.reason = note
        report.rows.append(row)
        if row.status == STATUS_FAIL:
            report.conflicts.append(f"{row.package} ({row.family}): {row.reason}")

    family_counts: Dict[str, int] = {}
    status_counts = {STATUS_OK: 0, STATUS_WARN: 0, STATUS_FAIL: 0}
    for row in report.rows:
        family_counts[row.family] = family_counts.get(row.family, 0) + 1
        status_counts[row.status] += 1
    report.stats = {
        "rows": len(report.rows),
        **{f"family_{k}": v for k, v in family_counts.items()},
        **{f"status_{k}": v for k, v in status_counts.items()},
    }
    return report


def render_text(report: LicenseReport) -> str:
    lines = [
        f"license_checker: {report.root}",
        f"policy={report.policy} project_license={report.project_license}",
        "stats: " + ", ".join(f"{k}={v}" for k, v in report.stats.items()),
    ]
    for row in report.rows:
        if row.status == STATUS_OK and row.family == FAMILY_PERMISSIVE:
            continue
        lines.append(
            f"[{row.status.upper()}] {row.package} ({row.ecosystem}) "
            f"declared={row.declared or '-'} family={row.family} :: {row.reason}"
        )
    if not report.conflicts:
        lines.append("no policy conflicts")
    else:
        lines.append(f"conflicts: {len(report.conflicts)}")
    return "\n".join(lines)


def render_json(report: LicenseReport) -> str:
    payload = {
        "root": report.root,
        "generated_at": report.generated_at,
        "policy": report.policy,
        "project_license": report.project_license,
        "conflicts": report.conflicts,
        "stats": report.stats,
        "rows": [asdict(r) for r in report.rows],
    }
    return json.dumps(payload, indent=2)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Offline license compliance checker for dependency manifests."
    )
    p.add_argument("target", type=Path, help="Project root")
    p.add_argument("--policy", choices=sorted(POLICIES), default="permissive")
    p.add_argument("--format", choices=["text", "json"], default="text")
    p.add_argument("-o", "--output", type=Path, help="Write the report to a file")
    p.add_argument("--fail-on-conflict", action="store_true",
                   help="Exit 1 when the policy is violated")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.target.exists():
        print(f"path not found: {args.target}", file=sys.stderr)
        return 2

    report = build_report(args.target, args.policy)
    body = render_json(report) if args.format == "json" else render_text(report)

    if args.output:
        try:
            args.output.write_text(body + "\n", encoding="utf-8")
        except OSError as exc:
            print(f"cannot write output: {exc}", file=sys.stderr)
            return 2
    else:
        print(body)

    if args.fail_on_conflict and report.conflicts:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
