#!/usr/bin/env node
/**
 * contrast.mjs: WCAG contrast ratio for a color pair.
 * Stdlib only. Exit 0 when the pair meets the chosen threshold,
 * exit 1 when it misses, exit 2 on usage or parse errors.
 *
 * Usage:
 *   node contrast.mjs "#767676" "#ffffff"
 *   node contrast.mjs "rgb(118,118,118)" "white"
 *   node contrast.mjs "#767676" "#ffffff" --text large
 *   node contrast.mjs "#767676" "#ffffff" --level aaa --text normal
 */

const NAMED_COLORS = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
  transparent: null,
};

const THRESHOLDS = {
  aa: { normal: 4.5, large: 3 },
  aaa: { normal: 7, large: 4.5 },
};

function parseHex(hex) {
  const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let digits = match[1];
  if (digits.length === 3) {
    digits = digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2];
  }
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

function parseColor(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, value)) {
    const mapped = NAMED_COLORS[value];
    return mapped ? parseHex(mapped) : null;
  }
  if (value.startsWith("#")) return parseHex(value);
  const rgb = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/,
  );
  if (!rgb) return null;
  const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (!channels.every((v) => v >= 0 && v <= 255)) return null;
  return { r: channels[0], g: channels[1], b: channels[2] };
}

function channelLuminance(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function ratioBetween(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function printUsage() {
  console.error(
    "Usage: node contrast.mjs <fg> <bg> [--level aa|aaa] [--text normal|large]",
  );
  console.error("Colors: #rgb #rrggbb rgb(r,g,b) named (white, black, ...)");
}

function levelLabel(level, textSize) {
  const tier = level === "aaa" ? "AAA" : "AA";
  return `${tier}-${textSize}`;
}

function run(argv) {
  const args = argv.slice(2);
  let level = "aa";
  let text = "normal";
  const colors = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--level") {
      level = String(args[++i] || "").toLowerCase();
    } else if (token === "--text") {
      text = String(args[++i] || "").toLowerCase();
    } else if (token.startsWith("--")) {
      printUsage();
      return 2;
    } else {
      colors.push(token);
    }
  }

  const levelOk = Object.prototype.hasOwnProperty.call(THRESHOLDS, level);
  const textOk = text === "normal" || text === "large";
  if (colors.length !== 2 || !levelOk || !textOk) {
    printUsage();
    return 2;
  }

  const fg = parseColor(colors[0]);
  const bg = parseColor(colors[1]);
  if (!fg || !bg) {
    const bad = !fg ? colors[0] : colors[1];
    console.error(`error: cannot parse color: ${bad}`);
    return 2;
  }

  const value = ratioBetween(fg, bg);
  const threshold = THRESHOLDS[level][text];
  const passed = value + 1e-9 >= threshold;
  const rounded = value.toFixed(2);
  const mark = passed ? "PASS" : "FAIL";
  console.log(
    `${rounded}:1 ${levelLabel(level, text)} ${mark} (need ${threshold}:1)`,
  );
  return passed ? 0 : 1;
}

process.exit(run(process.argv));
