// Rule engine: stores analysis rules and matches them against source text.
// Pure JavaScript. Written from scratch (clean-room): no code from semgrep
// or any other scanner is used here.
//
// Performance shape (research-validated):
//   1. keyword pre-filter  — content.includes() on literal fragments extracted
//      from the pattern; files that cannot match skip the regex engine entirely
//   2. one lineStarts pass per file + binary search for line/column
//   3. regex compiled ONCE at rule registration, `g` flag, lastIndex reset
//      before and after every file (a dirty lastIndex is a silent false
//      negative on the next file)

import { CONFIG } from "../config.mjs";

const SEVERITIES = new Set(["error", "warning", "info"]);

// ---------------------------------------------------------------------------
// ReDoS gate
// ---------------------------------------------------------------------------
// V8 has no regex timeout API, so pathological patterns must be rejected at
// registration time — this is the only real protection available.
function findReDoS(pattern) {
  const problems = [];

  if (pattern.length > CONFIG.maxPatternLength) {
    problems.push(`pattern exceeds ${CONFIG.maxPatternLength} characters`);
  }

  // {n,m} with a huge bound: backtracking blowup on the quantifier itself.
  for (const match of pattern.matchAll(/\{\s*(\d+)\s*(?:,\s*(\d*)\s*)?\}/g)) {
    const lo = Number(match[1]);
    const hi = match[2] === undefined || match[2] === "" ? lo : Number(match[2]);
    if (hi > 1000 || lo > 1000) problems.push(`repetition bound too large: ${match[0]}`);
  }

  // a*+ / a{2,}{3} — stacked quantifiers over the same unit.
  if (/(?:[*+?]|\{\d+,?\d*\})\s*(?:[*+]|\{\d+,?\d*\})/.test(pattern)) {
    problems.push("stacked quantifiers");
  }

  // .*.* — two overlapping dot-stars.
  if (/(?:\.\*)\s*(?:\.\*)/.test(pattern)) problems.push("overlapping dot-star");

  // (x+x+)+ — a quantified group containing a quantifier (star height > 1).
  if (hasNestedQuantifier(pattern)) problems.push("nested quantifier");

  // (?=...) followed by a quantifier.
  if (/\(\?=[^)]*\)[*+{]/.test(pattern)) problems.push("quantified lookahead");

  return problems;
}

function hasNestedQuantifier(pattern) {
  const stack = [];
  for (let i = 0; i < pattern.length; ) {
    const c = pattern[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "(") {
      stack.push({ quantified: false, innerQuant: false });
      i += 1;
      continue;
    }
    if (c === ")") {
      const group = stack.pop();
      if (group) {
        const next = pattern[i + 1];
        if (next === "*" || next === "+" || next === "{") group.quantified = true;
        if (group.innerQuant && group.quantified) return true;
        if (stack.length && (group.innerQuant || group.quantified)) {
          stack[stack.length - 1].innerQuant = true;
        }
      }
      i += 1;
      continue;
    }
    if ((c === "*" || c === "+" || c === "{") && stack.length) {
      stack[stack.length - 1].innerQuant = true;
    }
    i += 1;
  }
  return false;
}

