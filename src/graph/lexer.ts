// Lexer for the hand-rolled TS/TSX/JS extractor behind `novahiz graph`.
//
// Contract: MASKING. String literals, template-literal text, comments and
// regex literals never produce `ident` tokens, so symbols, call sites and
// identifier occurrences collected downstream are automatically free of the
// false positives grep-style tools pick up (a word inside a comment, a quote
// inside JSX prose, a pattern inside a regex).
//
// This is not a parser: it emits a flat token stream with positions and
// leaves structure (scopes, declarations) to the extractor. It is resilient
// by design — unterminated strings stop at the newline, an unterminated
// regex falls back to a division operator — so one odd construct degrades
// locally instead of derailing the file.

export type TokenKind =
  | "ident"
  | "keyword"
  | "punct"
  | "string"
  | "regex"
  | "number"
  | "template";

export interface Token {
  kind: TokenKind;
  value: string; // raw text; for `string` it includes the quotes
  start: number; // offset of the first character
  end: number; // offset one past the last character
  line: number; // 0-based
  col: number; // 0-based
  nlBefore: boolean; // a newline (or a multi-line comment) precedes this token
}

const KEYWORDS = new Set([
  "abstract", "as", "async", "await", "break", "case", "catch", "class", "const",
  "continue", "debugger", "declare", "default", "delete", "do", "else", "enum",
  "export", "extends", "false", "finally", "for", "from", "function", "get", "if",
  "implements", "import", "in", "instanceof", "interface", "let", "module",
  "namespace", "new", "null", "override", "private", "protected", "public",
  "readonly", "return", "set", "static", "super", "switch", "this", "throw",
  "true", "try", "type", "typeof", "undefined", "var", "void", "while", "with",
  "yield",
]);

// After these keywords a `/` starts a regex (`return /re/.test(x)`); after any
// other keyword — `this / 2`, `true / 2` — it is division.
const REGEX_OK_KEYWORDS = new Set([
  "return", "typeof", "void", "delete", "new", "in", "of", "instanceof", "case",
  "do", "else", "yield", "await", "throw",
]);

// Longest first: the scan tries them in order and takes the first match.
const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=",
  "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
];

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;

const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/**
 * Tokenize `source` into a flat stream. A `/` is treated as a regex when the
 * previous significant token allows one (start of input, an opening punctuator,
 * a value-introducing keyword); otherwise it is division. A candidate regex
 * that hits a raw newline before its closing `/` is re-scanned as division —
 * the classic heuristic, safe for both division-heavy and regex-heavy code.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  let line = 0;
  let lineStart = 0;
  let nlPending = false;
  let prev: Token | undefined;
  // Template handling: mode tracks whether we are in the plain text of a
  // template literal or in code; exprMarkers holds the brace depth at which
  // each `${ ... }` expression started, so a `}` that closes the expression
  // returns to template text (and is not emitted) while braces inside the
  // expression are lexed normally — calls inside `${}` are first-class.
  let mode: "code" | "template" = "code";
  let braceDepth = 0;
  const exprMarkers: number[] = [];

  const push = (kind: TokenKind, value: string, start: number, end: number): void => {
    prev = { kind, value, start, end, line, col: start - lineStart, nlBefore: nlPending };
    tokens.push(prev);
    nlPending = false;
  };

  const regexAllowed = (): boolean => {
    if (!prev) return true;
    if (prev.kind === "punct") {
      return prev.value !== ")" && prev.value !== "]" && prev.value !== "}" &&
        prev.value !== "++" && prev.value !== "--";
    }
    if (prev.kind === "keyword") return REGEX_OK_KEYWORDS.has(prev.value);
    return false; // ident, number, string, regex, template → division
  };

  while (i < n) {
    const c = source[i];

    if (c === "\n") {
      i++;
      line++;
      lineStart = i;
      nlPending = true;
      continue;
    }

    if (mode === "template") {
      // Plain text of a template literal: masked, only structure matters.
      if (c === "`") {
        i++;
        mode = "code";
        continue;
      }
      if (c === "$" && source[i + 1] === "{") {
        exprMarkers.push(braceDepth);
        i += 2;
        mode = "code";
        continue;
      }
      if (c === "\\") {
        i++; // skip the backslash; an escaped newline falls through to the
        if (i < n && source[i] !== "\n") i++; // newline check above
        continue;
      }
      i++;
      continue;
    }

    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === "\u00A0") {
      i++;
      continue;
    }

    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && source[i + 1] === "*") {
      let crossed = false;
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") {
          crossed = true;
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      i = Math.min(n, i + 2);
      if (crossed) nlPending = true;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        const ch = source[i];
        if (ch === "\n") break; // unterminated: stop at the line end
        if (ch === "\\") {
          if (source[i + 1] === "\n") break; // line continuation: let the
          i += 2; // newline branch count it
          continue;
        }
        i++;
        if (ch === quote) {
          closed = true;
          break;
        }
      }
      if (!closed && i < n && source[i] === "\n") {
        // stop before the newline; the loop above handles it
      }
      push("string", source.slice(start, i), start, i);
      continue;
    }

    if (c === "`") {
      i++;
      mode = "template";
      continue;
    }

    if (c === "/" && regexAllowed()) {
      const start = i;
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const ch = source[j];
        if (ch === "\n") break;
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) {
          j++;
          while (j < n && IDENT_PART.test(source[j])) j++; // flags
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        push("regex", source.slice(start, j), start, j);
        i = j;
        continue;
      }
      // No closing `/` on this line: it was division after all.
      push("punct", "/", i, i + 1);
      i++;
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(source[i + 1] ?? ""))) {
      const start = i;
      i++;
      while (i < n) {
        const ch = source[i];
        if (IDENT_PART.test(ch)) {
          i++;
          continue;
        }
        if (ch === "." && !source[i + 1]?.includes(".")) {
          i++;
          continue;
        }
        if ((ch === "+" || ch === "-") && (source[i - 1] === "e" || source[i - 1] === "E")) {
          i++;
          continue;
        }
        break;
      }
      push("number", source.slice(start, i), start, i);
      continue;
    }

    if (IDENT_START.test(c)) {
      const start = i;
      i++;
      while (i < n && IDENT_PART.test(source[i])) i++;
      const value = source.slice(start, i);
      push(KEYWORDS.has(value) ? "keyword" : "ident", value, start, i);
      continue;
    }

    if (c === "}" && exprMarkers.length > 0 && braceDepth === exprMarkers[exprMarkers.length - 1]) {
      // Closing `${ ... }`: back to template text, the `}` is template syntax.
      exprMarkers.pop();
      mode = "template";
      i++;
      continue;
    }

    let matched = "";
    for (const p of PUNCTUATORS) {
      if (source.startsWith(p, i)) {
        matched = p;
        break;
      }
    }
    if (matched === "") matched = c;
    push("punct", matched, i, i + matched.length);
    if (matched === "{") braceDepth++;
    else if (matched === "}") braceDepth = Math.max(0, braceDepth - 1);
    i += matched.length;
  }

  return tokens;
}
