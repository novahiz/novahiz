#!/usr/bin/env python3
"""Generate a DTCG-shaped design token file from brand inputs.

Stdlib only. Deterministic: same flags produce the same JSON bytes.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


def parse_hex(value: str) -> tuple[int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(ch * 2 for ch in v)
    if len(v) != 6:
        raise ValueError(f"expected 3 or 6 hex digits, got {value!r}")
    try:
        r = int(v[0:2], 16)
        g = int(v[2:4], 16)
        b = int(v[4:6], 16)
    except ValueError as exc:
        raise ValueError(f"invalid hex color {value!r}") from exc
    return r, g, b


def to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = (max(0, min(255, int(round(c)))) for c in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def mix(rgb: tuple[int, int, int], target: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        rgb[0] + (target[0] - rgb[0]) * t,
        rgb[1] + (target[1] - rgb[1]) * t,
        rgb[2] + (target[2] - rgb[2]) * t,
    )


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    def channel(raw: int) -> float:
        c = raw / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r_lin = channel(int(round(rgb[0])))
    g_lin = channel(int(round(rgb[1])))
    b_lin = channel(int(round(rgb[2])))
    return 0.2126 * r_lin + 0.7152 * g_lin + 0.0722 * b_lin


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la = relative_luminance(a)
    lb = relative_luminance(b)
    lighter = max(la, lb)
    darker = min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def ensure_text_readable(fg_hex: str, bg_hex: str, minimum: float = 4.5) -> str:
    fg = parse_hex(fg_hex)
    bg = parse_hex(bg_hex)
    ratio = contrast_ratio(fg, bg)
    if ratio >= minimum:
        return fg_hex
    # Walk toward white or black, whichever reaches the threshold first.
    white = (255, 255, 255)
    black = (0, 0, 0)
    toward_white = _edge_search(fg, bg, white, minimum)
    toward_black = _edge_search(fg, bg, black, minimum)
    if toward_white is None and toward_black is None:
        raise ValueError(
            f"cannot reach contrast {minimum}:1 between {fg_hex} and {bg_hex}"
        )
    if toward_white is None:
        chosen = toward_black
    elif toward_black is None:
        chosen = toward_white
    else:
        chosen = toward_white if contrast_ratio(parse_hex(toward_white), bg) >= contrast_ratio(
            parse_hex(toward_black), bg
        ) else toward_black
    return chosen


def _edge_search(
    fg: tuple[int, int, int],
    bg: tuple[int, int, int],
    endpoint: tuple[int, int, int],
    minimum: float,
) -> str | None:
    lo, hi = 0.0, 1.0
    best: str | None = None
    for _ in range(24):
        mid = (lo + hi) / 2.0
        candidate = mix(fg, endpoint, mid)
        if contrast_ratio(candidate, bg) >= minimum:
            best = to_hex(candidate)
            hi = mid
        else:
            lo = mid
    return best


def build_surface_ramp(seed_hex: str, dark: bool) -> dict[str, str]:
    seed = parse_hex(seed_hex)
    white = (255, 255, 255)
    black = (0, 0, 0)
    ramp: dict[str, str] = {}
    steps = [100, 200, 300, 400, 500, 600, 700, 800, 900]
    for step in steps:
        # 100 is closest to the page background, 900 closest to ink.
        t = (step - 100) / 800.0
        if dark:
            # On dark themes 100 is deep, 900 lifts toward the seed.
            mixed = mix(black, seed, t * 0.85)
        else:
            mixed = mix(white, seed, t * 0.55)
            if step >= 500:
                mixed = mix(seed, black, (step - 500) / 400.0 * 0.75)
        ramp[str(step)] = to_hex(mixed)
    return ramp


def type_scale(base: float, ratio: float, count: int = 11) -> dict[str, float]:
    sizes: dict[str, float] = {}
    for n in range(count):
        raw = base * (ratio ** n)
        if raw < 24:
            sizes[str(n)] = float(round(raw))
        else:
            sizes[str(n)] = float(round(raw, 1))
    return sizes


def space_scale(unit: float, count: int = 13) -> dict[str, float]:
    return {str(i): float(unit * i) for i in range(count)}


def leaf(value: Any, type_name: str, description: str | None = None) -> dict[str, Any]:
    node: dict[str, Any] = {"$type": type_name, "$value": value}
    if description:
        node["$description"] = description
    return node


def build_tokens(
    brand: str,
    accent: str,
    base_font: float,
    ratio: float,
    space_unit: float,
    dark: bool,
) -> dict[str, Any]:
    surface = build_surface_ramp(brand, dark)
    ink_base = "#0B0B0C" if not dark else "#F5F5F7"
    bg_base = surface["100"]
    text_primary = ensure_text_readable(ink_base, bg_base, 4.5)
    text_secondary_src = "#3A3A3C" if not dark else "#C7C7CC"
    text_secondary = ensure_text_readable(text_secondary_src, bg_base, 4.5)

    sizes = type_scale(base_font, ratio)
    spaces = space_scale(space_unit)

    tokens: dict[str, Any] = {
        "color": {
            "brand": {"primary": leaf(brand, "color", "Primary brand hue")},
            "accent": {"default": leaf(accent, "color", "Accent for primary actions")},
            "surface": {
                "page": leaf(bg_base, "color", "Page background"),
                "raised": leaf(surface["200"] if not dark else surface["800"], "color"),
            },
            "text": {
                "primary": leaf(text_primary, "color", "Body and heading text"),
                "secondary": leaf(text_secondary, "color", "Supporting copy"),
                "inverse": leaf(
                    ensure_text_readable("#FFFFFF" if dark else "#0B0B0C", brand, 4.5),
                    "color",
                    "Text on brand fills",
                ),
            },
            "border": {
                "subtle": leaf(surface["300"] if not dark else surface["700"], "color"),
            },
            "semantic": {
                "success": leaf("#1B7F4E", "color"),
                "warning": leaf("#A15C00", "color"),
                "danger": leaf("#B42318", "color"),
                "info": leaf(brand, "color"),
            },
        },
        "typography": {
            "fontFamily": {
                "sans": leaf(
                    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                    "fontFamily",
                ),
                "mono": leaf(
                    "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
                    "fontFamily",
                ),
            },
            "fontWeight": {
                "regular": leaf(400, "fontWeight"),
                "medium": leaf(500, "fontWeight"),
                "bold": leaf(700, "fontWeight"),
            },
            "fontSize": {
                name: leaf(f"{value}px", "dimension", f"Scale step {name}")
                for name, value in sizes.items()
            },
            "lineHeight": {
                "display": leaf(1.2, "number"),
                "body": leaf(1.5, "number"),
            },
        },
        "space": {
            name: leaf(f"{value}px", "dimension", f"Spacing step {name}")
            for name, value in spaces.items()
        },
        "radius": {
            "sm": leaf("4px", "dimension"),
            "md": leaf("8px", "dimension"),
            "lg": leaf("16px", "dimension"),
            "pill": leaf("999px", "dimension"),
        },
        "shadow": {
            "elevation1": leaf(
                {"color": "#00000014", "offsetX": "0px", "offsetY": "1px", "blur": "2px", "spread": "0px"},
                "shadow",
            ),
            "elevation2": leaf(
                {"color": "#00000022", "offsetX": "0px", "offsetY": "4px", "blur": "12px", "spread": "0px"},
                "shadow",
            ),
        },
        "motion": {
            "duration": {
                "fast": leaf("150ms", "duration"),
                "base": leaf("250ms", "duration"),
                "slow": leaf("400ms", "duration"),
            },
            "easing": {
                "standard": leaf([0.2, 0.0, 0.0, 1.0], "cubicBezier"),
                "decelerate": leaf([0.0, 0.0, 0.0, 1.0], "cubicBezier"),
            },
        },
    }

    if dark:
        tokens["color"]["surface"]["page"]["$value"] = surface["900"]
        tokens["color"]["text"]["primary"]["$value"] = ensure_text_readable(
            "#F5F5F7", surface["900"], 4.5
        )

    # Contrast gate: every text token against page surface must pass AA body.
    page = parse_hex(tokens["color"]["surface"]["page"]["$value"])
    for key in ("primary", "secondary"):
        fg = parse_hex(tokens["color"]["text"][key]["$value"])
        ratio_val = contrast_ratio(fg, page)
        if ratio_val < 4.5:
            raise RuntimeError(
                f"text.{key} contrast {ratio_val:.2f}:1 against surface.page fails AA"
            )
    return tokens


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Emit a DTCG design token JSON file."
    )
    parser.add_argument("--brand", default="#0B5FFF", help="brand hex color")
    parser.add_argument("--accent", default="#FF6B35", help="accent hex color")
    parser.add_argument("--base-font", type=float, default=16.0, help="base font size in px")
    parser.add_argument("--ratio", type=float, default=1.25, help="type scale multiplier")
    parser.add_argument("--space-unit", type=float, default=8.0, help="spacing base unit in px")
    parser.add_argument("--dark", action="store_true", help="emit a dark surface ramp")
    parser.add_argument("--out", default="tokens.json", help="output path")
    args = parser.parse_args(argv)

    if args.ratio <= 1.0:
        print("ratio must be > 1.0", file=sys.stderr)
        return 2
    if args.space_unit <= 0:
        print("space-unit must be > 0", file=sys.stderr)
        return 2

    try:
        tokens = build_tokens(
            brand=args.brand,
            accent=args.accent,
            base_font=args.base_font,
            ratio=args.ratio,
            space_unit=args.space_unit,
            dark=args.dark,
        )
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    payload = json.dumps(tokens, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(payload, encoding="utf-8")
    print(f"wrote {out_path} ({len(payload)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
