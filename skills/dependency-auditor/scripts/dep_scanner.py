#!/usr/bin/env python3
"""Offline dependency scanner for eight package ecosystems.

Reads manifests and lockfiles, builds an inventory, and matches versions
against a built-in advisory snapshot. No network access.

Usage:
    python3 dep_scanner.py /path/to/project
    python3 dep_scanner.py /path/to/project --format json -o scan.json
    python3 dep_scanner.py /path/to/project --fail-on-high --quick-scan
    python3 dep_scanner.py /path/to/project --ecosystems javascript,python

Exit codes:
    0  completed without high/critical findings (or --fail-on-high unset)
    1  high or critical findings present with --fail-on-high
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
from typing import Dict, Iterable, List, Optional, Tuple

SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


@dataclass(frozen=True)
class Advisory:
    advisory_id: str
    package: str
    ecosystem: str
    severity: str
    summary: str
    fixed_in: str


@dataclass
class PackageRec:
    name: str
    version: str
    ecosystem: str
    direct: bool
    source: str


@dataclass
class Finding:
    package: str
    version: str
    ecosystem: str
    advisory_id: str
    severity: str
    summary: str
    fixed_in: str


@dataclass
class ScanReport:
    root: str
    generated_at: str
    ecosystems: Dict[str, int] = field(default_factory=dict)
    packages: List[PackageRec] = field(default_factory=list)
    findings: List[Finding] = field(default_factory=list)
    stats: Dict[str, int] = field(default_factory=dict)


ADVISORIES: List[Advisory] = [
    Advisory("SF-LDASH-001", "lodash", "javascript", "high",
             "Command injection in template compilation", "4.17.21"),
    Advisory("SF-MINIMIST-001", "minimist", "javascript", "high",
             "Prototype pollution in argument parsing", "1.2.6"),
    Advisory("SF-NODEFETCH-001", "node-fetch", "javascript", "medium",
             "Sensitive data exposure across redirects", "2.6.7"),
    Advisory("SF-AXIOS-001", "axios", "javascript", "medium",
             "Server-side request forgery via unvalidated redirect", "0.21.1"),
    Advisory("SF-PYYAML-001", "pyyaml", "python", "critical",
             "Arbitrary code execution through unsafe load variants", "5.4"),
    Advisory("SF-URLLIB3-001", "urllib3", "python", "high",
             "Denial of service in URL authority parsing", "1.26.5"),
    Advisory("SF-JINJA2-001", "jinja2", "python", "medium",
             "Attribute injection in the xmlattr filter", "3.1.3"),
    Advisory("SF-XTEXT-001", "golang.org/x/text", "go", "high",
             "Parsing denial of service in language tag handling", "0.3.7"),
    Advisory("SF-LOG4J-001", "org.apache.logging.log4j:log4j-core", "java", "critical",
             "Remote code execution via JNDI lookup in logged messages", "2.17.1"),
]


def parse_version(raw: str) -> Tuple[int, ...]:
    cleaned = raw.strip().lstrip("vV")
    cleaned = re.split(r"[+~]", cleaned, maxsplit=1)[0]
    cleaned = re.split(r"[-\s]", cleaned, maxsplit=1)[0]
    parts: List[int] = []
    for chunk in cleaned.split("."):
        m = re.match(r"\d+", chunk)
        if not m:
            break
        parts.append(int(m.group()))
        if len(parts) >= 4:
            break
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def older_than(version: str, floor: str) -> bool:
    try:
        return parse_version(version) < parse_version(floor)
    except Exception:
        return False


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def first_existing(root: Path, names: Iterable[str]) -> Optional[Path]:
    for name in names:
        candidate = root / name
        if candidate.is_file():
            return candidate
    return None


def find_files(root: Path, suffix: str, limit: int = 40) -> List[Path]:
    out: List[Path] = []
    skip = {".git", "node_modules", "vendor", "venv", ".venv", "dist", "build", "target"}
    for path in sorted(root.rglob(f"*{suffix}")):
        if not path.is_file():
            continue
        if any(part in skip for part in path.parts):
            continue
        out.append(path)
        if len(out) >= limit:
            break
    return out


def add(recs: List[PackageRec], name: str, version: str, ecosystem: str,
        direct: bool, source: str) -> None:
    name = name.strip()
    version = version.strip().strip('"').strip("'")
    if not name or not version or version.startswith("${"):
        return
    version = version.lstrip("vV=^~<> ")
    if not version:
        return
    recs.append(PackageRec(name=name, version=version, ecosystem=ecosystem,
                           direct=direct, source=source))


def parse_requirements(text: str) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "-", " ", "\t")):
            continue
        line = line.split("#", 1)[0].strip()
        m = re.match(r"([A-Za-z0-9._-]+)\s*(?:==|===)\s*([A-Za-z0-9._+]+)", line)
        if m:
            rows.append((m.group(1).lower(), m.group(2)))
    return rows


def parse_js(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
    manifest = first_existing(root, ["package.json"])
    if manifest:
        try:
            data = json.loads(read_text(manifest))
        except json.JSONDecodeError:
            data = {}
        for section in ("dependencies", "devDependencies", "peerDependencies"):
            for name, spec in (data.get(section) or {}).items():
                ver = re.sub(r"^[\^~>=<\s]+", "", str(spec))
                if re.match(r"^\d", ver) or re.match(r"^\d", str(spec)):
                    add(recs, name, ver, "javascript", True, manifest.name)
                else:
                    m = re.search(r"(\d+\.\d+(?:\.\d+)?)", str(spec))
                    if m:
                        add(recs, name, m.group(1), "javascript", True, manifest.name)
    lock = first_existing(root, ["package-lock.json"])
    if lock:
        try:
            data = json.loads(read_text(lock))
        except json.JSONDecodeError:
            data = {}
        packages = data.get("packages")
        if isinstance(packages, dict):
            for path_key, meta in packages.items():
                if not path_key or not isinstance(meta, dict):
                    continue
                name = meta.get("name") or path_key.split("node_modules/")[-1]
                version = meta.get("version")
                if name and version:
                    direct = "node_modules/" not in path_key
                    add(recs, str(name), str(version), "javascript", direct, lock.name)
        else:
            for name, meta in (data.get("dependencies") or {}).items():
                if isinstance(meta, dict) and meta.get("version"):
                    add(recs, name, str(meta["version"]), "javascript", False, lock.name)
    yarn = first_existing(root, ["yarn.lock"])
    if yarn:
        text = read_text(yarn)
        blocks = re.split(r"\n(?=\S)", text)
        for block in blocks:
            header = block.split("\n", 1)[0]
            m_ver = re.search(r'\n\s+version\s+"([^"]+)"', "\n" + block)
            if not m_ver:
                continue
            first_alias = header.split(",")[0].strip().rstrip(":")
            name = first_alias.rsplit("@", 1)[0]
            if name.startswith("@"):
                name = "@" + name[1:].split("@")[0]
            add(recs, name, m_ver.group(1), "javascript", True, "yarn.lock")
    return recs


def parse_python(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
    req = first_existing(root, ["requirements.txt", "requirements/prod.txt"])
    if req:
        for name, version in parse_requirements(read_text(req)):
            add(recs, name, version, "python", True, req.name)
    pyproject = first_existing(root, ["pyproject.toml"])
    if pyproject:
        text = read_text(pyproject)
        for m in re.finditer(
            r'^([A-Za-z0-9._-]+)\s*=\s*["\']([^"\']+)["\']',
            text, re.M,
        ):
            name, spec = m.group(1), m.group(2)
            if name in {"name", "version", "description", "readme", "license"}:
                continue
            vm = re.search(r"(\d+(?:\.\d+){1,3})", spec)
            if vm and re.search(r"(==|>=|~=)", spec):
                add(recs, name, vm.group(1), "python", True, pyproject.name)
    poetry = first_existing(root, ["poetry.lock"])
    if poetry:
        text = read_text(poetry)
        names = re.findall(r'^name\s*=\s*"([^"]+)"', text, re.M)
        versions = re.findall(r'^version\s*=\s*"([^"]+)"', text, re.M)
        for name, version in zip(names, versions):
            add(recs, name, version, "python", False, poetry.name)
    pipfile = first_existing(root, ["Pipfile.lock"])
    if pipfile:
        try:
            data = json.loads(read_text(pipfile))
        except json.JSONDecodeError:
            data = {}
        for section in ("default", "develop"):
            for name, meta in (data.get(section) or {}).items():
                if isinstance(meta, dict) and meta.get("version"):
                    ver = re.sub(r"^==", "", str(meta["version"]))
                    add(recs, name, ver, "python", section == "default", pipfile.name)
    return recs


def parse_go(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
    gomod = first_existing(root, ["go.mod"])
    if not gomod:
        return recs
    text = read_text(gomod)
    body = text
    block = re.search(r"require\s*\((.*?)\)", text, re.S)
    if block:
        body += "\n" + block.group(1)
    for m in re.finditer(r"^\s*([^\s//]+)\s+v([0-9][^\s]+)", body, re.M):
        add(recs, m.group(1), m.group(2), "go", True, gomod.name)
    return recs


def parse_rust(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
    cargo = first_existing(root, ["Cargo.toml"])
    if cargo:
        text = read_text(cargo)
        in_deps = False
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                in_deps = stripped in {"[dependencies]", "[dependencies.dev-dependencies]"}
                continue
            if not in_deps:
                continue
            m = re.match(r'^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"', stripped)
            if m:
                add(recs, m.group(1), m.group(2), "rust", True, cargo.name)
                continue
            m2 = re.match(r'^([A-Za-z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"', stripped)
            if m2:
                add(recs, m2.group(1), m2.group(2), "rust", True, cargo.name)
    lock = first_existing(root, ["Cargo.lock"])
    if lock:
        text = read_text(lock)
        names = re.findall(r'^name\s*=\s*"([^"]+)"', text, re.M)
        versions = re.findall(r'^version\s*=\s*"([^"]+)"', text, re.M)
        for name, version in zip(names, versions):
            add(recs, name, version, "rust", False, lock.name)
    return recs


def parse_ruby(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
    gemfile = first_existing(root, ["Gemfile"])
    if gemfile:
        for m in re.finditer(
            r"""gem\s+["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?""",
            read_text(gemfile),
        ):
            spec = m.group(2) or ""
            vm = re.search(r"(\d+(?:\.\d+)+)", spec)
            if vm:
                add(recs, m.group(1), vm.group(1), "ruby", True, gemfile.name)
    lock = first_existing(root, ["Gemfile.lock"])
    if lock:
        in_specs = False
        for line in read_text(lock).splitlines():
            if line.strip() == "specs:":
                in_specs = True
                continue
            if in_specs and not line.startswith(" "):
                if line.strip().endswith(":") and not line.startswith("    "):
                    in_specs = line.strip() != "PLATFORMS:" and in_specs
                if line.strip() in {"PLATFORMS", "DEPENDENCIES", "RUBY VERSION", "BUNDLED WITH"}:
                    in_specs = False
                continue
            if in_specs:
                m = re.match(r"^\s{4}([A-Za-z0-9_-]+)\s+\(([^)]+)\)", line)
                if m:
                    add(recs, m.group(1), m.group(2), "ruby", True, lock.name)
    return recs


