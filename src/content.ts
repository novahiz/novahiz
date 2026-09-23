export function changeText(tool: string, args: unknown): string {
  const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["newString", "new_string", "content", "patchText", "patch", "newText"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) parts.push(value);
  }
  const edits = record.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (!edit || typeof edit !== "object") continue;
      const entry = edit as Record<string, unknown>;
      for (const key of ["newString", "new_string", "content", "newText"]) {
        const value = entry[key];
        if (typeof value === "string" && value.length > 0) parts.push(value);
      }
    }
  }
  return parts.join("\n");
}

const STYLE_SIGNALS = [
  /(^|\n)\s*[.#][\w-]+(\s*[:>+~]\s*[.#\w:-]+)*\s*[,{]/,
  /className\s*=/i,
  /style\s*[=:]\s*[{"]/i,
  /styled\./,
  /\bcss`/,
  /\b(gap-\d|p[xy]?-\d|m[xy]?-\d|text-\w+-\d|bg-\w+-\d)\b/i
];

const PROSE_SIGNALS = [
  /\/\*\*?[\s\S]*?[A-Za-z][A-Za-z ,.'()-]{12,}[\s\S]*?\*\//,
  /"[^"\n]{15,}[ ][^"\n]{10,}"/,
  /'[^'\n]{15,}[ ][^'\n]{10,}'/,
  /`[^`\n]{15,}[ ][^`\n]{10,}`/,
  /(^|\n)\s{0,3}\S[^\n]*\s\S+\s[^\n]*[.!?](\s|$)/
];

// H6: the old single-line rule — any `//`/`#` comment with 12+ alpha chars —
// flagged license headers ("Copyright 2024 ..."), TODOs and linter directives
// as prose. A comment is prose only when it reads like a sentence: no code
// tokens, no directive prefix, and either ending punctuation or a long
// multi-word description.
const COMMENT_DIRECTIVE = /^\s*(\/\/|#|\*)\s*(TODO|FIXME|XXX|HACK|eslint|tslint|prettier|stylelint|c8|istanbul|@ts-|@vite-|node:|deno-lint)/i;
const CODE_TOKENS = /[=;{}()[\]=>]/;

function isProseCommentLine(line: string): boolean {
  const match = line.match(/^\s*(\/\/|#|\*)\s+(.+)$/);
  if (!match) return false;
  const body = match[2].trim();
  if (body.length === 0) return false;
  if (COMMENT_DIRECTIVE.test(line)) return false;
  if (CODE_TOKENS.test(body)) return false;
  // Complete sentence: uppercase start, ending punctuation.
  if (/^[A-Z].{15,}[.!?]$/.test(body)) return true;
  // Long multi-word description: 40+ chars, 4+ plain words.
  if (body.length >= 40) {
    const words = body.split(/\s+/).filter((word) => /^[A-Za-z][A-Za-z,.'()-]*$/.test(word));
    return words.length >= 4;
  }
  return false;
}

export function hasStyle(text: string): boolean {
  if (text.length === 0) return false;
  return STYLE_SIGNALS.some((pattern) => pattern.test(text));
}

export function hasProse(text: string): boolean {
  if (text.length === 0) return false;
  if (PROSE_SIGNALS.some((pattern) => pattern.test(text))) return true;
  return text.split(/\r?\n/).some(isProseCommentLine);
}

export function isTrivial(text: string, minChange = 0): boolean {
  if (minChange <= 0) return text.trim().length === 0;
  return text.replace(/\s+/g, " ").trim().length < minChange;
}

const PLACEHOLDER_PATTERNS = [
  /\b(TODO|FIXME|XXX|HACK)\b/,
  /\bnot implemented\b/i,
  /\bcoming soon\b/i,
  /<placeholder/i,
  /<your[_ ]code/i,
  /\blorem ipsum\b/i,
  /\.\.\.\s*rest of\b/i,
  /\bimplement me\b/i,
  /\.\.\.\s*existing\b/i
];

export function hasPlaceholder(text: string): boolean {
  if (text.length === 0) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}
