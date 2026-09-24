#!/usr/bin/env node
/**
 * secrets-hygiene: high-signal secret patterns on staged/tracked text files.
 * Offline regex pass. Not a substitute for gitleaks/TruffleHog in CI.
 *
 * Usage: node scripts/secret_scan.mjs <file-or-dir> [...]
 * Exit 1 if any HIGH finding.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const EXTS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".php", ".cs", ".sh", ".bash", ".zsh", ".env", ".yml",
  ".yaml", ".json", ".toml", ".ini", ".cfg", ".conf", ".properties", ".tf",
  ".md", ".txt", ".xml", ".html", ".css",
]);

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "target", ".next", "coverage"]);

const RULES = [
  {
    id: "aws-access-key-id",
    level: "HIGH",
    re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    msg: "AWS access key id",
  },
  {
    id: "github-pat",
    level: "HIGH",
    re: /\bghp_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    msg: "GitHub token",
  },
  {
    id: "slack-token",
    level: "HIGH",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    msg: "Slack token",
  },
  {
    id: "private-key-block",
    level: "HIGH",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    msg: "PEM private key block",
  },
  {
    id: "generic-assign-secret",
    level: "MED",
    re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
    msg: "Hardcoded secret-like assignment",
  },
  {
    id: "jwt-compact",
    level: "MED",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    msg: "JWT-looking string",
  },
];

const ALLOW_SUBSTR = ["EXAMPLE", "example", "placeholder", "YOUR_", "xxxx", "dummy", "sample", "REPLACE"];

function walk(path, out = []) {
  const st = statSync(path);
  if (st.isDirectory()) {
    if (IGNORE_DIRS.has(basename(path))) return out;
    for (const name of readdirSync(path)) walk(join(path, name), out);
  } else if (EXTS.has(extname(path).toLowerCase()) || basename(path).startsWith(".env")) {
    out.push(path);
  }
  return out;
}

function scanFile(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const findings = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    let m;
    const seen = new Set();
    while ((m = re.exec(text)) !== null) {
      const match = m[0];
      if (ALLOW_SUBSTR.some((a) => match.includes(a))) continue;
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      const key = `${rule.id}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ file, line, ...rule });
      if (findings.length > 50) break;
    }
    if (findings.length > 50) break;
  }
  return findings;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node scripts/secret_scan.mjs <file-or-dir> [...]");
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
console.error(`secret_scan: ${files.length} files, ${all.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