def parse_java(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
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
            for dep in tree.iter(f"{ns}dependency"):
                group = dep.findtext(f"{ns}groupId", default="").strip()
                artifact = dep.findtext(f"{ns}artifactId", default="").strip()
                version = dep.findtext(f"{ns}version", default="").strip()
                if group and artifact and version and not version.startswith("${"):
                    add(recs, f"{group}:{artifact}", version, "java", True, pom.name)
    gradle = first_existing(root, ["gradle.lockfile"])
    if gradle:
        for line in read_text(gradle).splitlines():
            if "=" in line and not line.startswith("#"):
                coord, _, version = line.partition("=")
                add(recs, coord.strip(), version.strip(), "java", False, gradle.name)
    return recs


def parse_php(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
    manifest = first_existing(root, ["composer.json"])
    if manifest:
        try:
            data = json.loads(read_text(manifest))
        except json.JSONDecodeError:
            data = {}
        for section in ("require", "require-dev"):
            for name, spec in (data.get(section) or {}).items():
                if name == "php" or name.startswith("ext-"):
                    continue
                vm = re.search(r"(\d+(?:\.\d+)+)", str(spec))
                if vm:
                    add(recs, name, vm.group(1), "php", True, manifest.name)
    lock = first_existing(root, ["composer.lock"])
    if lock:
        try:
            data = json.loads(read_text(lock))
        except json.JSONDecodeError:
            data = {}
        for section in ("packages", "packages-dev"):
            for meta in data.get(section) or []:
                if isinstance(meta, dict) and meta.get("name") and meta.get("version"):
                    add(recs, str(meta["name"]), str(meta["version"]),
                        "php", section == "packages", lock.name)
    return recs


def parse_dotnet(root: Path) -> List[PackageRec]:
    recs: List[PackageRec] = []
    for proj in find_files(root, ".csproj"):
        text = read_text(proj)
        for m in re.finditer(
            r'<PackageReference\s+[^>]*Include="([^"]+)"[^>]*Version="([^"]+)"',
            text,
        ):
            add(recs, m.group(1), m.group(2), "dotnet", True, proj.name)
        for m in re.finditer(
            r'<PackageReference\s+Include="([^"]+)"\s*>\s*<Version>([^<]+)</Version>',
            text, re.S,
        ):
            add(recs, m.group(1), m.group(2), "dotnet", True, proj.name)
    packages = first_existing(root, ["packages.config"])
    if packages:
        text = read_text(packages)
        for m in re.finditer(r'id="([^"]+)"\s+version="([^"]+)"', text):
            add(recs, m.group(1), m.group(2), "dotnet", True, packages.name)
    lock = first_existing(root, ["packages.lock.json"])
    if lock:
        try:
            data = json.loads(read_text(lock))
        except json.JSONDecodeError:
            data = {}
        for _, deps in (data.get("dependencies") or {}).items():
            for name, meta in (deps or {}).items():
                if isinstance(meta, dict) and meta.get("resolved"):
                    add(recs, name, str(meta["resolved"]), "dotnet", False, lock.name)
    return recs


PARSERS = {
    "javascript": parse_js,
    "python": parse_python,
    "go": parse_go,
    "rust": parse_rust,
    "ruby": parse_ruby,
    "java": parse_java,
    "php": parse_php,
    "dotnet": parse_dotnet,
}


def dedupe(packages: List[PackageRec]) -> List[PackageRec]:
    seen: Dict[Tuple[str, str], PackageRec] = {}
    for rec in packages:
        key = (rec.ecosystem, rec.name.lower())
        existing = seen.get(key)
        if existing is None:
            seen[key] = rec
            continue
        if rec.direct and not existing.direct:
            seen[key] = rec
        elif rec.source.endswith(("lock", "lock.json")) and not existing.source.endswith(
            ("lock", "lock.json")
        ):
            seen[key] = rec
    return list(seen.values())


def match_advisories(packages: List[PackageRec]) -> List[Finding]:
    findings: List[Finding] = []
    for rec in packages:
        for adv in ADVISORIES:
            if adv.ecosystem != rec.ecosystem:
                continue
            if adv.package.lower() != rec.name.lower():
                continue
            if older_than(rec.version, adv.fixed_in):
                findings.append(Finding(
                    package=rec.name,
                    version=rec.version,
                    ecosystem=rec.ecosystem,
                    advisory_id=adv.advisory_id,
                    severity=adv.severity,
                    summary=adv.summary,
                    fixed_in=adv.fixed_in,
                ))
    findings.sort(key=lambda f: (-SEVERITY_RANK[f.severity], f.package))
    return findings


def build_report(root: Path, ecosystems: List[str], quick: bool) -> ScanReport:
    packages: List[PackageRec] = []
    for name in ecosystems:
        packages.extend(PARSERS[name](root))
    packages = dedupe(packages)
    if quick:
        packages = [p for p in packages if p.direct]
    findings = match_advisories(packages)
    counts: Dict[str, int] = {}
    for rec in packages:
        counts[rec.ecosystem] = counts.get(rec.ecosystem, 0) + 1
    report = ScanReport(
        root=str(root),
        generated_at=datetime.now(timezone.utc).isoformat(),
        ecosystems=counts,
        packages=packages,
        findings=findings,
    )
    report.stats = {
        "packages": len(packages),
        "findings": len(findings),
        "high_or_critical": sum(
            1 for f in findings if SEVERITY_RANK[f.severity] >= SEVERITY_RANK["high"]
        ),
    }
    return report


def render_text(report: ScanReport) -> str:
    lines = [
        f"dep_scanner: {report.root}",
        "ecosystems: "
        + (", ".join(f"{k}={v}" for k, v in sorted(report.ecosystems.items())) or "none"),
        "stats: "
        + ", ".join(f"{k}={v}" for k, v in report.stats.items()),
    ]
    for f in report.findings:
        lines.append(
            f"[{f.severity.upper()}] {f.package}@{f.version} ({f.ecosystem}) "
            f"{f.advisory_id}: {f.summary}; fixed in {f.fixed_in}"
        )
    if not report.findings:
        lines.append("no advisory hits in the built-in snapshot")
    return "\n".join(lines)


def render_json(report: ScanReport) -> str:
    payload = {
        "root": report.root,
        "generated_at": report.generated_at,
        "ecosystems": report.ecosystems,
        "packages": [asdict(p) for p in report.packages],
        "findings": [asdict(f) for f in report.findings],
        "stats": report.stats,
    }
    return json.dumps(payload, indent=2)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Offline dependency scanner (manifests, lockfiles, advisory snapshot)."
    )
    p.add_argument("target", type=Path, help="Project root to scan")
    p.add_argument("--format", choices=["text", "json"], default="text")
    p.add_argument("-o", "--output", type=Path, help="Write the report to a file")
    p.add_argument("--fail-on-high", action="store_true",
                   help="Exit 1 when high or critical findings exist")
    p.add_argument("--quick-scan", action="store_true",
                   help="Direct manifest dependencies only")
    p.add_argument(
        "--ecosystems",
        help="Comma-separated subset: " + ",".join(PARSERS),
    )
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if not args.target.exists():
        print(f"path not found: {args.target}", file=sys.stderr)
        return 2

    if args.ecosystems:
        selected = [e.strip() for e in args.ecosystems.split(",") if e.strip()]
        unknown = [e for e in selected if e not in PARSERS]
        if unknown:
            print(f"unknown ecosystems: {', '.join(unknown)}", file=sys.stderr)
            return 2
    else:
        selected = list(PARSERS)

    report = build_report(args.target, selected, args.quick_scan)
    body = render_json(report) if args.format == "json" else render_text(report)

    if args.output:
        try:
            args.output.write_text(body + "\n", encoding="utf-8")
        except OSError as exc:
            print(f"cannot write output: {exc}", file=sys.stderr)
            return 2
    else:
        print(body)

    if args.fail_on_high and report.stats.get("high_or_critical", 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
