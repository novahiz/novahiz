#!/usr/bin/env node
/**
 * browser-session: preflight check that MCP browser rules are respected in a run log.
 * Input: JSON array of steps [{tool, url?, note?}...]
 * Flags violations: manual chrome/chromium launch, user-data-dir override, ephemeral context.
 *
 * Usage: node scripts/browser_session_preflight.mjs <run.json>
 * Exit 1 on HIGH violation.
 */

import { readFileSync, existsSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/browser_session_preflight.mjs <run.json>');
  process.exit(2);
}
if (!existsSync(path)) {
  console.error(`missing: ${path}`);
  process.exit(1);
}

let steps;
try {
  steps = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`HIGH\tinvalid-json\t${e.message}`);
  process.exit(1);
}
if (!Array.isArray(steps)) {
  console.error("HIGH\tnot-array\troot must be an array of steps");
  process.exit(1);
}

const findings = [];
const push = (level, id, msg, i) => findings.push({ level, id, msg, i });

steps.forEach((step, i) => {
  const tool = String(step.tool || "");
  const blob = JSON.stringify(step).toLowerCase();

  if (/chrome|chromium/.test(blob) && !/msedge|edge/.test(blob)) {
    push("HIGH", "forbidden-browser", `step ${i}: chrome/chromium reference`, i);
  }
  if (/user-data-dir/.test(blob) && !/playwright-profile/.test(blob)) {
    push("HIGH", "profile-override", `step ${i}: user-data-dir override or foreign profile`, i);
  }
  if (/newcontext|ephemeral|incognito/.test(blob)) {
    push("HIGH", "ephemeral-context", `step ${i}: ephemeral context would drop login state`, i);
  }
  if (/rmdir|rimraf|remove.*profile|purge/.test(blob)) {
    push("HIGH", "profile-purge", `step ${i}: profile purge requires explicit user consent`, i);
  }
  if (tool && !tool.startsWith("playwright_browser_")) {
    push("MED", "non-mcp-tool", `step ${i}: tool ${tool} is outside playwright_browser_*`, i);
  }
  if (tool === "playwright_browser_type" || tool === "playwright_browser_fill_form") {
    if (blob.includes("password") && blob.includes("value")) {
      push("MED", "credential-in-log", `step ${i}: looks like a stored credential in the step payload`, i);
    }
  }
  if (tool === "playwright_browser_navigate" && !step.url) {
    push("HIGH", "navigate-no-url", `step ${i}: navigate without url`, i);
  }
});

for (const level of ["HIGH", "MED", "LOW"]) {
  for (const f of findings.filter((x) => x.level === level)) {
    console.log(`${level}\t${f.id}\t${f.msg}`);
  }
}
const high = findings.filter((f) => f.level === "HIGH").length;
console.error(`browser_session_preflight: ${steps.length} steps, ${findings.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
