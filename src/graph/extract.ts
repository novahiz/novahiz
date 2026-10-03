// Structural extractor for `novahiz graph`: one source file in, one compact
// FileIndex out (symbols, imports, exports, call sites, identifier
// occurrences). Hand-rolled on purpose — zero dependencies, deterministic,
// and mask-aware: identifier occurrences come from the lexer's token stream,
// never from strings, comments, template text or regex literals.
//
// What it is NOT: a parser. There is no AST and no type inference:
// declarations are recognized by statement-position patterns plus balanced
// scanning. Precision rules and their limits are documented in docs/GRAPH.md.

import { tokenize, type Token } from "./lexer.ts";

export type SymbolKind =
  | "function"
  | "method"
  | "constructor"
  | "getter"
  | "setter"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "namespace"
  | "heading";

export interface GraphSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based first line of the declaration (modifiers included). */
  line: number;
  /** 1-based last line: end of the body, or of the signature when there is none. */
  endLine: number;
  /** Whitespace-collapsed text of the declaration, body excluded. */
  signature: string;
  exported: boolean;
  /** Nearest named enclosing scope (class, function, namespace); null at module level. */
  enclosing: string | null;
  modifiers: string[];
  heritage: string[];
}

export interface CallSite {
  name: string;
  /** Dotted chain such as `db.query`, or null for a bare call. */
  chain: string | null;
  line: number;
  col: number;
  /** Nearest named enclosing scope at the call site; null at module level. */
  enclosing: string | null;
  newCall: boolean;
}

export interface ImportBinding {
  local: string;
  /** Imported name: "default", "*", or the exported name. */
  imported: string;
  typeOnly: boolean;
}

export interface ImportEdge {
  raw: string;
  bindings: ImportBinding[];
  line: number;
  dynamic: boolean;
}

export interface FileIndex {
  path: string;
  kind: "code" | "markdown";
  lines: number;
  symbols: GraphSymbol[];
  imports: ImportEdge[];
  exports: string[];
  calls: CallSite[];
  /** String table for `idents` (deduped, encounter order). */
  identNames: string[];
  /** [nameIdx, line, col] triples, 1-based positions, token order. */
  idents: Array<[number, number, number]>;
}

interface Scope {
  kind: "module" | "class" | "namespace" | "interface" | "function" | "block";
  name: string | null;
}

interface DeclResult {
  symbols?: GraphSymbol[];
  imports?: ImportEdge[];
  exportNames?: string[];
  /** Token index of the body-opening brace, to bind `scope`. */
  bodyOpen?: number;
  scope?: Scope;
  declNameIdxs?: number[];
}

interface FnScan {
  bodyOpen: number | null;
  endIdx: number;
  arrow: boolean;
}

// Keywords that cannot occupy a name position (everything else in the
// lexer's keyword set — type, get, set, from, as, static… — is contextual
// and valid as a name: `const type = …`, `obj.type()`, `static() {}`).
const RESERVED_NAMES = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for",
  "function", "if", "implements", "import", "in", "instanceof", "interface",
  "new", "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield", "await",
]);

// Tokens that can never be the callee of a call site (`if (…)`, `function (`,
// `typeof (…)`); contextual keywords like get/set/type/from stay callable.
const CALL_SKIP = new Set([
  "if", "for", "while", "switch", "catch", "do", "else", "try", "finally",
  "return", "typeof", "instanceof", "void", "delete", "new", "in", "of",
  "await", "yield", "throw", "function", "class", "case", "break", "continue",
  "debugger", "import", "export", "default", "this",
]);

// Keywords that can begin a statement — used as the ASI guard in every
// bounded scan, so a semicolon-less declaration after a value stops the scan
// instead of running to the end of the file. The guard only fires on a
// token that follows a newline and is not the scan's first token.
const DECL_STARTS = new Set([
  "export", "import", "const", "let", "var", "function", "class", "interface",
  "type", "enum", "namespace", "module", "declare", "async", "abstract",
  "default", "return", "throw", "break", "continue", "case", "if", "for",
  "while", "switch", "try", "do", "else", "new", "await",
]);

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
const unquote = (s: string): string => (s.length >= 2 ? s.slice(1, -1) : s);

const countLines = (source: string): number => {
  let n = 1;
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) n++;
  return n;
};

const buildBraceMatch = (tokens: Token[]): Map<number, number> => {
  const stack: number[] = [];
  const map = new Map<number, number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "punct") continue;
    if (t.value === "{") stack.push(i);
    else if (t.value === "}") {
      const s = stack.pop();
      if (s !== undefined) map.set(s, i);
    }
  }
  return map;
};

const isNameTok = (t: Token | undefined): boolean => {
  if (!t) return false;
  if (t.kind === "ident") return true;
  if (t.kind === "keyword") return !RESERVED_NAMES.has(t.value);
  return false;
};

