import { spawnSync } from "node:child_process";

// Allowed characters for a single argument. It excludes every character a shell
// can reinterpret: whitespace, & | < > ^ % ! ( ) " ' ` ; $ * ? and newlines.
// The Windows branch below joins tokens with spaces and hands the result to
// cmd.exe, so widening this set would re-open command injection on that path.
const SAFE_TOKEN = /^[A-Za-z0-9@._+,/:=~-]+$/;

type CommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

function resultFrom(status: number | null, stdout: string, stderr: string, error?: string): CommandResult {
  return { ok: status === 0, status, stdout, stderr, error };
}

function refused(token: string): CommandResult {
  return { ok: false, status: null, stdout: "", stderr: "", error: `refused unsafe token: ${token}` };
}

export function unsafeToken(tokens: string[]): string | null {
  for (const token of tokens) {
    if (token.length === 0) return "";
    if (!SAFE_TOKEN.test(token)) return token;
  }
  return null;
}

export function runCommand(bin: string, args: string[]): CommandResult {
  const bad = unsafeToken([bin, ...args]);
  if (bad !== null) return refused(bad);
  const [command, spawnArgs] = resolveSpawn(bin, args);
  const result = spawnSync(command, spawnArgs, { encoding: "utf8", windowsHide: true, shell: false });
  return resultFrom(result.status, result.stdout ?? "", result.stderr ?? "", result.error?.message);
}

function resolveSpawn(bin: string, args: string[]): [string, string[]] {
  if (process.platform !== "win32") return [bin, args];
  // The shell is taken from the environment. Whoever can set ComSpec can already
  // run code locally, so the token allowlist above is what actually contains the
  // arguments; this is noted for completeness, not treated as a boundary.
  const shell = process.env.ComSpec ?? "cmd.exe";
  return [shell, ["/d", "/s", "/c", [bin, ...args].join(" ")]];
}

// Bootstrap may only start a known interpreter or packager. Shell binaries
// (sh, bash, pwsh, powershell, cmd) are deliberately absent: arguments are
// parsed by the executable itself, so a shell would turn this allowlist into
// a formality by reinterpreting anything it is handed.
const SAFE_BOOTSTRAP_BINS = new Set([
  "node", "npm", "npx", "uv", "uvx", "python", "py"
]);

function normalizeBin(bin: string): string {
  const base = bin.replace(/\\/g, "/").split("/").pop() ?? bin;
  return base.toLowerCase();
}

function bootstrapBinAllowed(bin: string): boolean {
  const name = normalizeBin(bin);
  const withoutExt = name.replace(/\.(exe|cmd|bat)$/i, "");
  return SAFE_BOOTSTRAP_BINS.has(name) || SAFE_BOOTSTRAP_BINS.has(withoutExt);
}

function refusedBootstrap(bin: string): CommandResult {
  return { ok: false, status: null, stdout: "", stderr: "", error: `refused disallowed bootstrap binary: ${bin}` };
}

// Bootstrap argv comes from catalog/providers.json. Every token is bounded:
// the bin must be in SAFE_BOOTSTRAP_BINS, each argument must pass SAFE_TOKEN
// (no whitespace, no shell metacharacter), and interpreters that execute an
// inline string must not receive one — `python -c` and `node -e` are the
// shell -c equivalents that would otherwise nullify the allowlist.
const CODE_RUNNER_FLAGS: Record<string, string[]> = {
  python: ["-c", "--command"],
  py: ["-c", "--command"],
  node: ["-e", "--eval", "-p", "--print", "--repl"]
};

export function isCodeRunnerFlag(bin: string, token: string): boolean {
  const name = normalizeBin(bin).replace(/\.(exe|cmd|bat)$/i, "");
  const flags = CODE_RUNNER_FLAGS[name];
  if (!flags) return false;
  if (token.startsWith("--")) {
    const eq = token.indexOf("=");
    return flags.includes(eq > 0 ? token.slice(0, eq) : token);
  }
  // A short option may carry its value attached: -ccode, -ecode.
  if (token.startsWith("-") && token.length > 2) return flags.includes(token.slice(0, 2));
  return flags.includes(token);
}

function refusedCodeRunner(token: string): CommandResult {
  return { ok: false, status: null, stdout: "", stderr: "", error: `refused code-runner flag: ${token}` };
}

export function runScript(argv: string[]): CommandResult {
  if (argv.length === 0) return refused("");
  const [bin, ...args] = argv;
  if (!SAFE_TOKEN.test(bin)) return refused(bin);
  if (!bootstrapBinAllowed(bin)) return refusedBootstrap(bin);
  for (const arg of args) {
    if (arg.length === 0) return refused("");
    if (isCodeRunnerFlag(bin, arg)) return refusedCodeRunner(arg);
    if (!SAFE_TOKEN.test(arg)) return refused(arg);
  }
  const result = spawnSync(bin, args, { encoding: "utf8", windowsHide: true, shell: false });
  return resultFrom(result.status, result.stdout ?? "", result.stderr ?? "", result.error?.message);
}
