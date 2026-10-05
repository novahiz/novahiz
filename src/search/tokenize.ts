// Identifier splitting shared by the index side and the query side of
// Lodestone's full-text search. FTS5's unicode61 tokenizer reads
// `getUserById` as a single token, so a query for `userById` would never
// match it: index time appends the split pieces to a shadow column, query
// time rebuilds the same pieces as an OR/AND branch. Every term is wrapped
// in quotes so user input can never reach the MATCH parser as syntax.

/** Split one alphanumeric chunk at camelCase and letter/digit boundaries. */
function splitCamel(word: string): string[] {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .split(" ")
    .filter((part) => part.length > 0);
}

/** Every identifier piece of a line, camel-split, order preserved. */
export function splitIdentifier(raw: string): string[] {
  const out: string[] = [];
  for (const chunk of raw.split(/[^A-Za-z0-9]+/)) {
    if (chunk.length > 0) out.push(...splitCamel(chunk));
  }
  return out;
}

const MAX_LINE = 1000;
const MAX_SUB_TOKENS = 100;

/**
 * Shadow-column content for one line: only the pieces a plain tokenizer
 * cannot see (`getUserById` -> `get user by id`). Words that were already
 * separate tokens add nothing, so they are skipped.
 */
export function expandLine(line: string): string {
  const source = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of source.split(/[^A-Za-z0-9]+/)) {
    if (chunk.length < 3) continue;
    const parts = splitCamel(chunk);
    if (parts.length < 2) continue;
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
      if (out.length >= MAX_SUB_TOKENS) return out.join(" ");
    }
  }
  return out.join(" ");
}

export interface MatchQuery {
  /** Ready-to-use FTS5 MATCH expression, all terms quoted. */
  expr: string;
  /** Sanitized terms, in order (used by the LIKE fallback and reporting). */
  terms: string[];
  /** The operator the expression joins the terms with. */
  op: "AND" | "OR";
}

const MAX_TERMS = 12;
const MAX_TERM_LEN = 64;

/**
 * Build a safe FTS5 MATCH expression. A term that is one concatenated chunk
 * with visible camel humps (`getUserById`) expands to
 * `("getUserById" OR ("get" AND "user" AND "by" AND "id"))` — the quoted
 * branch hits the raw token, the second hits the shadow column.
 * Returns null when the query carries no letter or digit.
 */
export function buildMatchQuery(
  raw: string,
  opts: { prefix?: boolean; op?: "AND" | "OR" } = {}
): MatchQuery | null {
  const op: "AND" | "OR" = opts.op === "OR" ? "OR" : "AND";
  const terms: string[] = [];
  for (const piece of String(raw ?? "").split(/\s+/)) {
    // A double quote is the only character that could escape the quoting
    // below; dropping it keeps the expression structural, not literal.
    const clean = piece.replace(/"/g, "").slice(0, MAX_TERM_LEN);
    if (clean.length === 0) continue;
    if (!/[A-Za-z0-9]/.test(clean)) continue;
    terms.push(clean);
    if (terms.length >= MAX_TERMS) break;
  }
  if (terms.length === 0) return null;

  const groups = terms.map((term, index) => {
    let quoted = `"${term}"`;
    if (opts.prefix === true && index === terms.length - 1) quoted = `${quoted}*`;
    const flat = term.replace(/[^A-Za-z0-9]/g, "");
    // Expansion only for a single concatenated chunk: underscore and path
    // separators are already token boundaries for unicode61, and splitting
    // them further would loosen a phrase match into a cross-word match.
    const parts = flat.length >= 3 ? splitCamel(flat) : [];
    if (parts.length < 2) return quoted;
    const branch = parts.map((part) => `"${part}"`).join(" AND ");
    return `(${quoted} OR (${branch}))`;
  });

  return { expr: groups.join(` ${op} `), terms, op };
}
