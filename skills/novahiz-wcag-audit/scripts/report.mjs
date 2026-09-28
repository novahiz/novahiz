#!/usr/bin/env node
/**
 * report.mjs: turn accessibility findings JSON into a markdown report on stdout.
 * Stdlib only.
 *
 * Input: a JSON file that is either an array of findings, or
 *   { "target": "...", "level": "AA", "findings": [ ... ] }
 *
 * Finding fields: sc, name?, level?, status, severity?, location?, evidence?, fix?
 * status: PASS | FAIL | PARTIAL | NT
 *
 * Usage:
 *   node report.mjs findings.json > report.md
 */

import { readFileSync } from "node:fs";

const SEVERITY_RANK = { critical: 0, major: 1, minor: 2 };
const STATUS_ORDER = ["PASS", "FAIL", "PARTIAL", "NT"];

function parsePayload(file) {
  const raw = readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  if (Array.isArray(data)) {
    return { target: "(unspecified)", level: "AA", findings: data };
  }
  if (data && Array.isArray(data.findings)) {
    return {
      target: data.target || "(unspecified)",
      level: data.level || "AA",
      findings: data.findings,
    };
  }
  throw new Error("Expected an array of findings or { findings: [...] }");
}

function tally(findings) {
  const counts = { PASS: 0, FAIL: 0, PARTIAL: 0, NT: 0 };
  for (const item of findings) {
    const key = String(item.status || "NT").toUpperCase();
    counts[Object.prototype.hasOwnProperty.call(counts, key) ? key : "NT"] += 1;
  }
  return counts;
}

function cell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function normalizeStatus(value) {
  const key = String(value || "NT").toUpperCase();
  return STATUS_ORDER.includes(key) ? key : "NT";
}

function bySeverityThenSc(a, b) {
  const ra = SEVERITY_RANK[String(a.severity || "").toLowerCase()] ?? 9;
  const rb = SEVERITY_RANK[String(b.severity || "").toLowerCase()] ?? 9;
  if (ra !== rb) return ra - rb;
  return String(a.sc || "").localeCompare(String(b.sc || ""));
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node report.mjs findings.json");
    process.exit(2);
  }

  let payload;
  try {
    payload = parsePayload(file);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }

  const { target, level, findings } = payload;
  const counts = tally(findings);
  const ordered = [...findings].sort(bySeverityThenSc);
  const lines = [];

  lines.push("# Accessibility audit report");
  lines.push("");
  lines.push(`**Target:** ${target}`);
  lines.push(`**Claim level:** WCAG 2.2 Level ${level}`);
  lines.push(`**Findings:** ${findings.length}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|--------|------:|");
  for (const status of STATUS_ORDER) {
    lines.push(`| ${status} | ${counts[status]} |`);
  }
  lines.push("");
  lines.push("## Per-criteria results");
  lines.push("");
  lines.push("| SC | Name | Level | Status | Severity | Location | Evidence | Fix |");
  lines.push("|----|------|-------|--------|----------|----------|----------|-----|");
  for (const item of ordered) {
    const status = normalizeStatus(item.status);
    lines.push(
      `| ${cell(item.sc)} | ${cell(item.name)} | ${cell(item.level)} | ${status} | ${cell(item.severity)} | ${cell(item.location)} | ${cell(item.evidence)} | ${cell(item.fix)} |`,
    );
  }
  lines.push("");

  const open = ordered.filter(
    (item) => String(item.status).toUpperCase() === "FAIL",
  );
  lines.push("## Open failures");
  lines.push("");
  if (open.length === 0) {
    lines.push("None.");
    lines.push("");
  } else {
    for (const item of open) {
      lines.push(
        `### ${cell(item.severity || "unrated")}: ${cell(item.sc)}: ${cell(item.name || "finding")}`,
      );
      lines.push("");
      lines.push(`- **Location:** ${cell(item.location)}`);
      lines.push(`- **Evidence:** ${cell(item.evidence)}`);
      lines.push(`- **Fix:** ${cell(item.fix)}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "Automated or partial coverage alone does not justify an AA claim. Confirm keyboard, focus, and contrast manually before sign-off.",
  );
  lines.push("");

  process.stdout.write(lines.join("\n"));
}

main();
