#!/usr/bin/env node
/**
 * ui-slop-remover: scan CSS/HTML/JSX for high-confidence generated-UI tells.
 * Offline regex pass. Not a design review; flags candidates for a human pass.
 *
 * Usage: node scripts/slop_lint.mjs <file-or-dir> [...]
 * Exit 1 if any HIGH finding, else 0.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const EXTS = new Set([".css", ".scss", ".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte"]);

/** @type {{ id: string, level: "HIGH"|"MED"|"LOW", re: RegExp, msg: string }[]} */
const RULES = [
  {
    id: "violet-indigo-gradient",
    level: "HIGH",
    re: /from-(indigo|violet|purple)-[0-9]{3}\s+to-(indigo|violet|purple)-[0-9]{3}|#667eea[\s\S]{0,40}#764ba2|#764ba2[\s\S]{0,40}#667eea/i,
    msg: "Default violet/indigo gradient pair",
  },
  {
    id: "gradient-headline",
    level: "MED",
    re: /background-clip:\s*text[\s\S]{0,80}linear-gradient|bg-clip-text/,
    msg: "Gradient-clipped headline text",
  },
  {
    id: "sparkle-glyph",
    level: "HIGH",
    re: /Sparkles|magic-?wand|✨|AI[- ]powered/i,
    msg: "Sparkle / AI badge tell",
  },
  {
    id: "fade-up-scroll",
    level: "MED",
    re: /fade[-_]?in[-_]?up|animation:\s*fadeInUp|whileInView[\s\S]{0,60}opacity:\s*0[\s\S]{0,40}y:\s*20/i,
    msg: "Uniform fade-up-on-scroll motion",
  },
  {
    id: "hover-scale-card",
    level: "MED",
    re: /hover:(scale-1\.0[0-9]|scale\[[^\]]+\])[\s\S]{0,40}(shadow|card)|:hover[\s\S]{0,40}scale\(1\.0[0-9]\)/i,
    msg: "Card hover scale(1.0x) pattern",
  },
  {
    id: "gray-card-border",
    level: "MED",
    re: /border(?:-\[1px\])?\s+border-(?:gray|slate|zinc)-[0-9]{3}\s+rounded-2xl\s+shadow-lg/i,
    msg: "Stock shadcn-style gray border + shadow card",
  },
  {
    id: "emoji-feature-icon",
    level: "MED",
    re: /(🚀|🎯|💡|⚙️|📈|🔒)\s*(<\/|>|\|)/,
    msg: "Emoji used as icon/structure",
  },
  {
    id: "gray-50-background",
    level: "LOW",
    re: /bg-gray-50\b|background:\s*#F9FAFB/i,
    msg: "Tailwind gray-50 page background (verify brand)",
  },
  {
    id: "inter-only",
    level: "LOW",
    re: /font-family:\s*Inter\b|font-\[Inter\]/i,
    msg: "Inter as typeface (confirm intentional pairing)",
  },
];

function walk(path, out = []) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      walk(join(path, name), out);
    }
  } else if (EXTS.has(extname(path).toLowerCase())) {
    out.push(path);
  }
  return out;
}

function scanFile(file) {
  const text = readFileSync(file, "utf8");
  const findings = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) {
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      findings.push({ file, line, ...rule });
    }
  }
  return findings;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node scripts/slop_lint.mjs <file-or-dir> [...]");
  process.exit(2);
}

const files = roots.flatMap((r) => walk(r));
const all = files.flatMap(scanFile);

const byLevel = { HIGH: [], MED: [], LOW: [] };
for (const f of all) byLevel[f.level].push(f);

for (const level of ["HIGH", "MED", "LOW"]) {
  for (const f of byLevel[level]) {
    console.log(`${level}\t${f.id}\t${f.file}:${f.line}\t${f.msg}`);
  }
}

const high = byLevel.HIGH.length;
console.error(`slop_lint: ${files.length} files, ${all.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
