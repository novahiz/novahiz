#!/usr/bin/env python3
"""Offline auditor for environment files and source trees.

Walks a project, matches credential-shaped strings against a built-in rule
catalog, redacts evidence, and reports findings by severity. No network.

Usage:
    python3 env_auditor.py .
    python3 env_auditor.py . --json -o report.json
    python3 env_auditor.py . --env-only
    python3 env_auditor.py . --skip vendor --skip tmp

Exit codes:
    0  clean, or only low findings
    1  at least one high or critical finding
    2  bad invocation (missing path, unreadable output target)
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional

SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}

DEFAULT_SKIP = {
    ".git", "node_modules", "vendor", "venv", ".venv", "__pycache__",
    "dist", "build", ".next", "coverage", ".terraform", ".tox", ".mypy_cache",
}

SOURCE_SUFFIXES = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java", ".rb",
    ".php", ".cs", ".kt", ".swift", ".c", ".cpp", ".h", ".yml", ".yaml",
    ".toml", ".ini", ".cfg", ".conf", ".json", ".jsonl", ".md", ".txt",
    ".sh", ".bash", ".zsh", ".env", ".properties", ".tf", ".hcl", ".sql",
}

PLACEHOLDER_WORDS = {
    "changeme", "change-me", "example", "placeholder", "your-key-here",
    "your_key_here", "xxxxxx", "xxx", "todo", "tbd", "dummy", "sample",
    "redacted", "secret", "password", "passwort", "none", "null", "nil",
    "test", "testing", "fake", "dummy-value", "insert-key-here", "abcdef",
}

INTERPOLATION = re.compile(
    r"^\s*(\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|\{\{[^}]+\}\}|"
    r"process\.env\.[A-Za-z0-9_]+|os\.environ(\[[^\]]+\]|\.get\()|"
    r"os\.Getenv\(|System\.getenv\(|%[A-Za-z0-9_]+%|@@[A-Za-z0-9_]+@@)"
)

ASSIGNMENT = re.compile(
    r"(?i)\b([A-Za-z0-9_.-]*(?:password|passwd|secret|api[_-]?key|apikey|"
    r"access[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key|"
    r"token|credential|dsn|conn[_-]?str)[A-Za-z0-9_.-]*)\b"
    r"\s*[:=]\s*[\"']?([^\s\"'#]{4,})"
)

DB_URL = re.compile(
    r"(?i)\b((?:postgres|postgresql|mysql|mongodb|redis|mssql)://[^:\s/@]+):([^@\s]{3,})@"
)

JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
PEM = re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----")


@dataclass(frozen=True)
class Rule:
    rule_id: str
    severity: str
    label: str
    finder: re.Pattern
    min_len: int = 0


@dataclass
class Finding:
    rule_id: str
    severity: str
    label: str
    path: str
    line: int
    evidence: str


RULES: List[Rule] = [
    Rule("AWS_ACCESS_KEY_ID", "critical", "AWS access key ID",
         re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), 20),
    Rule("GITHUB_PAT", "critical", "GitHub personal access token",
         re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b"), 20),
    Rule("GITHUB_FINE_GRAINED_PAT", "critical", "GitHub fine-grained PAT",
         re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"), 20),
    Rule("SLACK_TOKEN", "high", "Slack token",
         re.compile(r"\bxox[baprse]-[A-Za-z0-9-]{10,}\b"), 10),
    Rule("OPENAI_STYLE_KEY", "critical", "OpenAI-style API key",
         re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"), 20),
    Rule("GOOGLE_API_KEY", "high", "Google API key",
         re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), 35),
    Rule("GITLAB_TOKEN", "critical", "GitLab token",
         re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b"), 20),
    Rule("NPM_TOKEN", "critical", "npm token",
         re.compile(r"\bnpm_[A-Za-z0-9]{30,}\b"), 30),
    Rule("STRIPE_LIVE_KEY", "critical", "Stripe live secret key",
         re.compile(r"\bsk_live_[A-Za-z0-9]{16,}\b"), 16),
    Rule("SENDGRID_KEY", "critical", "SendGrid API key",
         re.compile(r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b"), 30),
    Rule("PRIVATE_KEY_BLOCK", "critical", "PEM private key block",
         PEM, 0),
    Rule("CREDENTIAL_ASSIGNMENT", "high", "Credential-looking assignment",
         ASSIGNMENT, 8),
    Rule("DB_URL_PASSWORD", "critical", "Database URL with password",
         DB_URL, 3),
    Rule("JWT_TOKEN", "high", "JWT-shaped token",
         JWT, 40),
]


def shannon_entropy(text: str) -> float:
    if not text:
        return 0.0
    counts: Dict[str, int] = {}
    for ch in text:
        counts[ch] = counts.get(ch, 0) + 1
    total = len(text)
    return -sum((n / total) * math.log2(n / total) for n in counts.values())


def is_placeholder(value: str) -> bool:
    stripped = value.strip().strip("\"'")
    if not stripped:
        return True
    low = stripped.lower()
    if INTERPOLATION.match(stripped):
        return True
    if low in PLACEHOLDER_WORDS:
        return True
    if set(low) <= {"x", "*", "-", "_", ".", "0"} and len(low) >= 3:
        return True
    if "example" in low or "your-" in low or "your_" in low:
        return True
    if "process.env" in low or "os.environ" in low or "getenv" in low:
        return True
    return False


def redact(value: str) -> str:
    text = value.strip()
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:4]}...{text[-2:]} ({len(text)} chars, h={shannon_entropy(text):.1f})"


def iter_files(root: Path, skip: set, env_only: bool) -> Iterator[Path]:
    if root.is_file():
        yield root
        return
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        parts = set(path.parts)
        if parts & skip:
            continue
        name = path.name.lower()
        if env_only:
            if name.startswith(".env") or name.endswith(".env"):
                yield path
            continue
        if name.startswith(".env") or path.suffix.lower() in SOURCE_SUFFIXES:
            yield path


def scan_value(rule: Rule, value: str) -> Optional[str]:
    if rule.rule_id == "CREDENTIAL_ASSIGNMENT" and is_placeholder(value):
        return None
    if rule.rule_id in {"OPENAI_STYLE_KEY", "STRIPE_LIVE_KEY", "SENDGRID_KEY"}:
        if is_placeholder(value):
            return None
    if rule.min_len and len(value.strip().strip("\"'")) < rule.min_len:
        if rule.rule_id != "PRIVATE_KEY_BLOCK":
            return None
    if rule.rule_id == "JWT_TOKEN" and shannon_entropy(value) < 3.2:
        return None
    if rule.rule_id == "CREDENTIAL_ASSIGNMENT" and shannon_entropy(value) < 3.0:
        if len(value) < 16:
            return None
    return redact(value)


def scan_line(line: str) -> List[tuple]:
    hits: List[tuple] = []
    for rule in RULES:
        if rule.rule_id == "DB_URL_PASSWORD":
            m = DB_URL.search(line)
            if m:
                password = m.group(2)
                if not is_placeholder(password):
                    hits.append((rule, f"{m.group(1)}:{redact(password)}@"))
            continue
        for m in rule.finder.finditer(line):
            candidate = m.group(0)
            if rule.rule_id == "CREDENTIAL_ASSIGNMENT":
                candidate = m.group(2)
            evidence = scan_value(rule, candidate)
            if evidence:
                hits.append((rule, evidence))
                break
    return hits


def high_entropy_assignment(line: str) -> List[tuple]:
    m = ASSIGNMENT.search(line)
    if not m:
        return []
    name, value = m.group(1), m.group(2)
    if is_placeholder(value):
        return []
    if len(value) < 16 or shannon_entropy(value) < 4.0:
        return []
    rule = Rule("HIGH_ENTROPY_SECRET", "medium",
                f"High-entropy value assigned to {name}", ASSIGNMENT, 0)
    return [(rule, redact(value))]


def scan_tree(root: Path, skip: set, env_only: bool) -> List[Finding]:
    findings: List[Finding] = []
    for path in iter_files(root, skip, env_only):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = str(path)
        for lineno, line in enumerate(text.splitlines(), 1):
            if len(line) > 8000:
                line = line[:8000]
            hits = scan_line(line) or high_entropy_assignment(line)
            for rule, evidence in hits:
                findings.append(Finding(
                    rule_id=rule.rule_id,
                    severity=rule.severity,
                    label=rule.label,
                    path=rel,
                    line=lineno,
                    evidence=evidence,
                ))
    findings.sort(key=lambda f: (-SEVERITY_RANK[f.severity], f.path, f.line))
    return findings


def summarize(findings: List[Finding]) -> Dict[str, int]:
    counts = {level: 0 for level in SEVERITY_RANK}
    for f in findings:
        counts[f.severity] += 1
    return counts


def render_text(findings: List[Finding], root: Path) -> str:
    counts = summarize(findings)
    lines = [
        f"env_auditor: {root}",
        "counts: "
        + ", ".join(f"{k}={counts[k]}" for k in ("critical", "high", "medium", "low")),
    ]
    for f in findings:
        lines.append(
            f"[{f.severity.upper()}] {f.rule_id} {f.path}:{f.line} "
            f"{f.label} -> {f.evidence}"
        )
    if not findings:
        lines.append("no credential-shaped strings found")
    return "\n".join(lines)


def render_json(findings: List[Finding], root: Path) -> str:
    payload = {
        "target": str(root),
        "counts": summarize(findings),
        "findings": [asdict(f) for f in findings],
    }
    return json.dumps(payload, indent=2)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Offline secret auditor for env files and source trees."
    )
    p.add_argument("target", type=Path, help="File or directory to scan")
    p.add_argument("--json", action="store_true", help="Emit JSON")
    p.add_argument("-o", "--output", type=Path, help="Write the report to a file")
    p.add_argument(
        "--env-only", action="store_true",
        help="Scan only .env-style files",
    )
    p.add_argument(
        "--skip", action="append", default=[],
        help="Directory name to skip (repeatable)",
    )
    p.add_argument(
        "--fail-on", choices=["high", "critical"], default="high",
        help="Minimum severity that produces exit code 1 (default: high)",
    )
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if not args.target.exists():
        print(f"path not found: {args.target}", file=sys.stderr)
        return 2

    skip = DEFAULT_SKIP | set(args.skip)
    findings = scan_tree(args.target, skip, args.env_only)
    body = render_json(findings, args.target) if args.json else render_text(
        findings, args.target
    )

    if args.output:
        try:
            args.output.write_text(body + "\n", encoding="utf-8")
        except OSError as exc:
            print(f"cannot write output: {exc}", file=sys.stderr)
            return 2
    else:
        print(body)

    threshold = SEVERITY_RANK[args.fail_on]
    worst = max(
        (SEVERITY_RANK[f.severity] for f in findings),
        default=-1,
    )
    return 1 if worst >= threshold else 0


if __name__ == "__main__":
    sys.exit(main())
