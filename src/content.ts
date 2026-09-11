export function changeText(tool: string, args: unknown): string {
  const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["newString", "new_string", "content", "patchText", "patch", "command", "newText"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) parts.push(value);
  }
  const edits = record.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (edit && typeof edit === "object") {
        const newString = (edit as Record<string, unknown>).newString;
        if (typeof newString === "string") parts.push(newString);
      }
    }
  }
  return parts.join("\n");
}

const STYLE_SIGNALS = [
  /:\s*[^;{}\n]+;/,
  /(^|\n)\s*[.#][a-z0-9_-]+\s*\{/i,
  /className\s*=/,
  /\bstyle\s*=/,
  /styled\./,
  /\bcss`/,
  /\b(tailwind|flex|grid|gap-\d|p[xy]?-\d|m[xy]?-\d|text-\w+-\d|bg-\w+-\d)\b/i
];

const PROSE_SIGNALS = [
  /(^|\n)\s*(\/\/|#|\*)\s+[A-Za-z][A-Za-z ,.'()-]{12,}/,
  /\/\*\*?[\s\S]*?[A-Za-z][A-Za-z ,.'()-]{12,}[\s\S]*?\*\//,
  /"[^"\n]{15,}[ ][^"\n]{10,}"/,
  /'[^'\n]{15,}[ ][^'\n]{10,}'/,
  /`[^`\n]{15,}[ ][^`\n]{10,}`/,
  /(^|\n)\s{0,3}\S[^\n]*\s\S+\s[^\n]*[.!?](\s|$)/
];

export function hasStyle(text: string): boolean {
  if (text.length === 0) return false;
  return STYLE_SIGNALS.some((pattern) => pattern.test(text));
}

export function hasProse(text: string): boolean {
  if (text.length === 0) return false;
  return PROSE_SIGNALS.some((pattern) => pattern.test(text));
}

export function isTrivial(text: string, minChange = 0): boolean {
  if (minChange <= 0) return text.trim().length === 0;
  return text.replace(/\s+/g, " ").trim().length < minChange;
}
