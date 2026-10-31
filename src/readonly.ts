/**
 * Read-only shell exemption.
 *
 * The gate used to demand the whole task pipeline before a `git status` or a
 * `Get-Content`, because a shell call was treated exactly like a write. The
 * check is deliberately conservative: an unrecognised command stays subject
 * to the gate, and any shell metacharacter that could chain, redirect or
 * substitute is enough to refuse the exemption. A false negative costs one
 * loaded skill; a false positive would let a write through.
 */

/** Chaining, redirection, substitution, or a multi-line script. */
const SHELL_METACHARACTERS = /[;&|`<>\n\r]|\$\(|\$\{/;

/** Flags that turn an otherwise read-only tool into a writer. */
const WRITE_FLAGS =
  /(?:^|\s)(?:--output|--out-file|--outfile|--exec|--exec-path|--upload-pack|--receive-pack|--config-env)(?:=|\s|$)/i;

const SIMPLE_READ_ONLY = new Set([
  // POSIX / cross-platform readers
  "ls",
  "dir",
  "pwd",
  "cat",
  "type",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "du",
  "df",
  "more",
  "rg",
  "grep",
  "findstr",
  "jq",
  // PowerShell readers and their aliases
  "get-childitem",
  "gci",
  "get-content",
  "gc",
  "get-item",
  "gi",
  "get-location",
  "gl",
  "test-path",
  "resolve-path",
  "select-string",
  "compare-object",
  "write-output",
  // Session / host facts
  "whoami",
  "hostname",
  "ver",
  "echo"
]);

const GIT_READ_ONLY = new Set([
  "status",
  "log",
  "diff",
  "show",
  "rev-parse",
  "ls-files",
  "blame",
  "describe"
]);

/** `git branch` only lists; every flag that creates, moves or deletes is out. */
const GIT_BRANCH_LIST_FLAGS = new Set(["-a", "-r", "-v", "-vv", "--list", "--show-current", "--no-color"]);

function normalizeCommand(token: string): string {
  return token.replace(/^["']|["']$/g, "").toLowerCase().replace(/\.exe$/, "");
}

function argsAreVersionOnly(tokens: string[]): boolean {
  return tokens.length === 2 && ["-v", "--version", "-version", "-V"].includes(tokens[1]);
}

/**
 * A package script that only reads the code. `npm run typecheck` used to be
 * refused as a shell write, which blocked the very verification the gate
 * demands. Only scripts whose names are checks pass; `build`, `dev`, `start`
 * and anything unknown stay subject to the gate.
 */
const SAFE_SCRIPTS = /^(typecheck|tsc|lint|check|verify)(:[\w.-]+)?$/i;

function scriptIsReadOnly(tokens: string[]): boolean {
  const runIndex = tokens.findIndex((token) => token === "run" || token === "run-script");
  if (runIndex < 0) return false;
  const script = tokens[runIndex + 1];
  if (!script || !SAFE_SCRIPTS.test(script)) return false;
  // A script argument could still write (-u, --update, --fix).
  return !tokens.slice(runIndex + 2).some((token) => /^(-u|--update|-w|--watch|--fix)$/i.test(token));
}

function npxIsReadOnly(tokens: string[]): boolean {
  const tool = tokens[1]?.toLowerCase();
  if (tool === "tsc") return tokens.some((token) => token === "--noEmit");
  if (tool === "eslint") return !tokens.some((token) => token === "--fix");
  if (tool === "prettier") return tokens.some((token) => token === "--check");
  return false;
}

function gitIsReadOnly(tokens: string[]): boolean {
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    // `-C <dir>` moves to another repository: still read-only, but skip its value.
    if (token === "-C") {
      index += 2;
      continue;
    }
    if (token === "--no-pager" || token === "-P") {
      index += 1;
      continue;
    }
    // `-c key=value` and `--exec-path` can make git run arbitrary commands.
    if (token === "-c" || token.startsWith("--exec-path") || token.startsWith("--config-env")) return false;
    if (token.startsWith("-")) return false;
    break;
  }
  const sub = tokens[index]?.toLowerCase();
  if (!sub) return false;
  if (sub === "branch") {
    return tokens.slice(index + 1).every((flag) => GIT_BRANCH_LIST_FLAGS.has(flag));
  }
  return GIT_READ_ONLY.has(sub);
}

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  if (WRITE_FLAGS.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/);
  const cmd = normalizeCommand(tokens[0]);
  if (cmd.length === 0) return false;

  if (cmd === "git") return gitIsReadOnly(tokens);
  // Runtimes and package managers: a version probe, or a check script.
  if (["npm", "pnpm", "yarn"].includes(cmd)) {
    return argsAreVersionOnly(tokens) || scriptIsReadOnly(tokens);
  }
  if (cmd === "npx") return npxIsReadOnly(tokens);
  if (["node", "python", "python3", "py", "dart", "flutter", "go", "cargo", "rustc", "java"].includes(cmd)) {
    return argsAreVersionOnly(tokens);
  }
  return SIMPLE_READ_ONLY.has(cmd);
}
