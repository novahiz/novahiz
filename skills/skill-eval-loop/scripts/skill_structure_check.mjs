#!/usr/bin/env node
/**
 * skill-eval-loop: structural + routing checks for a SKILL.md before eval runs.
 * Validates frontmatter shape and prints a prompt-set template if missing.
 *
 * Usage: node scripts/skill_structure_check.mjs <path/to/SKILL.md> [prompts.csv]
 * Exit 1 on structural HIGH failures.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { ok: false, error: "missing YAML frontmatter --- block" };
  const body = m[1];
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    fields[kv[1]] = v;
  }
  return { ok: true, fields, bodyStart: m[0].length };
}

const TEMPLATE = `id,prompt,expect_trigger,must_steps,must_not
t1,"Primary request that should load the skill",yes,"",
t2,"Paraphrase of the same intent",yes,"",
t3,"Nearby topic that must NOT trigger",no,"",
t4,"Edge case discovered in manual testing",yes,"",
`;

const skillPath = process.argv[2];
if (!skillPath) {
  console.error("usage: node scripts/skill_structure_check.mjs <path/to/SKILL.md> [prompts.csv]");
  process.exit(2);
}
if (!existsSync(skillPath)) {
  console.error(`missing: ${skillPath}`);
  process.exit(1);
}

const text = readFileSync(skillPath, "utf8");
const findings = [];
const push = (level, id, msg) => findings.push({ level, id, msg });

const fm = parseFrontmatter(text);
if (!fm.ok) {
  push("HIGH", "no-frontmatter", fm.error);
} else {
  const f = fm.fields;
  const dir = basename(dirname(skillPath));
  if (!f.name) push("HIGH", "no-name", "frontmatter missing name");
  else {
    if (f.name !== dir) push("HIGH", "name-dir-mismatch", `name "${f.name}" != folder "${dir}"`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.name)) push("HIGH", "name-format", "name must be lowercase kebab");
    if (f.name.length > 64) push("HIGH", "name-length", "name > 64 chars");
  }
  if (!f.description) push("HIGH", "no-description", "frontmatter missing description");
  else {
    if (f.description.length > 1024) push("HIGH", "description-length", `description ${f.description.length} > 1024`);
    if (/[<>]/.test(f.description)) push("HIGH", "description-xml", "description contains < or >");
    if (!/use when|when |trigger|for /i.test(f.description)) {
      push("MED", "description-when", "description should say when to use it");
    }
    if (/^(helps with|does stuff)/i.test(f.description.trim())) {
      push("HIGH", "description-vague", "description too vague to route");
    }
  }
}

const body = text.slice(fm.bodyStart || 0);
const lines = text.split(/\r?\n/).length;
if (lines > 500) push("MED", "long-skill", `SKILL.md is ${lines} lines; move detail to references/`);
if (/\n##\s+(Sources|Quellen)/i.test("\n" + body) === false && !/## Sources/i.test(body)) {
  // soft only: many skills include Sources
}
if (!/##/.test(body)) push("MED", "no-sections", "body has no ## sections; hard to scan");

const promptsArg = process.argv[3];
if (promptsArg && !existsSync(promptsArg)) {
  writeFileSync(promptsArg, TEMPLATE, "utf8");
  console.error(`created prompt template: ${promptsArg}`);
}

for (const level of ["HIGH", "MED", "LOW"]) {
  for (const f of findings.filter((x) => x.level === level)) {
    console.log(`${level}\t${f.id}\t${f.msg}`);
  }
}
const high = findings.filter((f) => f.level === "HIGH").length;
console.error(`skill_structure_check: ${findings.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
