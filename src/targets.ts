export function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote = "";
  const flush = (): void => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote.length > 0) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "\n" || char === ";") {
      flush();
      tokens.push(";");
      continue;
    }
    if (char === "|") {
      flush();
      if (command[index + 1] === "|") {
        tokens.push("||");
        index += 1;
      } else tokens.push("|");
      continue;
    }
    if (char === "&") {
      flush();
      if (command[index + 1] === ">") {
        tokens.push("&>");
        index += 1;
      } else if (command[index + 1] === "&") {
        tokens.push("&&");
        index += 1;
      } else tokens.push("&");
      continue;
    }
    if (char === ">") {
      if (/^\d+$/.test(current)) current = "";
      flush();
      if (command[index + 1] === ">") {
        tokens.push(">>");
        index += 1;
      } else tokens.push(">");
      continue;
    }
    if (char === "<") {
      flush();
      tokens.push("<");
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return tokens;
}

const OPERATORS = new Set([">", ">>", "&>", "<", "|", "||", "&", "&&", ";"]);

function isOperator(token: string): boolean {
  return OPERATORS.has(token) || token.startsWith("&") || /^\d+$/.test(token);
}

function firstPositional(tokens: string[]): string | null {
  for (const token of tokens) {
    if (token.startsWith("-")) continue;
    if (isOperator(token)) continue;
    return token;
  }
  return null;
}

function lastPositional(tokens: string[]): string | null {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.startsWith("-")) continue;
    if (isOperator(token)) continue;
    return token;
  }
  return null;
}

export function extractShellPaths(command: string): string[] {
  const out: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    let path = value.trim();
    if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
      path = path.slice(1, -1);
    }
    if (path.length === 0) return;
    if (path.startsWith("-") || path.startsWith("$") || path.startsWith("&")) return;
    if (/^\d+$/.test(path)) return;
    if (path.includes("://")) return;
    if (!out.includes(path)) out.push(path);
  };

  const tokens = tokenizeShell(command);
  const WRITE_CMDLETS = new Set([
    "set-content",
    "add-content",
    "out-file",
    "tee-object",
    "set-itemproperty",
    "sc",
    "ac",
    "new-item",
    "ni"
  ]);
  const COPY_CMDS = new Set(["cp", "mv", "robocopy", "rsync", "install"]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === ">" || token === ">>" || token === "&>") {
      let cursor = index + 1;
      while (cursor < tokens.length && isOperator(tokens[cursor])) cursor += 1;
      if (cursor < tokens.length) add(tokens[cursor]);
      continue;
    }

    const lower = token.toLowerCase();
    const rest = tokens.slice(index + 1);

    if (COPY_CMDS.has(lower)) {
      add(lastPositional(rest));
      continue;
    }
    if (lower === "tee") {
      add(firstPositional(rest));
      continue;
    }
    if (lower === "touch" || lower === "truncate") {
      for (const candidate of rest) if (!candidate.startsWith("-") && !isOperator(candidate)) add(candidate);
      continue;
    }
    if (lower === "sed") {
      if (rest.some((value) => value === "-i" || value.startsWith("-i"))) add(lastPositional(rest));
      continue;
    }
    if (lower === "dd") {
      for (const candidate of rest) {
        const match = candidate.match(/^of=(.+)$/);
        if (match) add(match[1]);
      }
      continue;
    }
    if (WRITE_CMDLETS.has(lower)) {
      const flagIndex = rest.findIndex((value) =>
        ["-path", "-literalpath", "-filepath", "-destination", "-file"].includes(value.toLowerCase())
      );
      if (flagIndex >= 0 && rest[flagIndex + 1]) add(rest[flagIndex + 1]);
      else add(firstPositional(rest));
      continue;
    }
    const ofMatch = token.match(/^of=(.+)$/);
    if (ofMatch) add(ofMatch[1]);
  }

  return out;
}

export function extractTargetPaths(tool: string, args: unknown): string[] {
  const paths: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0 && !paths.includes(value)) paths.push(value);
  };
  const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  push(record.filePath);
  push(record.path);
  push(record.file);

  const patchText =
    typeof record.patchText === "string"
      ? record.patchText
      : typeof record.patch === "string"
        ? record.patch
        : "";
  if (patchText.length > 0) {
    for (const line of patchText.split(/\r?\n/)) {
      const match = line.match(/^\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s+(.+?)\s*$/);
      if (match) push(match[1]);
    }
  }

  if (typeof record.command === "string" && record.command.length > 0) {
    for (const path of extractShellPaths(record.command)) push(path);
  }

  return paths;
}
