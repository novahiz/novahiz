#!/usr/bin/env python3
"""Offline threat probe for LLM apps, models, and tool-using agents.

Matches signature rules over files you supply, optionally replays a probe
pack, maps hits to MITRE ATLAS IDs, and prints a robustness score.
No network calls, no model API.

Usage:
    python3 ai_threat_scanner.py --path ./app --surface llm --mode passive
    python3 ai_threat_scanner.py --path ./app --surface agent --mode passive --json -o out.json
    python3 ai_threat_scanner.py --surface agent --mode active --pack probes.json --i-am-authorized --json
    python3 ai_threat_scanner.py --show-rules

Exit codes:
    0  nothing above medium
    1  medium or high findings present
    2  critical findings, or active mode without --i-am-authorized
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
SEVERITY_PENALTY = {"low": 2, "medium": 8, "high": 20, "critical": 40}
BANDS = ((90, "hardened"), (70, "serviceable"), (40, "exposed"), (0, "wide open"))

SCAN_SUFFIXES = {
    ".md", ".txt", ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".yaml",
    ".yml", ".toml", ".csv", ".jsonl", ".prompt", ".system",
}
SKIP_DIRS = {
    ".git", "node_modules", "venv", ".venv", "__pycache__", "dist",
    "build", ".next", "coverage", ".terraform",
}
TEXT_NAMES = {".env", ".env.example", "dockerfile", "makefile"}


@dataclass(frozen=True)
class Rule:
    rule_id: str
    channel: str
    atlas: str
    severity: str
    weight: int
    pattern: re.Pattern
    blurb: str


@dataclass
class Hit:
    rule_id: str
    channel: str
    atlas: str
    severity: str
    source: str
    line: int
    excerpt: str
    blurb: str


@dataclass
class ScanResult:
    surface: str
    mode: str
    files_scanned: int = 0
    hits: List[Hit] = field(default_factory=list)
    score: int = 100
    band: str = "hardened"
    worst: str = "none"


RULES: List[Rule] = [
    Rule(
        "ROLE_OVERRIDE", "prompt", "AML.T0051", "high", 20,
        re.compile(
            r"(?i)\b(ignore|disregard|forget|override|bypass)\b.{0,40}"
            r"\b(previous|prior|above|earlier|initial|system|standing)\b.{0,20}"
            r"\b(instruction|rule|prompt|directive)s?\b"
        ),
        "Text tells the model to drop its standing rules",
    ),
    Rule(
        "PERSONA_ESCAPE", "prompt", "AML.T0054", "high", 20,
        re.compile(
            r"(?i)\b(you are now|act as|pretend to be|roleplay as|enter)\b.{0,30}"
            r"\b(unrestricted|uncensored|jailbroken|evil|dan|developer mode|"
            r"admin mode|no rules|without restrictions)\b"
        ),
        "Persona framing aimed at unlocking unrestricted behavior",
    ),
    Rule(
        "PROMPT_LEAK", "prompt", "AML.T0056", "high", 20,
        re.compile(
            r"(?i)\b(reveal|print|repeat|show|output|dump|expose)\b.{0,40}"
            r"\b(your|the|this|hidden|system|initial)\b.{0,20}"
            r"\b(system prompt|prompt|instruction|directive|rules)\b"
        ),
        "Attempt to echo hidden instructions or the system prompt",
    ),
    Rule(
        "RETRIEVAL_INJECT", "retrieval", "AML.T0051.001", "high", 20,
        re.compile(
            r"\{\{\s*(system|admin|developer)\s*[^}]*\}\}|"
            r"<\s*(system|assistant)\s*>|"
            r"\[\s*INST\s*\]|"
            r"(?i)\bassistant\s*must\s*(obey|follow|comply)"
        ),
        "Stored content carries instruction-shaped payloads or template tokens",
    ),
    Rule(
        "TOOL_STEER", "tool", "AML.T0051.002", "critical", 40,
        re.compile(
            r"(?i)\b(send|email|post|upload|delete|purge|wipe|transfer)\b.{0,30}"
            r"\b(all|every|each|bulk|entire)\b.{0,30}"
            r"\b(files|records|rows|messages|secrets|keys|credentials|data)\b|"
            r"(?i)\b(skip|bypass|ignore)\b.{0,20}\b(confirmation|approval|human review)\b"
        ),
        "Payload steers tool calls toward bulk or irreversible actions",
    ),
    Rule(
        "POISON_MARKER", "training", "AML.T0020", "critical", 40,
        re.compile(
            r"(?i)^\s*(label\s*flip|backdoor\s*trigger|planted\s*marker|"
            r"insert\s*after\s*trigger|special\s*token\s*admin)\b|"
            r"\|\|ADMIN\|\||<\|attack\|>|%%JAILBREAK%%"
        ),
        "Dataset row looks like a planted trigger or label tamper",
    ),
    Rule(
        "INVERSION_PROBE", "inference", "AML.T0024", "medium", 8,
        re.compile(
            r"(?i)\b(was\s+[\"'].+?[\"']\s+in\s+(your|the)\s+training\s+set|"
            r"regurgitate|reproduce\s+(your\s+)?training\s+(data|examples)|"
            r"membership\s+inference|extract\s+(the\s+)?training\s+data)\b"
        ),
        "Query pattern aims at training rows or membership answers",
    ),
    Rule(
        "ADVERSARIAL_SHAPE", "inference", "AML.T0043", "medium", 8,
        re.compile(
            r"(?i)(glitch\s+token|adversarial\s+perturbation\s+template)|"
            r"\[\[\[\[\[|"
            r"(?i)\btoken\s*:*\s*repeat\s*{5,}"
        ),
        "Crafted or degenerate input shapes used to degrade filters",
    ),
]

REACH_BOOST = {"llm": 0, "classifier": 0, "embedding": 0, "agent": 1, "all": 1}


def bump(severity: str, steps: int) -> str:
    order = ["low", "medium", "high", "critical"]
    idx = min(max(order.index(severity) + steps, 0), len(order) - 1)
    return order[idx]


def iter_scan_files(root: Path) -> Iterator[Path]:
    if root.is_file():
        yield root
        return
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        name = path.name.lower()
        if path.suffix.lower() in SCAN_SUFFIXES or name in TEXT_NAMES or name.startswith(".env"):
            yield path


def excerpt(line: str, match: re.Match) -> str:
    lo = max(match.start() - 30, 0)
    hi = min(match.end() + 30, len(line))
    piece = line[lo:hi].strip()
    if len(piece) > 160:
        piece = piece[:157] + "..."
    return piece


def scan_tree(root: Path, surface: str) -> ScanResult:
    result = ScanResult(surface=surface, mode="passive")
    boost = REACH_BOOST.get(surface, 0)
    for path in iter_scan_files(root):
        result.files_scanned += 1
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if len(line) > 4000:
                line = line[:4000]
            for rule in RULES:
                m = rule.pattern.search(line)
                if not m:
                    continue
                severity = bump(rule.severity, boost)
                result.hits.append(Hit(
                    rule_id=rule.rule_id,
                    channel=rule.channel,
                    atlas=rule.atlas,
                    severity=severity,
                    source=str(path),
                    line=lineno,
                    excerpt=excerpt(line, m),
                    blurb=rule.blurb,
                ))
    return result


def load_pack(path: Path) -> List[str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() == ".json":
        data = json.loads(raw)
        if isinstance(data, dict):
            data = data.get("prompts") or data.get("probes") or data.get("cases") or []
        return [str(x) for x in data]
    return [ln.strip() for ln in raw.splitlines() if ln.strip() and not ln.startswith("#")]


def probe_pack(pack_path: Path, surface: str) -> ScanResult:
    result = ScanResult(surface=surface, mode="active")
    boost = REACH_BOOST.get(surface, 0)
    for idx, entry in enumerate(load_pack(pack_path), 1):
        result.files_scanned += 1
        for rule in RULES:
            m = rule.pattern.search(entry)
            if not m:
                continue
            severity = bump(rule.severity, boost)
            result.hits.append(Hit(
                rule_id=rule.rule_id,
                channel=rule.channel,
                atlas=rule.atlas,
                severity=severity,
                source=f"{pack_path}#{idx}",
                line=idx,
                excerpt=excerpt(entry, m),
                blurb=rule.blurb,
            ))
    return result


def score_of(hits: List[Hit]) -> Tuple[int, str, str]:
    total = 100
    worst = "none"
    for hit in hits:
        total -= SEVERITY_PENALTY[hit.severity]
        if SEVERITY_ORDER[hit.severity] > SEVERITY_ORDER.get(worst, -1):
            worst = hit.severity
    total = max(total, 0)
    for floor, name in BANDS:
        if total >= floor:
            return total, name, worst
    return total, "wide open", worst


def finalize(result: ScanResult) -> ScanResult:
    result.score, result.band, result.worst = score_of(result.hits)
    result.hits.sort(key=lambda h: (-SEVERITY_ORDER[h.severity], h.source, h.line))
    return result


def exit_code(result: ScanResult, authorized: bool, mode: str) -> int:
    if mode == "active" and not authorized:
        return 2
    if result.worst == "critical":
        return 2
    if SEVERITY_ORDER.get(result.worst, -1) >= SEVERITY_ORDER["medium"]:
        return 1
    return 0


def render_text(result: ScanResult) -> str:
    lines = [
        f"surface={result.surface} mode={result.mode} files={result.files_scanned}",
        f"score={result.score} band={result.band} worst={result.worst} findings={len(result.hits)}",
    ]
    for h in result.hits:
        lines.append(
            f"[{h.severity.upper()}] {h.rule_id} ({h.atlas}) "
            f"{h.source}:{h.line} :: {h.excerpt}"
        )
    return "\n".join(lines)


def render_json(result: ScanResult) -> str:
    payload = asdict(result)
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["rule_count"] = len(RULES)
    return json.dumps(payload, indent=2)


def show_rules() -> str:
    rows = [
        f"{r.rule_id:<18} {r.severity:<9} {r.atlas:<16} {r.channel:<11} {r.blurb}"
        for r in RULES
    ]
    return "\n".join(rows)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Offline AI threat scanner (signatures only, no model calls)."
    )
    p.add_argument("--path", type=Path, help="File or directory to scan in passive mode")
    p.add_argument(
        "--surface", choices=["llm", "classifier", "embedding", "agent", "all"],
        default="llm", help="Target surface (raises severity for reachable agent channels)",
    )
    p.add_argument(
        "--mode", choices=["passive", "active"], default="passive",
        help="passive = read files; active = replay a probe pack",
    )
    p.add_argument("--pack", type=Path, help="Probe pack (json array or line-delimited text)")
    p.add_argument(
        "--i-am-authorized", action="store_true",
        help="Required for active mode: confirms written authorization",
    )
    p.add_argument("--json", action="store_true", help="Emit JSON")
    p.add_argument("-o", "--output", type=Path, help="Write report to this file")
    p.add_argument("--show-rules", action="store_true", help="Print the rule catalog and exit")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if args.show_rules:
        print(show_rules())
        return 0

    if args.mode == "active":
        if not args.pack:
            print("active mode requires --pack", file=sys.stderr)
            return 2
        if not args.i_am_authorized:
            print(
                "active mode needs --i-am-authorized (written approval required)",
                file=sys.stderr,
            )
            return 2
        if not args.pack.is_file():
            print(f"pack not found: {args.pack}", file=sys.stderr)
            return 2
        result = finalize(probe_pack(args.pack, args.surface))
    else:
        if not args.path:
            print("passive mode requires --path", file=sys.stderr)
            return 2
        if not args.path.exists():
            print(f"path not found: {args.path}", file=sys.stderr)
            return 2
        result = finalize(scan_tree(args.path, args.surface))

    body = render_json(result) if args.json else render_text(result)
    if args.output:
        args.output.write_text(body + "\n", encoding="utf-8")
    else:
        print(body)
    return exit_code(result, args.i_am_authorized, args.mode)


if __name__ == "__main__":
    sys.exit(main())
