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
  return OPERATORS.has(token) || token.startsWith("&");
}

function isDashFlag(token: string): boolean {
  return token.startsWith("-");
}

function isWindowsFlag(token: string): boolean {
  return /^\/[a-zA-Z]$/.test(token);
}

function allPositionals(tokens: string[], windows: boolean): string[] {
  return tokens.filter((token) => !isDashFlag(token) && !(windows && isWindowsFlag(token)) && !isOperator(token));
}

function firstPositional(tokens: string[], windows: boolean): string | null {
  return allPositionals(tokens, windows)[0] ?? null;
}

function lastPositional(tokens: string[], windows: boolean): string | null {
  const positional = allPositionals(tokens, windows);
  return positional.length > 0 ? positional[positional.length - 1] : null;
}

const VALUE_FLAGS = new Set([
  "-encoding",
  "-value",
  "-filter",
  "-name",
  "-itemtype",
  "-delimiter",
  "-width",
  "-stream",
  "-destination",
  "-newname",
  "-property",
  "-inputobject",
  "-credential"
]);

function firstPathLike(tokens: string[], windows: boolean): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isDashFlag(token) || (windows && isWindowsFlag(token)) || isOperator(token)) continue;
    const previous = tokens[index - 1];
    if (previous && VALUE_FLAGS.has(previous.toLowerCase())) continue;
    return token;
  }
  return null;
}

function flagValue(tokens: string[], flags: string[]): string | null {
  const index = tokens.findIndex((token) => flags.includes(token.toLowerCase()));
  return index >= 0 && tokens[index + 1] ? tokens[index + 1] : null;
}

const WRAPPERS = new Set(["sudo", "doas", "env", "nohup", "time", "command", "exec", "cmd", "cmd.exe", "xargs", "nice", "timeout", "stdbuf"]);
const WRAPPER_VALUE_FLAGS: Record<string, Set<string>> = {
  sudo: new Set(["-u", "--user", "-g", "--group", "-p", "--prompt", "-c", "--close-from", "-h", "--host", "-r", "--role", "-t", "--type", "-T", "--command-timeout"]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
  time: new Set(["-o", "--output", "-f", "--format", "-a", "--append"]),
  nice: new Set(["-n", "--adjustment"]),
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  stdbuf: new Set(["-i", "-o", "-e"]),
  xargs: new Set(["-a", "--arg-file", "-d", "-E", "-I", "-L", "-n", "-P", "-s"])
};
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRITE_CMDLETS = new Set([
  "set-content",
  "add-content",
  "out-file",
  "tee-object",
  "set-itemproperty",
  "set-item",
  "new-item",
  "ni",
  "mkdir",
  "md"
]);
const DEST_CMDLETS = new Set(["copy-item", "move-item", "rename-item", "copy", "move", "ren", "rename", "xcopy"]);
const DELETE_CMDLETS = new Set(["remove-item", "ri", "rm", "del", "erase", "rd", "rmdir"]);
const COPY_CMDS = new Set(["cp", "mv", "rsync", "robocopy"]);
const WINDOWS_CMDS = new Set([
  "rd",
  "rmdir",
  "del",
  "erase",
  "xcopy",
  "robocopy",
  "copy",
  "move",
  "ren",
  "rename",
  "remove-item",
  "ri",
  "set-content",
  "add-content",
  "out-file",
  "new-item",
  "ni",
  "mkdir",
  "md",
  "copy-item",
  "move-item",
  "rename-item"
]);

export function extractShellPaths(command: string): string[] {
  const out: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    let path = value.trim();
    if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
      path = path.slice(1, -1);
    }
    if (path.length === 0) return;
    if (isDashFlag(path) || path.startsWith("$") || path.startsWith("&")) return;
    if (path.startsWith("/dev/") || path === "NUL") return;
    if (path.includes("://")) return;
    if (!out.includes(path)) out.push(path);
  };

  const tokens = tokenizeShell(command);
  let expectCommand = true;
  let skipValue = false;
  let wrapper: string | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isOperator(token)) {
      if (token === ">" || token === ">>" || token === "&>") {
        const target = tokens[index + 1];
        if (target && !isOperator(target)) add(target);
      }
      expectCommand = true;
      skipValue = false;
      wrapper = null;
      continue;
    }
    if (!expectCommand) continue;
    if (skipValue) {
      skipValue = false;
      continue;
    }

    const lower = token.toLowerCase();
    if (WRAPPERS.has(lower)) {
      wrapper = lower;
      continue;
    }
    if (ENV_ASSIGN.test(token)) continue;
    if (isDashFlag(token)) {
      if (wrapper !== null && WRAPPER_VALUE_FLAGS[wrapper]?.has(lower)) skipValue = true;
      continue;
    }
    if (wrapper !== null && isWindowsFlag(token)) continue;
    if ((wrapper === "timeout" || wrapper === "nice") && /^\d+(\.\d+)?[a-z]?$/i.test(token)) continue;

    expectCommand = false;
    const windows = WINDOWS_CMDS.has(lower);
    const rest = tokens.slice(index + 1);

    if (COPY_CMDS.has(lower)) {
      add(lastPositional(rest, windows));
    } else if (DEST_CMDLETS.has(lower)) {
      add(flagValue(rest, ["-destination", "-newname"]) ?? lastPositional(rest, windows));
    } else if (DELETE_CMDLETS.has(lower)) {
      for (const candidate of allPositionals(rest, windows)) add(candidate);
    } else if (WRITE_CMDLETS.has(lower)) {
      add(flagValue(rest, ["-path", "-literalpath", "-filepath", "-destination", "-file"]) ?? firstPathLike(rest, windows));
    } else if (lower === "tee") {
      add(firstPositional(rest, windows));
    } else if (lower === "touch" || lower === "truncate") {
      for (const candidate of allPositionals(rest, windows)) add(candidate);
    } else if (lower === "sed") {
      if (rest.some((value) => value === "-i" || value.startsWith("-i"))) add(lastPositional(rest, windows));
    } else if (lower === "dd") {
      for (const candidate of rest) {
        const match = candidate.match(/^of=(.+)$/);
        if (match) add(match[1]);
      }
    } else {
      const ofMatch = token.match(/^of=(.+)$/);
      if (ofMatch) add(ofMatch[1]);
    }
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
  push(record.file_path);
  push(record.path);
  push(record.file);
  push(record.notebook_path);

  const patchText =
    typeof record.patchText === "string"
      ? record.patchText
      : typeof record.patch === "string"
        ? record.patch
        : "";
  if (patchText.length > 0) {
    for (const line of patchText.split(/\r?\n/)) {
      const fileMatch = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+?)\s*$/);
      if (fileMatch) push(fileMatch[1]);
      const moveMatch = line.match(/^\*\*\*\s+Move to:\s+(.+?)\s*$/);
      if (moveMatch) push(moveMatch[1]);
    }
  }

  if (typeof record.command === "string" && record.command.length > 0) {
    for (const path of extractShellPaths(record.command)) push(path);
  }

  return paths;
}
