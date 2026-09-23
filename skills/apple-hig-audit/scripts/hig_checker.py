#!/usr/bin/env python3
"""Mechanical HIG checks: contrast ratio, hit-target size, type size.

Stdlib only. Prints a paste-ready report block for the audit template.
"""

from __future__ import annotations

import argparse
import sys


def parse_hex(value: str) -> tuple[int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(ch * 2 for ch in v)
    if len(v) != 6:
        raise ValueError(f"invalid color {value!r}")
    try:
        return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
    except ValueError as exc:
        raise ValueError(f"invalid color {value!r}") from exc


def channel_luminance(raw: int) -> float:
    c = raw / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = (channel_luminance(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la = relative_luminance(a)
    lb = relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def check_contrast(pair: str) -> tuple[bool, str]:
    parts = [p for p in pair.split("|") if p.strip()]
    if len(parts) != 2:
        raise ValueError("--pair expects 'FG|BG', e.g. '#FFFFFF|#1C1C1E'")
    fg = parse_hex(parts[0])
    bg = parse_hex(parts[1])
    ratio = contrast_ratio(fg, bg)
    aa_normal = ratio >= 4.5
    aa_large = ratio >= 3.0
    verdict = "PASS" if aa_normal else ("LARGE-ONLY" if aa_large else "FAIL")
    line = (
        f"contrast {parts[0]} on {parts[1]}: {ratio:.2f}:1 "
        f"AA-body={'yes' if aa_normal else 'no'} "
        f"AA-large={'yes' if aa_large else 'no'} -> {verdict}"
    )
    return aa_normal or aa_large, line


def check_target_mm(target_mm: float, minimum_mm: float = 44.0) -> tuple[bool, str]:
    # HIG minimum primary hit target is 44pt on iOS; treat mm as the
    # measured short edge when the designer reports metric units.
    ok = target_mm >= minimum_mm
    line = (
        f"hit target {target_mm:g} mm: {'PASS' if ok else 'FAIL'} "
        f"(threshold {minimum_mm:g})"
    )
    return ok, line


def check_text_pt(text_pt: float, minimum_pt: float = 11.0) -> tuple[bool, str]:
    ok = text_pt >= minimum_pt
    line = (
        f"text size {text_pt:g} pt: {'PASS' if ok else 'FAIL'} "
        f"(floor {minimum_pt:g} pt for body under Dynamic Type default)"
    )
    return ok, line


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run mechanical HIG checks.")
    parser.add_argument("--pair", help="FG|BG hex pair for contrast")
    parser.add_argument("--target-mm", type=float, help="measured hit-target short edge in mm")
    parser.add_argument("--target-min-mm", type=float, default=44.0)
    parser.add_argument("--text-pt", type=float, help="text size in points")
    parser.add_argument("--text-min-pt", type=float, default=11.0)
    args = parser.parse_args(argv)

    if not any([args.pair, args.target_mm is not None, args.text_pt is not None]):
        parser.error("provide at least one of --pair, --target-mm, --text-pt")

    results: list[tuple[bool, str]] = []
    try:
        if args.pair:
            results.append(check_contrast(args.pair))
        if args.target_mm is not None:
            results.append(check_target_mm(args.target_mm, args.target_min_mm))
        if args.text_pt is not None:
            results.append(check_text_pt(args.text_pt, args.text_min_pt))
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print("### Mechanical HIG checks")
    all_ok = True
    for ok, line in results:
        print(f"- {line}")
        all_ok = all_ok and ok
    print()
    print(f"Overall: {'PASS' if all_ok else 'FAIL'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
