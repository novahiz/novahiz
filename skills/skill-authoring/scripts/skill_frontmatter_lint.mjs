#!/usr/bin/env node
/**
 * skill-authoring: validate SKILL.md frontmatter + body shape.
 * Usage: node scripts/skill_frontmatter_lint.mjs <path/to/SKILL.md> [...]
 * Exit 1 if any HIGH finding.
 */

import { readFileSync, existsSync } from "node:fs";

function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { ok: false };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fields[kv[1]] = v;
  }
  return { ok: true, fields, body: text.slice(m[0].length) };
}

function lint(path) {
  const out = [];
  const push = (level, id, msg) => out.push({ level, id, path, msg });
  if (!existsSync(path)) {
    push("HIGH", "missing-file", "not found");
    return out;
  }
  const text = readFileSync(path, "utf8");
  const p = parse(text);
  if (!p.ok) {
    push("HIGH", "no-frontmatter", "missing --- frontmatter block");
    return out;
  }
  const f = p.fields;
  if (!f.name) push("HIGH", "no-name", "missing name");
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.name)) push("HIGH", "name-format", "name must be lowercase kebab-case");
    if (f.name.length > 64) push("HIGH", "name-length", "name > 64 chars");
  }
  if (!f.description) push("HIGH", "no-description", "missing description");
  else {
    if (f.description.length > 1024) push("HIGH", "description-length", `description ${f.description.length} > 1024`);
    if (/[<>]/.test(f.description)) push("HIGH", "description-xml", "description contains < or >");
    if (!/use when|use for|when to use|trigger/i.test(f.description)) push("MED", "description-when", "description should say when to use it");
  }
  if (/[<>]/.test(text.replace(/^---[\s\S]*?---/, ""))) push("LOW", "body-xml", "body contains angle brackets; verify intentional");
  if (!/##/.test(p.body)) push("MED", "no-sections", "body has no ## sections");
  return out;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/skill_frontmatter_lint.mjs <SKILL.md> [...]");
  process.exit(2);
}
const all = files.flatMap(lint);
for (const level of ["HIGH", "MED", "LOW"]) {
  for (const f of all.filter((x) => x.level === level)) console.log(`${level}\t${f.id}\t${f.path}\t${f.msg}`);
}
const high = all.filter((f) => f.level === "HIGH").length;
console.error(`skill_frontmatter_lint: ${files.length} files, ${all.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
