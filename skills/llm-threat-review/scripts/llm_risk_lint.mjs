#!/usr/bin/env node
/**
 * llm-threat-review: static heuristics on prompt/tool code paths.
 * Flags high-risk patterns for human review. Not a proof of safety.
 *
 * Usage: node scripts/llm_risk_lint.mjs <file-or-dir> [...]
 * Exit 1 if any HIGH finding.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);

const RULES = [
  {
    id: "tool-shell-from-model",
    level: "HIGH",
    re: /exec(?:Sync)?\s*\(\s*(?:result|output|completion|text|message)|child_process[\s\S]{0,120}(?:result|completion|modelOutput)/i,
    msg: "Possible shell exec of model output",
  },
  {
    id: "sql-interpolate-model",
    level: "HIGH",
    re: /(?:query|execute|raw)\s*\(\s*[`'"](?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,80}(?:\$\{|output|completion|model)/i,
    msg: "Possible SQL built from model text",
  },
  {
    id: "html-inject-model",
    level: "HIGH",
    re: /innerHTML\s*=\s*(?:result|output|completion|message\.(?:content|text))|dangerouslySetInnerHTML\s*\{\s*__html:\s*(?:result|output|completion)/i,
    msg: "Model output assigned to HTML sink without visible sanitize",
  },
  {
    id: "system-prompt-secret",
    level: "HIGH",
    re: /system(?:Prompt|_prompt)?[\s\S]{0,80}(?:API_KEY|SECRET|PASSWORD|PRIVATE_KEY)\s*=/i,
    msg: "Credential-like value near system prompt (LLM07)",
  },
  {
    id: "unbounded-agent-loop",
    level: "MED",
    re: /while\s*\(\s*true\s*\)[\s\S]{0,200}(?:tool|agent|llm|openai|anthropic)/i,
    msg: "Unbounded loop around agent/tool calls (LLM10)",
  },
  {
    id: "tool-all-scope",
    level: "MED",
    re: /scope:\s*['"][\w:.*]+\s*\*/i,
    msg: "Wildcard scope on credential or tool",
  },
  {
    id: "fetch-untrusted-url",
    level: "MED",
    re: /fetch\s*\(\s*(?:url|href|link|inputUrl)\b/i,
    msg: "Fetch of caller-controlled URL; check SSRF allowlist",
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
  console.error("usage: node scripts/llm_risk_lint.mjs <file-or-dir> [...]");
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
console.error(`llm_risk_lint: ${files.length} files, ${all.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