export function extractFile(path: string, source: string): FileIndex {
  const tokens = tokenize(source);
  const lines = countLines(source);
  const braceMatch = buildBraceMatch(tokens);

  const symbols: GraphSymbol[] = [];
  const imports: ImportEdge[] = [];
  const exportNames: string[] = [];
  const calls: CallSite[] = [];
  const identNames: string[] = [];
  const idents: Array<[number, number, number]> = [];
  const identIdx = new Map<string, number>();

  const scopeStack: Scope[] = [{ kind: "module", name: null }];
  const scopeAt = new Map<number, Scope>();
  const declNames = new Set<number>();

  const enclosingName = (): string | null => {
    for (let k = scopeStack.length - 1; k >= 1; k--) {
      const nm = scopeStack[k].name;
      if (nm) return nm;
    }
    return null;
  };

  const statementStart = (i: number): boolean => {
    if (i === 0) return true;
    const p = tokens[i - 1];
    if (p.value === ";" || p.value === "{" || p.value === "}") return true;
    const t = tokens[i];
    return t.nlBefore && (
      p.kind === "number" || p.kind === "string" || p.kind === "ident" ||
      p.value === ")" || p.value === "]" || p.value === "true" ||
      p.value === "false" || p.value === "null" || p.value === "undefined" ||
      p.value === "this" || p.value === "super"
    );
  };

  const sigText = (stmtStart: number, bodyOpen: number | null, endIdx: number): string => {
    const start = tokens[stmtStart].start;
    const end = bodyOpen !== null
      ? tokens[bodyOpen].start
      : tokens[Math.max(stmtStart, endIdx)].end;
    let text = collapse(source.slice(start, end));
    if (bodyOpen === null && text.endsWith(";")) text = text.slice(0, -1).trim();
    return text;
  };

  const makeSymbol = (
    kind: SymbolKind,
    name: string,
    stmtStart: number,
    bodyOpen: number | null,
    endIdx: number,
    exported: boolean,
    modifiers: string[],
    heritage: string[],
  ): GraphSymbol => {
    const endLine = bodyOpen !== null
      ? tokens[braceMatch.get(bodyOpen) ?? bodyOpen].line + 1
      : tokens[Math.max(stmtStart, endIdx)].line + 1;
    return {
      name,
      kind,
      line: tokens[stmtStart].line + 1,
      endLine,
      signature: sigText(stmtStart, bodyOpen, endIdx),
      exported,
      enclosing: enclosingName(),
      modifiers,
      heritage,
    };
  };

  /** Scan a `< … >` type-argument group starting at `from` (a `<` token). */
  const scanAngle = (from: number): number => {
    let depth = 0;
    for (let p = from; p < tokens.length; p++) {
      const v = tokens[p].value;
      if (v === "<") depth++;
      else if (v === ">" || v === ">>" || v === ">>>") {
        depth -= v === ">" ? 1 : v === ">>" ? 2 : 3;
        if (depth <= 0) return p;
      } else if (v === ";" || v === "}") return -1;
    }
    return -1;
  };

  /** Match a balanced `(...)` group starting at `from` (a `(` token). */
  const matchParen = (from: number): number => {
    let d = 0;
    for (let p = from; p < tokens.length; p++) {
      const v = tokens[p].value;
      if (v === "(") d++;
      else if (v === ")") {
        d--;
        if (d === 0) return p;
      }
    }
    return -1;
  };

  /**
   * Find the signature's body-opening `{`, or the signature's end when the
   * declaration has no body (declare/overload/ASI). `typeContext` is true
   * between a parameter list and the body (type territory, angles tracked)
   * and false after `=>` (value territory, angles would misread `a < b`).
   */
  const scanToBody = (from: number, typeContext: boolean): { bodyOpen: number | null; endIdx: number } => {
    let paren = 0;
    let bracket = 0;
    let angle = 0;
    for (let p = from; p < tokens.length; p++) {
      const t = tokens[p];
      if (t.kind === "punct") {
        const v = t.value;
        if (v === "(") paren++;
        else if (v === ")") { if (paren > 0) paren--; }
        else if (v === "[") bracket++;
        else if (v === "]") { if (bracket > 0) bracket--; }
        else if (typeContext && v === "<") angle++;
        else if (typeContext && v === ">") { if (angle > 0) angle--; }
        else if (typeContext && v === ">>") angle = Math.max(0, angle - 2);
        else if (typeContext && v === ">>>") angle = Math.max(0, angle - 3);
        else if (v === ";") {
          if (paren === 0 && bracket === 0 && angle === 0) return { bodyOpen: null, endIdx: p };
        } else if (v === "{") {
          const prevV = p > 0 ? tokens[p - 1].value : "";
          if (paren === 0 && bracket === 0 && angle === 0 && prevV !== ":") {
            return { bodyOpen: p, endIdx: p };
          }
          // Type literal: skip its balanced braces and keep looking.
          let d = 0;
          while (p < tokens.length) {
            const vv = tokens[p].value;
            if (vv === "{") d++;
            else if (vv === "}") {
              d--;
              if (d === 0) break;
            }
            p++;
          }
          if (p >= tokens.length) return { bodyOpen: null, endIdx: tokens.length - 1 };
        } else if (v === "}") {
          if (paren === 0 && bracket === 0 && angle === 0) {
            return { bodyOpen: null, endIdx: Math.max(from, p - 1) };
          }
        }
      }
      if (t.nlBefore && paren === 0 && bracket === 0 && angle === 0 && p > from && DECL_STARTS.has(t.value)) {
        return { bodyOpen: null, endIdx: p - 1 };
      }
    }
    return { bodyOpen: null, endIdx: tokens.length - 1 };
  };

  /**
   * After `)` in a return-type position: find the `=>` that ends the type.
   * Returns its index, or -1 when the type is followed by anything else
   * (no initializer, ASI, end of the enclosing block).
   */
  const findArrowAtDepth0 = (from: number): number => {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    let angle = 0;
    for (let p = from; p < tokens.length; p++) {
      const t = tokens[p];
      if (t.kind === "punct") {
        const v = t.value;
        if (v === "=>") {
          if (paren === 0 && bracket === 0 && brace === 0 && angle === 0) return p;
        } else if (v === "(") paren++;
        else if (v === ")") { if (paren > 0) paren--; }
        else if (v === "[") bracket++;
        else if (v === "]") { if (bracket > 0) bracket--; }
        else if (v === "{") brace++;
        else if (v === "}") {
          if (brace === 0 && paren === 0 && bracket === 0 && angle === 0) return -1;
          if (brace > 0) brace--;
        } else if (v === "<") angle++;
        else if (v === ">") { if (angle > 0) angle--; }
        else if (v === ">>") angle = Math.max(0, angle - 2);
        else if (v === ">>>") angle = Math.max(0, angle - 3);
        else if (v === ";") {
          if (paren === 0 && bracket === 0 && brace === 0 && angle === 0) return -1;
        }
      }
      if (t.nlBefore && paren === 0 && bracket === 0 && brace === 0 && angle === 0 && p > from && DECL_STARTS.has(t.value)) {
        return -1;
      }
    }
    return -1;
  };

  /**
   * Scan a type annotation (`: TYPE`) starting after the colon. Stops at the
   * depth-0 `=`, `,` or `;`, at the enclosing block's `}`, or at the ASI
   * guard. Returns the terminator's token index (or tokens.length at EOF).
   */
  const scanTypeEnd = (from: number): number => {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    let angle = 0;
    for (let p = from; p < tokens.length; p++) {
      const t = tokens[p];
      if (t.kind === "punct") {
        const v = t.value;
        if (v === "(") paren++;
        else if (v === ")") { if (paren > 0) paren--; }
        else if (v === "[") bracket++;
        else if (v === "]") { if (bracket > 0) bracket--; }
        else if (v === "{") brace++;
        else if (v === "}") {
          if (brace === 0 && paren === 0 && bracket === 0 && angle === 0) return p;
          if (brace > 0) brace--;
        } else if (v === "<") angle++;
        else if (v === ">") { if (angle > 0) angle--; }
        else if (v === ">>") angle = Math.max(0, angle - 2);
        else if (v === ">>>") angle = Math.max(0, angle - 3);
        else if ((v === "=" || v === "," || v === ";") && paren === 0 && bracket === 0 && brace === 0 && angle === 0) {
          return p;
        }
      }
      if (t.nlBefore && paren === 0 && bracket === 0 && brace === 0 && angle === 0 && p > from && DECL_STARTS.has(t.value)) {
        return p;
      }
    }
    return tokens.length;
  };

  /**
   * Scan a value (an initializer) to its terminator: depth-0 `,` or `;`,
   * the enclosing block's `}`, or the ASI guard. Angles are NOT tracked here
   * (`a < b` is a comparison, `foo<A, B>()` accepts the local truncation).
   */
  const scanToDeclaratorEnd = (from: number): { term: number; last: number } => {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    for (let p = from; p < tokens.length; p++) {
      const t = tokens[p];
      if (t.kind === "punct") {
        const v = t.value;
        if (v === "(") paren++;
        else if (v === ")") { if (paren > 0) paren--; }
        else if (v === "[") bracket++;
        else if (v === "]") { if (bracket > 0) bracket--; }
        else if (v === "{") brace++;
        else if (v === "}") {
          if (brace === 0 && paren === 0 && bracket === 0) return { term: p, last: Math.max(from - 1, p - 1) };
          if (brace > 0) brace--;
        } else if ((v === "," || v === ";") && paren === 0 && bracket === 0 && brace === 0) {
          return { term: p, last: Math.max(from - 1, p - 1) };
        }
      }
      if (t.nlBefore && paren === 0 && bracket === 0 && brace === 0 && p > from && DECL_STARTS.has(t.value)) {
        return { term: p, last: p - 1 };
      }
    }
    return { term: tokens.length, last: tokens.length - 1 };
  };

  /**
   * Decide whether the value starting at `start` is a function (arrow or
   * function expression), and if so where its body/signature ends. Bounded by
   * the return-type scan and by scanToBody — a non-function returns null
   * quickly.
   */
  const detectFnAfter = (start: number): FnScan | null => {
    let k = start;
    if (tokens[k]?.value === "async") k++;
    if (tokens[k]?.value === "<") {
      const e = scanAngle(k);
      if (e < 0) return null;
      k = e + 1;
    }
    if (tokens[k]?.value === "(") {
      const close = matchParen(k);
      if (close < 0) return null;
      k = close + 1;
      if (tokens[k]?.value === ":") {
        const arrowIdx = findArrowAtDepth0(k + 1);
        if (arrowIdx < 0) return null;
        k = arrowIdx + 1;
      } else if (tokens[k]?.value === "=>") {
        k++;
      } else {
        return null;
      }
      const body = scanToBody(k, false);
      return { bodyOpen: body.bodyOpen, endIdx: body.endIdx, arrow: true };
    }
    if (tokens[k]?.value === "function") {
      let p = k + 1;
      if (tokens[p]?.value === "*") p++;
      if (isNameTok(tokens[p])) p++;
      if (tokens[p]?.value === "<") {
        const e = scanAngle(p);
        if (e < 0) return null;
        p = e + 1;
      }
      if (tokens[p]?.value !== "(") return null;
      const close = matchParen(p);
      if (close < 0) return null;
      const body = scanToBody(close + 1, true);
      return { bodyOpen: body.bodyOpen, endIdx: body.endIdx, arrow: false };
    }
    if (isNameTok(tokens[k]) && tokens[k + 1]?.value === "=>") {
      const body = scanToBody(k + 2, false);
      return { bodyOpen: body.bodyOpen, endIdx: body.endIdx, arrow: true };
    }
    return null;
  };

  // ---------------------------------------------------------------- matchers

  const matchImport = (i: number): DeclResult | null => {
    const t1 = tokens[i + 1];
    if (!t1) return null;
    const line = tokens[i].line + 1;
    if (t1.kind === "string") {
      return { imports: [{ raw: unquote(t1.value), bindings: [], line, dynamic: false }] };
    }
    if (t1.value === "(") {
      if (tokens[i + 2]?.kind !== "string") return null;
      return { imports: [{ raw: unquote(tokens[i + 2].value), bindings: [], line, dynamic: true }] };
    }
    let k = i + 1;
    let typeOnly = false;
    if (tokens[k].value === "type" && (
      tokens[k + 1]?.kind === "ident" || tokens[k + 1]?.value === "{" || tokens[k + 1]?.value === "*"
    )) {
      typeOnly = true;
      k++;
    }
    const bindings: ImportBinding[] = [];
    if (isNameTok(tokens[k])) {
      bindings.push({ local: tokens[k].value, imported: "default", typeOnly });
      k++;
      if (tokens[k]?.value === ",") k++;
    }
    if (tokens[k]?.value === "*") {
      if (tokens[k + 1]?.value !== "as" || !isNameTok(tokens[k + 2])) return null;
      bindings.push({ local: tokens[k + 2].value, imported: "*", typeOnly });
      k += 3;
    } else if (tokens[k]?.value === "{") {
      k++;
      while (k < tokens.length && tokens[k].value !== "}") {
        let tOnly = typeOnly;
        if (tokens[k].value === "type" && isNameTok(tokens[k + 1])) {
          tOnly = true;
          k++;
        }
        if (isNameTok(tokens[k])) {
          const nm = tokens[k].value;
          let local = nm;
          k++;
          if (tokens[k]?.value === "as" && isNameTok(tokens[k + 1])) {
            local = tokens[k + 1].value;
            k += 2;
          }
          bindings.push({ local, imported: nm, typeOnly: tOnly });
        } else {
          k++;
        }
        if (tokens[k]?.value === ",") k++;
      }
      k++;
    }
    if (tokens[k]?.value === "from" && tokens[k + 1]?.kind === "string") {
      return { imports: [{ raw: unquote(tokens[k + 1].value), bindings, line, dynamic: false }] };
    }
    return null;
  };

  const matchExportClause = (i: number, j: number): DeclResult | null => {
    let k = j;
    let typeOnly = false;
    if (tokens[k].value === "type") {
      typeOnly = true;
      k++;
    }
    if (tokens[k].value !== "{") return null;
    k++;
    const names: string[] = [];
    const bindings: ImportBinding[] = [];
    while (k < tokens.length && tokens[k].value !== "}") {
      let tOnly = typeOnly;
      if (tokens[k].value === "type" && isNameTok(tokens[k + 1])) {
        tOnly = true;
        k++;
      }
      if (isNameTok(tokens[k])) {
        const nm = tokens[k].value;
        let exportedAs = nm;
        k++;
        if (tokens[k]?.value === "as" && isNameTok(tokens[k + 1])) {
          exportedAs = tokens[k + 1].value;
          k += 2;
        }
        names.push(exportedAs);
        bindings.push({ local: nm, imported: nm, typeOnly: tOnly });
      } else {
        k++;
      }
      if (tokens[k]?.value === ",") k++;
    }
    k++; // past the closing `}` before the optional `from`
    const result: DeclResult = { exportNames: names };
    if (tokens[k]?.value === "from" && tokens[k + 1]?.kind === "string") {
      result.imports = [{
        raw: unquote(tokens[k + 1].value),
        bindings,
        line: tokens[i].line + 1,
        dynamic: false,
      }];
    }
    return result;
  };

  const matchExportStar = (i: number, j: number): DeclResult | null => {
    let k = j + 1;
    let ns: string | null = null;
    if (tokens[k]?.value === "as" && isNameTok(tokens[k + 1])) {
      ns = tokens[k + 1].value;
      k += 2;
    }
    if (tokens[k]?.value !== "from" || tokens[k + 1]?.kind !== "string") return null;
    const result: DeclResult = {
      imports: [{ raw: unquote(tokens[k + 1].value), bindings: [], line: tokens[i].line + 1, dynamic: false }],
    };
    if (ns) result.exportNames = [ns];
    return result;
  };

  const matchFunction = (
    j: number,
    stmtStart: number,
    mods: string[],
    exported: boolean,
    isDefault: boolean,
  ): DeclResult | null => {
    let k = j + 1;
    if (tokens[k]?.value === "*") k++;
    let name: string | null = null;
    let nameIdx = -1;
    if (isNameTok(tokens[k])) {
      name = tokens[k].value;
      nameIdx = k;
      k++;
    } else if (isDefault) {
      name = "default";
    } else {
      return null;
    }
    if (tokens[k]?.value === "<") {
      const e = scanAngle(k);
      if (e < 0) return null;
      k = e + 1;
    }
    if (tokens[k]?.value !== "(") return null;
    const close = matchParen(k);
    if (close < 0) return null;
    const body = scanToBody(close + 1, true);
    const result: DeclResult = {
      symbols: [makeSymbol("function", name, stmtStart, body.bodyOpen, body.endIdx, exported, mods, [])],
    };
    if (nameIdx >= 0) result.declNameIdxs = [nameIdx];
    if (body.bodyOpen !== null) {
      result.bodyOpen = body.bodyOpen;
      result.scope = { kind: "function", name };
    }
    return result;
  };

  /** Parse `Name`, `Name.Space`, optionally followed by `< … >`. */
  const parseTypeRef = (k: number): { chain: string; next: number } | null => {
    if (!isNameTok(tokens[k])) return null;
    const parts = [tokens[k].value];
    let p = k + 1;
    while (tokens[p]?.value === "." && isNameTok(tokens[p + 1])) {
      parts.push(tokens[p + 1].value);
      p += 2;
    }
    if (tokens[p]?.value === "<") {
      const e = scanAngle(p);
      if (e < 0) return null;
      p = e + 1;
    }
    return { chain: parts.join("."), next: p };
  };

  const matchClassLike = (
    kind: "class" | "interface",
    j: number,
    stmtStart: number,
    mods: string[],
    exported: boolean,
    isDefault: boolean,
  ): DeclResult | null => {
    let k = j + 1;
    let name: string | null = null;
    let nameIdx = -1;
    if (kind === "class" && tokens[k]?.kind === "ident") {
      name = tokens[k].value;
      nameIdx = k;
      k++;
    } else if (kind === "interface" && isNameTok(tokens[k])) {
      name = tokens[k].value;
      nameIdx = k;
      k++;
    } else if (isDefault) {
      name = "default";
    } else {
      return null;
    }
    if (tokens[k]?.value === "<") {
      const e = scanAngle(k);
      if (e < 0) return null;
      k = e + 1;
    }
    const heritage: string[] = [];
    while (tokens[k]?.value === "extends" || tokens[k]?.value === "implements") {
      k++;
      while (true) {
        const ref = parseTypeRef(k);
        if (!ref) return null;
        heritage.push(ref.chain);
        k = ref.next;
        if (kind === "class" && tokens[k]?.value === "(") {
          const c = matchParen(k);
          if (c < 0) return null;
          k = c + 1;
          break;
        }
        if (tokens[k]?.value === ",") {
          k++;
          continue;
        }
        break;
      }
    }
    const body = scanToBody(k, true);
    if (body.bodyOpen === null) return null;
    const result: DeclResult = {
      symbols: [makeSymbol(kind, name, stmtStart, body.bodyOpen, body.endIdx, exported, mods, heritage)],
      bodyOpen: body.bodyOpen,
      scope: { kind, name },
    };
    if (nameIdx >= 0) result.declNameIdxs = [nameIdx];
    return result;
  };

  const matchEnum = (
    j: number,
    stmtStart: number,
    mods: string[],
    exported: boolean,
  ): DeclResult | null => {
    if (!isNameTok(tokens[j + 1])) return null;
    const name = tokens[j + 1].value;
    const body = scanToBody(j + 2, false);
    if (body.bodyOpen === null) return null;
    const result: DeclResult = {
      symbols: [makeSymbol("enum", name, stmtStart, body.bodyOpen, body.endIdx, exported, mods, [])],
      bodyOpen: body.bodyOpen,
      scope: { kind: "block", name },
      declNameIdxs: [j + 1],
    };
    return result;
  };

  const matchTypeAlias = (
    j: number,
    stmtStart: number,
    mods: string[],
    exported: boolean,
  ): DeclResult | null => {
    const name = tokens[j + 1].value;
    let k = j + 2;
    if (tokens[k]?.value === "<") {
      const e = scanAngle(k);
      if (e < 0) return null;
      k = e + 1;
    }
    if (tokens[k]?.value !== "=") return null;
    const term = scanTypeEnd(k + 1);
    const endIdx = term < tokens.length ? term - 1 : tokens.length - 1;
    return {
      symbols: [makeSymbol("type", name, stmtStart, null, Math.max(stmtStart, endIdx), exported, mods, [])],
      declNameIdxs: [j + 1],
    };
  };

  const matchNamespace = (
    j: number,
    stmtStart: number,
    mods: string[],
    exported: boolean,
  ): DeclResult | null => {
    if (tokens[j + 1]?.kind !== "ident") return null;
    const name = tokens[j + 1].value;
    const body = scanToBody(j + 2, false);
    if (body.bodyOpen === null) return null;
    const result: DeclResult = {
      symbols: [makeSymbol("namespace", name, stmtStart, body.bodyOpen, body.endIdx, exported, mods, [])],
      bodyOpen: body.bodyOpen,
      scope: { kind: "namespace", name },
      declNameIdxs: [j + 1],
    };
    return result;
  };

  const matchConstList = (
    j: number,
    stmtStart: number,
    mods: string[],
    exported: boolean,
    keyword: string,
  ): DeclResult | null => {
    const symbols: GraphSymbol[] = [];
    const nameIdxs: number[] = [];
    const edgeImports: ImportEdge[] = [];
    let k = j + 1;
    let boundary = j;
    let first = true;

    while (k < tokens.length) {
      if (!isNameTok(tokens[k])) break; // destructuring or junk: no symbols
      const name = tokens[k].value;
      const nameIdx = k;
      k++;

      if (tokens[k]?.value === ":") {
        k = scanTypeEnd(k + 1);
        if (k >= tokens.length) break;
      }
      if (!first && tokens[k]?.value !== "=") break; // later declarators must be initialized

      let bodyOpen: number | null = null;
      let endIdx: number;
      const modifiers = [...mods];
      let fn = false;

      if (tokens[k]?.value === "=") {
        // `const m = import("x")` / `const c = require("x")` → dependency edge.
        const iv = tokens[k + 1];
        if (iv && ((iv.kind === "keyword" && iv.value === "import") ||
          (iv.kind === "ident" && iv.value === "require")) &&
          tokens[k + 2]?.value === "(" && tokens[k + 3]?.kind === "string") {
          edgeImports.push({
            raw: unquote(tokens[k + 3].value),
            bindings: [{ local: name, imported: iv.value === "require" ? "default" : "*", typeOnly: false }],
            line: iv.line + 1,
            dynamic: iv.value === "import",
          });
        }
        if (tokens[k + 1]?.value === "async") modifiers.push("async");
        const scan = detectFnAfter(k + 1);
        if (scan) {
          fn = true;
          modifiers.push(scan.arrow ? "arrow" : "function");
          bodyOpen = scan.bodyOpen;
          endIdx = scan.bodyOpen ?? scan.endIdx;
        } else {
          const t = scanToDeclaratorEnd(k + 1);
          endIdx = t.last;
          const probe = t.last + 1;
          const symbol = makeSymbol("const", name, first ? stmtStart : boundary + 1, null, endIdx, exported, modifiers, []);
          if (!first) symbol.signature = `${keyword} ${symbol.signature}`;
          symbols.push(symbol);
          nameIdxs.push(nameIdx);
          if (tokens[probe]?.value === ",") {
            k = probe + 1;
            boundary = probe;
            first = false;
            continue;
          }
          return results();
        }
      } else {
        const t = scanToDeclaratorEnd(k);
        endIdx = t.last;
        const symbol = makeSymbol("const", name, first ? stmtStart : boundary + 1, null, endIdx, exported, modifiers, []);
        if (!first) symbol.signature = `${keyword} ${symbol.signature}`;
        symbols.push(symbol);
        nameIdxs.push(nameIdx);
        const probe = t.last + 1;
        if (tokens[probe]?.value === ",") {
          k = probe + 1;
          boundary = probe;
          first = false;
          continue;
        }
        return results();
      }

      // Function-like declarator: record, then look for the next one after
      // the body's matching `}`.
      const symbol = makeSymbol("function", name, first ? stmtStart : boundary + 1, bodyOpen, endIdx, exported, modifiers, []);
      if (!first) symbol.signature = `${keyword} ${symbol.signature}`;
      symbols.push(symbol);
      nameIdxs.push(nameIdx);
      const afterBody = bodyOpen !== null ? braceMatch.get(bodyOpen) : undefined;
      const probe = (afterBody ?? endIdx) + 1;
      if (tokens[probe]?.value === ",") {
        k = probe + 1;
        boundary = probe;
        first = false;
        continue;
      }
      return results();
    }

    if (symbols.length === 0 && nameIdxs.length === 0) return null;
    return results();

    function results(): DeclResult {
      const r: DeclResult = { symbols, declNameIdxs: nameIdxs };
      if (edgeImports.length > 0) r.imports = edgeImports;
      return r;
    }
  };

  const matchMember = (
    i: number,
    j0: number,
    mods: string[],
    exported: boolean,
  ): DeclResult | null => {
    let j = j0;
    if (tokens[j]?.value === "*") j++; // generator method
    let name: string;
    let nameIdx: number;
    let kind: SymbolKind = "method";
    const v = tokens[j]?.value;
    if (v === "constructor" && (tokens[j + 1]?.value === "(" || tokens[j + 1]?.value === "<")) {
      name = "constructor";
      nameIdx = j;
      kind = "constructor";
      j++;
    } else if ((v === "get" || v === "set") && isNameTok(tokens[j + 1]) &&
      (tokens[j + 2]?.value === "(" || tokens[j + 2]?.value === "<")) {
      name = tokens[j + 1].value;
      nameIdx = j + 1;
      kind = v === "get" ? "getter" : "setter";
      j += 2;
    } else {
      if (!isNameTok(tokens[j])) return null;
      name = tokens[j].value;
      nameIdx = j;
      j++;
    }
    if (tokens[j]?.value === "<") {
      const e = scanAngle(j);
      if (e < 0) return null;
      j = e + 1;
    }
    if (tokens[j]?.value !== "(") return null; // field, typed member, initializer…
    const close = matchParen(j);
    if (close < 0) return null;
    const body = scanToBody(close + 1, true);
    const result: DeclResult = {
      symbols: [makeSymbol(kind, name, i, body.bodyOpen, body.endIdx, exported, mods, [])],
      declNameIdxs: [nameIdx],
    };
    if (body.bodyOpen !== null) {
      result.bodyOpen = body.bodyOpen;
      result.scope = { kind: "function", name };
    }
    return result;
  };

  const tryDecl = (i: number): DeclResult | null => {
    const t0 = tokens[i];
    const top = scopeStack[scopeStack.length - 1];

    if (t0.kind === "keyword" && t0.value === "import") {
      return top.kind === "module" ? matchImport(i) : null;
    }
    if (top.kind !== "module" && top.kind !== "namespace" && top.kind !== "class") return null;

    // Consume the modifier head first — class members need it too
    // (`async render()`, `private static create()`).
    let j = i;
    let exported = false;
    let isDefault = false;
    const mods: string[] = [];
    while (j < tokens.length) {
      const v = tokens[j].value;
      const kk = tokens[j].kind;
      if (kk === "keyword" && v === "export" && !exported) { exported = true; mods.push("export"); j++; continue; }
      if (kk === "keyword" && v === "default" && exported && !isDefault) { isDefault = true; mods.push("default"); j++; continue; }
      if (kk === "keyword" && (v === "declare" || v === "abstract" || v === "async")) { mods.push(v); j++; continue; }
      if (kk === "keyword" && (v === "public" || v === "private" || v === "protected" ||
        v === "readonly" || v === "static" || v === "override")) { mods.push(v); j++; continue; }
      break;
    }

    if (top.kind === "class") return matchMember(i, j, mods, exported);
    if (j >= tokens.length) return null;
    const t = tokens[j];

    if (exported) {
      if (t.value === "{") return matchExportClause(i, j);
      if (t.value === "type" && tokens[j + 1]?.value === "{") return matchExportClause(i, j);
      if (t.value === "*") return matchExportStar(i, j);
      if (t.value === "=") {
        return { exportNames: [isNameTok(tokens[j + 1]) ? tokens[j + 1].value : "default"] };
      }
      if (isDefault && t.value !== "function" && t.value !== "class" && t.value !== "interface") {
        return { exportNames: ["default"] };
      }
    }

    if (t.kind === "keyword") {
      switch (t.value) {
        case "function":
          return matchFunction(j, i, mods, exported, isDefault);
        case "class":
          return matchClassLike("class", j, i, mods, exported, isDefault);
        case "interface":
          return isNameTok(tokens[j + 1]) ? matchClassLike("interface", j, i, mods, exported, false) : null;
        case "type":
          return tokens[j + 1]?.kind === "ident" &&
            (tokens[j + 2]?.value === "=" || tokens[j + 2]?.value === "<")
            ? matchTypeAlias(j, i, mods, exported)
            : null;
        case "enum":
          return matchEnum(j, i, mods, exported);
        case "namespace":
        case "module":
          return tokens[j + 1]?.kind === "ident" ? matchNamespace(j, i, mods, exported) : null;
        case "const":
          if (tokens[j + 1]?.value === "enum") return matchEnum(j + 1, i, [...mods, "const"], exported);
          return matchConstList(j, i, mods, exported, "const");
        case "let":
          return matchConstList(j, i, mods, exported, "let");
        case "var":
          return matchConstList(j, i, mods, exported, "var");
      }
    }
    return null;
  };

  const apply = (m: DeclResult): void => {
    if (m.symbols) for (const s of m.symbols) symbols.push(s);
    if (m.imports) for (const e of m.imports) imports.push(e);
    if (m.exportNames) for (const n of m.exportNames) exportNames.push(n);
    if (m.bodyOpen !== undefined && m.scope) scopeAt.set(m.bodyOpen, m.scope);
    if (m.declNameIdxs) for (const idx of m.declNameIdxs) declNames.add(idx);
  };

  // ------------------------------------------------------------------- pass

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (t.kind === "punct") {
      if (t.value === "{") {
        scopeStack.push(scopeAt.get(i) ?? { kind: "block", name: null });
        i++;
        continue;
      }
      if (t.value === "}") {
        if (scopeStack.length > 1) scopeStack.pop();
        i++;
        continue;
      }
    }

    if (statementStart(i)) {
      const m = tryDecl(i);
      if (m) apply(m);
    }

    if (t.kind === "ident" || t.kind === "keyword") {
      if (t.value.length >= 2) {
        let idx = identIdx.get(t.value);
        if (idx === undefined) {
          idx = identNames.length;
          identNames.push(t.value);
          identIdx.set(t.value, idx);
        }
        idents.push([idx, t.line + 1, t.col + 1]);
      }
      const next = tokens[i + 1];
      let isCall = false;
      if (!declNames.has(i) && !CALL_SKIP.has(t.value)) {
        if (next?.value === "(" && next.kind === "punct") {
          isCall = true;
        } else if (next?.value === "<") {
          // Explicit type arguments: `foo<Bar>(x)` is a call too.
          const closeAngle = scanAngle(i + 1);
          isCall = closeAngle >= 0 && tokens[closeAngle + 1]?.value === "(";
        }
      }
      if (isCall) {
        let start = i;
        while (start >= 2 && tokens[start - 1].value === "." &&
          (tokens[start - 2].kind === "ident" || tokens[start - 2].kind === "keyword")) {
          start -= 2;
        }
        calls.push({
          name: t.value,
          chain: start < i ? source.slice(tokens[start].start, tokens[i].end) : null,
          line: t.line + 1,
          col: t.col + 1,
          enclosing: enclosingName(),
          newCall: start > 0 && tokens[start - 1].value === "new",
        });
      }
    }
    i++;
  }

  for (const s of symbols) if (s.exported) exportNames.push(s.name);

  return {
    path,
    kind: "code",
    lines,
    symbols,
    imports,
    exports: [...new Set(exportNames)],
    calls,
    identNames,
    idents,
  };
}

/** Markdown: ATX headings become symbols (kind "heading"); text search covers the rest. */
export function extractMarkdown(path: string, source: string): FileIndex {
  const rawLines = source.split("\n");
  const symbols: GraphSymbol[] = [];
  let inFence = false;
  let bodyStart = 0;

  if (rawLines[0]?.trim() === "---") {
    for (let li = 1; li < rawLines.length; li++) {
      if (rawLines[li].trim() === "---") {
        bodyStart = li + 1;
        break;
      }
    }
  }

  for (let li = bodyStart; li < rawLines.length; li++) {
    const line = rawLines[li];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].trim();
    if (!text) continue;
    symbols.push({
      name: text,
      kind: "heading",
      line: li + 1,
      endLine: li + 1,
      signature: `${"#".repeat(level)} ${text}`,
      exported: false,
      enclosing: null,
      modifiers: [],
      heritage: [],
    });
  }
  for (let k = 0; k < symbols.length; k++) {
    const next = symbols[k + 1];
    symbols[k].endLine = next ? next.line - 1 : rawLines.length;
  }

  return {
    path,
    kind: "markdown",
    lines: rawLines.length,
    symbols,
    imports: [],
    exports: [],
    calls: [],
    identNames: [],
    idents: [],
  };
}