function compileSafePattern(pattern, ruleId) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error(`Invalid params: rule "${ruleId}" has an empty pattern`);
  }
  const problems = findReDoS(pattern);
  if (problems.length > 0) {
    throw new Error(
      `Invalid params: rule "${ruleId}" pattern rejected (${problems.join("; ")})`
    );
  }
  try {
    return new RegExp(pattern, "g");
  } catch (error) {
    throw new Error(
      `Invalid params: rule "${ruleId}" pattern does not compile: ${error.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Keyword extraction (pre-filter)
// ---------------------------------------------------------------------------
// The filter is OR-semantics: run the regex if ANY keyword appears in the
// file. That is only sound if EVERY alternative of the pattern guarantees at
// least one keyword in any match — so the pattern is split on every `|`
// (class- and escape-aware) and each member must yield a literal of >= 4
// chars after stripping `[...]` classes and `\x` escapes. One member without
// a literal (e.g. `['"]\s*\+`) could match text containing no keyword at all
// — a false negative — so the whole rule runs unfiltered instead.
function splitAlternatives(pattern) {
  const members = [];
  let current = "";
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "\\") {
      current += c + (pattern[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      current += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      current += c;
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "|") {
      members.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  members.push(current);
  return members;
}

function extractKeywords(pattern) {
  const union = new Set();
  for (const member of splitAlternatives(pattern)) {
    const cleaned = member
      .replace(/\[[^\]]*\]/g, " ") // character classes are not literals
      .replace(/\\./g, " "); // escape sequences (\s, \., \b...) are not literals
    const literals = cleaned.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g);
    if (!literals || literals.length === 0) return []; // unfilterable member
    for (const literal of literals) {
      union.add(literal);
      if (union.size >= 8) return [...union];
    }
  }
  return [...union];
}

// ---------------------------------------------------------------------------
// Line/column: one pass to build line starts, binary search per match
// ---------------------------------------------------------------------------
function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLineCol(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}

export class RuleEngine {
  constructor() {
    this.rules = new Map(); // id -> rule object (compiled regex + keywords)
  }

  /** Validate + register a rule. Returns the stored rule. */
  addRule(rule) {
    if (!rule || typeof rule !== "object") {
      throw new Error("Invalid params: rule must be an object");
    }
    const id = typeof rule.id === "string" ? rule.id.trim() : "";
    if (id.length === 0 || id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      throw new Error(
        "Invalid params: rule id must match [A-Za-z0-9][A-Za-z0-9._-]* (max 128 chars)"
      );
    }
    if (typeof rule.name !== "string" || rule.name.trim().length === 0) {
      throw new Error(`Invalid params: rule "${id}" needs a name`);
    }
    if (!SEVERITIES.has(rule.severity)) {
      throw new Error(`Invalid params: rule "${id}" severity must be error|warning|info`);
    }
    if (typeof rule.description !== "string" || rule.description.trim().length === 0) {
      throw new Error(`Invalid params: rule "${id}" needs a description`);
    }
    if (this.rules.has(id)) {
      throw new Error(`Invalid params: rule already exists: ${id}`);
    }
    if (this.rules.size >= CONFIG.maxRuleCount) {
      throw new Error(`Invalid params: rule limit reached (${CONFIG.maxRuleCount})`);
    }

    const regex = compileSafePattern(rule.pattern, id);

    const languages = Array.isArray(rule.languages)
      ? rule.languages.filter((entry) => typeof entry === "string").slice(0, 50)
      : [];

    const stored = {
      id,
      name: rule.name.trim(),
      severity: rule.severity,
      description: rule.description,
      pattern: rule.pattern,
      languages,
      examples: Array.isArray(rule.examples)
        ? rule.examples.filter((entry) => typeof entry === "string").slice(0, 10)
        : [],
      regex,
      keywords: extractKeywords(rule.pattern)
    };
    this.rules.set(id, stored);
    return stored;
  }

  getRule(id) {
    return this.rules.get(id);
  }

  /** List rules, filterable by category (security|quality) and language.
   *  Engine internals (compiled regex, keywords) are never serialized. */
  listRules(params = {}) {
    const { category, language } = params || {};
    let rules = [...this.rules.values()];

    if (category === "security") {
      rules = rules.filter((rule) => rule.severity !== "info");
    } else if (category === "quality") {
      rules = rules.filter((rule) => rule.severity === "info");
    }

    if (typeof language === "string" && language.length > 0) {
      rules = rules.filter(
        (rule) => rule.languages.length === 0 || rule.languages.includes(language)
      );
    }

    return rules.map(({ regex, keywords, ...publicRule }) => publicRule);
  }

  /** Scan one file's content against every applicable rule. */
  scanContent(filePath, content, options = {}) {
    const requested = Array.isArray(options.rules) ? options.rules : null;
    const languages = Array.isArray(options.languages) ? options.languages : null;
    const findings = [];

    if (content.length === 0) return findings;
    const lineStarts = buildLineStarts(content);

    for (const rule of this.rules.values()) {
      if (requested && !requested.includes(rule.id)) continue;
      if (
        languages &&
        languages.length > 0 &&
        rule.languages.length > 0 &&
        !rule.languages.some((entry) => languages.includes(entry))
      ) {
        continue;
      }

      // Pre-filter: no keyword in the file => regex cannot match. One
      // includes() per keyword beats running the regex on every file.
      if (rule.keywords.length > 0 && !rule.keywords.some((k) => content.includes(k))) {
        continue;
      }

      // Reset BEFORE (dirty lastIndex from an earlier exception) — and the
      // shared /g instance must never leak position between files.
      rule.regex.lastIndex = 0;

      let match;
      let guard = 0;
      while ((match = rule.regex.exec(content)) !== null) {
        guard += 1;
        if (guard > 1000) break; // one rule cannot flood one file
        if (match[0].length === 0) {
          // Zero-length match would loop forever.
          rule.regex.lastIndex += 1;
          continue;
        }
        const { line, column } = offsetToLineCol(lineStarts, match.index);
        findings.push({
          rule: rule.id,
          name: rule.name,
          severity: rule.severity,
          file: filePath,
          line,
          column,
          message: rule.description,
          code: match[0].slice(0, 200)
        });
      }
      rule.regex.lastIndex = 0;
    }

    return findings;
  }

  get size() {
    return this.rules.size;
  }
}
