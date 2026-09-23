#!/usr/bin/env python3
"""Offline upgrade planner built on dep_scanner JSON output.

Reads an inventory (file or stdin), assigns packages to upgrade waves by
risk, and prints a plan with rollback notes. Targets come from three
places: advisory fixes, an embedded last-known-version snapshot, and
explicit --target flags.

Usage:
    python3 upgrade_planner.py scan.json
    python3 upgrade_planner.py scan.json --target react=19.0.0
    python3 upgrade_planner.py scan.json --risk-threshold medium --timeline 90 --format json -o plan.json
    python3 upgrade_planner.py scan.json --security-only
    cat scan.json | python3 upgrade_planner.py -

Exit codes:
    0  plan produced
    2  unreadable or malformed input
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

RISK_ORDER = {"safe": 0, "low": 1, "medium": 2, "high": 3}
SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}

WAVE_SECURITY = "1-security"
WAVE_PATCH = "2-patch"
WAVE_MINOR = "3-minor"
WAVE_MAJOR = "4-major"

# Last versions this offline snapshot knows about, keyed "ecosystem:name".
# Not a live feed: entries age, and missing entries mean "no target data".
KNOWN_LATEST: Dict[str, str] = {
    "javascript:lodash": "4.17.21",
    "javascript:react": "19.0.0",
    "javascript:react-dom": "19.0.0",
    "javascript:express": "4.21.0",
    "javascript:axios": "1.7.7",
    "javascript:next": "15.0.0",
    "javascript:minimist": "1.2.8",
    "javascript:node-fetch": "2.7.0",
    "python:requests": "2.32.3",
    "python:pyyaml": "6.0.2",
    "python:urllib3": "2.2.3",
    "python:flask": "3.0.3",
    "python:jinja2": "3.1.4",
    "go:golang.org/x/text": "0.18.0",
    "rust:serde": "1.0.210",
    "java:org.apache.logging.log4j:log4j-core": "2.24.1",
}


@dataclass
class PlanItem:
    package: str
    ecosystem: str
    current: str
    target: str
    wave: str
    risk: str
    reason: str
    origin: str
    rollback: str


@dataclass
class Wave:
    wave: str
    title: str
    guidance: str
    items: List[PlanItem] = field(default_factory=list)


@dataclass
class UpgradePlan:
    source: str
    generated_at: str
    timeline_days: int
    risk_threshold: str
    security_only: bool
    waves: List[Wave] = field(default_factory=list)
    unplanned: List[str] = field(default_factory=list)
    stats: Dict[str, int] = field(default_factory=dict)


def parse_version(raw: str) -> Tuple[int, ...]:
    cleaned = raw.strip().lstrip("vV")
    cleaned = re.split(r"[+~]", cleaned, maxsplit=1)[0]
    cleaned = re.split(r"[-\s]", cleaned, maxsplit=1)[0]
    parts: List[int] = []
    for chunk in cleaned.split("."):
        m = re.match(r"\d+", chunk)
        if not m:
            break
        parts.append(int(m.group())
                     )
        if len(parts) >= 3:
            break
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def older_than(version: str, other: str) -> bool:
    try:
        return parse_version(version) < parse_version(other)
    except Exception:
        return False


def bump_kind(current: str, target: str) -> str:
    try:
        cur = parse_version(current)
        tgt = parse_version(target)
    except Exception:
        return "unknown"
    if tgt[0] != cur[0]:
        return "major"
    if tgt[1] != cur[1]:
        return "minor"
    if tgt[2] != cur[2]:
        return "patch"
    return "same"


def risk_for(kind: str, severity: str = "") -> str:
    if severity:
        rank = SEVERITY_RANK.get(severity, SEVERITY_RANK["medium"])
        if rank >= SEVERITY_RANK["high"]:
            return "high"
        return "medium"
    return {
        "patch": "low",
        "minor": "medium",
        "major": "high",
        "same": "safe",
        "unknown": "medium",
    }.get(kind, "medium")


def wave_for(kind: str, origin: str) -> str:
    if origin == "advisory":
        return WAVE_SECURITY
    return {
        "patch": WAVE_PATCH,
        "minor": WAVE_MINOR,
        "major": WAVE_MAJOR,
        "same": WAVE_PATCH,
        "unknown": WAVE_MAJOR,
    }.get(kind, WAVE_MAJOR)


def rollback_note(package: str, ecosystem: str, current: str) -> str:
    return (
        f"restore the {ecosystem} lockfile from VCS, re-pin {package}@{current}, "
        f"run that stack's test suite before reopening the wave"
    )


def load_inventory(path_str: str) -> Tuple[Dict, str]:
    if path_str == "-":
        raw = sys.stdin.read()
        label = "<stdin>"
    else:
        path = Path(path_str)
        if not path.is_file():
            raise FileNotFoundError(f"inventory not found: {path_str}")
        raw = path.read_text(encoding="utf-8", errors="replace")
        label = str(path)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in {label}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"expected a JSON object in {label}")
    if "packages" not in data and "findings" not in data:
        raise ValueError(
            f"{label} does not look like dep_scanner output (missing packages/findings)"
        )
    return data, label


def parse_explicit_targets(values: List[str]) -> Dict[Tuple[str, str], str]:
    out: Dict[Tuple[str, str], str] = {}
    for raw in values:
        if "=" not in raw:
            raise ValueError(f"--target expects name=version, got: {raw}")
        name, _, version = raw.partition("=")
        name, version = name.strip(), version.strip()
        if not name or not version:
            raise ValueError(f"--target expects name=version, got: {raw}")
        ecosystem = ""
        if ":" in name:
            ecosystem, _, name = name.partition(":")
        out[(ecosystem.lower(), name.lower())] = version
        if not ecosystem:
            out[("", name.lower())] = version
    return out


def make_item(
    package: str,
    ecosystem: str,
    current: str,
    target: str,
    origin: str,
    reason: str,
    severity: str = "",
) -> Optional[PlanItem]:
    if not target or target == current:
        return None
    if origin != "advisory" and not older_than(current, target):
        return None
    kind = bump_kind(current, target)
    if kind == "same" and origin != "advisory":
        return None
    risk = risk_for(kind, severity)
    wave = wave_for(kind, origin)
    if origin == "advisory":
        kind_label = bump_kind(current, target)
        reason = f"{reason}; bump kind {kind_label}"
    item = PlanItem(
        package=package,
        ecosystem=ecosystem,
        current=current,
        target=target,
        wave=wave,
        risk=risk,
        reason=reason,
        origin=origin,
        rollback=rollback_note(package, ecosystem or "unknown", current),
    )
    return item


def build_plan(
    inventory: Dict,
    label: str,
    risk_threshold: str,
    timeline_days: int,
    security_only: bool,
    explicit: Dict[Tuple[str, str], str],
) -> UpgradePlan:
    plan = UpgradePlan(
        source=label,
        generated_at=datetime.now(timezone.utc).isoformat(),
        timeline_days=timeline_days,
        risk_threshold=risk_threshold,
        security_only=security_only,
    )

    packages = inventory.get("packages") or []
    findings = inventory.get("findings") or []
    threshold = RISK_ORDER[risk_threshold]

    finding_keys = set()
    items: List[PlanItem] = []

    for finding in findings:
        name = str(finding.get("package", "")).strip()
        ecosystem = str(finding.get("ecosystem", "")).strip()
        current = str(finding.get("version", "")).strip()
        fixed = str(finding.get("fixed_in", "")).strip()
        severity = str(finding.get("severity", "medium"))
        advisory_id = str(finding.get("advisory_id", "advisory"))
        summary = str(finding.get("summary", "known vulnerable version"))
        if not name or not current:
            continue
        finding_keys.add((ecosystem.lower(), name.lower()))
        item = make_item(
            name, ecosystem, current, fixed, "advisory",
            f"{advisory_id}: {summary} (severity {severity})",
            severity=severity,
        )
        if item:
            items.append(item)

    planned_keys = {(i.ecosystem.lower(), i.package.lower()) for i in items}

    if not security_only:
        for pkg in packages:
            name = str(pkg.get("name", "")).strip()
            ecosystem = str(pkg.get("ecosystem", "")).strip()
            current = str(pkg.get("version", "")).strip()
            if not name or not current:
                continue
            key = (ecosystem.lower(), name.lower())
            if key in planned_keys:
                continue
            planned_keys.add(key)

            target = explicit.get(key) or explicit.get(("", name.lower()))
            origin = "cli"
            if target:
                reason = "explicit --target for this upgrade"
            else:
                target = KNOWN_LATEST.get(f"{ecosystem}:{name}", "")
                origin = "snapshot"
                reason = "embedded last-known-version snapshot"
            if not target:
                plan.unplanned.append(
                    f"{ecosystem}:{name}@{current} (no target data)"
                )
                continue
            item = make_item(name, ecosystem, current, target, origin, reason)
            if item:
                items.append(item)

    waves = {
        WAVE_SECURITY: Wave(
            WAVE_SECURITY, "Security",
            "Published fixes for advisory hits. Land as soon as CI is green.",
        ),
        WAVE_PATCH: Wave(
            WAVE_PATCH, "Patch",
            "Same-major patch bumps, grouped per ecosystem so each stack gets one lockfile commit.",
        ),
        WAVE_MINOR: Wave(
            WAVE_MINOR, "Minor",
            "Additive upgrades. Skim upstream changelogs for deprecations since your current minor.",
        ),
        WAVE_MAJOR: Wave(
            WAVE_MAJOR, "Major",
            f"Cross-major jumps inside a {timeline_days}-day window. "
            "Migration checklist and rollback tag required before merge.",
        ),
    }

    for item in items:
        if item.wave != WAVE_SECURITY and RISK_ORDER[item.risk] < threshold:
            plan.unplanned.append(
                f"{item.ecosystem}:{item.package} risk={item.risk} below threshold"
            )
            continue
        waves[item.wave].items.append(item)

    for wave in waves.values():
        wave.items.sort(key=lambda it: (-RISK_ORDER[it.risk], it.package))
        if wave.items:
            plan.waves.append(wave)

    by_origin: Dict[str, int] = {}
    for item in items:
        by_origin[item.origin] = by_origin.get(item.origin, 0) + 1

    plan.stats = {
        "packages_in_inventory": len(packages),
        "findings_in_inventory": len(findings),
        "items_planned": sum(len(w.items) for w in plan.waves),
        "unplanned": len(plan.unplanned),
        **{f"origin_{k}": v for k, v in by_origin.items()},
    }
    return plan


def plan_to_dict(plan: UpgradePlan) -> Dict:
    return {
        "source": plan.source,
        "generated_at": plan.generated_at,
        "timeline_days": plan.timeline_days,
        "risk_threshold": plan.risk_threshold,
        "security_only": plan.security_only,
        "stats": plan.stats,
        "waves": [
            {
                "wave": w.wave,
                "title": w.title,
                "guidance": w.guidance,
                "items": [asdict(i) for i in w.items],
            }
            for w in plan.waves
        ],
        "unplanned": plan.unplanned,
    }


def render_text(plan: UpgradePlan) -> str:
    lines = [
        f"upgrade_planner: source={plan.source}",
        f"threshold={plan.risk_threshold} timeline={plan.timeline_days}d "
        f"security_only={str(plan.security_only).lower()}",
        "stats: " + ", ".join(f"{k}={v}" for k, v in plan.stats.items()),
    ]
    for wave in plan.waves:
        lines.append("")
        lines.append(f"Wave {wave.wave}: {wave.title} ({len(wave.items)} items)")
        lines.append(f"  {wave.guidance}")
        for item in wave.items:
            lines.append(
                f"  - {item.package} ({item.ecosystem}): "
                f"{item.current} -> {item.target} [risk={item.risk}, from={item.origin}]"
            )
            lines.append(f"    reason: {item.reason}")
            lines.append(f"    rollback: {item.rollback}")
    if plan.unplanned:
        lines.append("")
        lines.append(f"Unplanned ({len(plan.unplanned)}):")
        for row in plan.unplanned[:40]:
            lines.append(f"  - {row}")
        if len(plan.unplanned) > 40:
            lines.append(f"  ... and {len(plan.unplanned) - 40} more")
    if not plan.waves:
        lines.append("nothing to plan for the current threshold")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Turn dep_scanner JSON into prioritized upgrade waves."
    )
    p.add_argument("inventory", help="Path to scan.json, or - for stdin")
    p.add_argument(
        "--risk-threshold",
        choices=sorted(RISK_ORDER, key=lambda k: RISK_ORDER[k]),
        default="medium",
        help="Drop non-security items below this risk (default: medium)",
    )
    p.add_argument(
        "--timeline", type=int, default=90,
        help="Day budget for the major wave (default: 90)",
    )
    p.add_argument(
        "--security-only", action="store_true",
        help="Emit only the security wave",
    )
    p.add_argument(
        "--target", action="append", default=[],
        metavar="NAME=VERSION",
        help="Explicit upgrade target, ecosystem:optional (repeatable). "
             "Example: --target react=19.0.0 or --target javascript:lodash=4.17.21",
    )
    p.add_argument("--format", choices=["text", "json"], default="text")
    p.add_argument("-o", "--output", type=Path, help="Write the plan to a file")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.timeline < 1:
        print("--timeline must be a positive number of days", file=sys.stderr)
        return 2

    try:
        explicit = parse_explicit_targets(args.target)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    try:
        inventory, label = load_inventory(args.inventory)
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    plan = build_plan(
        inventory,
        label,
        risk_threshold=args.risk_threshold,
        timeline_days=args.timeline,
        security_only=args.security_only,
        explicit=explicit,
    )
    body = (
        json.dumps(plan_to_dict(plan), indent=2)
        if args.format == "json"
        else render_text(plan)
    )

    if args.output:
        try:
            args.output.write_text(body + "\n", encoding="utf-8")
        except OSError as exc:
            print(f"cannot write output: {exc}", file=sys.stderr)
            return 2
    else:
        print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
