import { spawnSync } from "node:child_process";

// Allowed characters for a single argument. It excludes every character a shell
// can reinterpret: whitespace, & | < > ^ % ! ( ) " ' ` ; $ * ? and newlines.
// The Windows branch below joins tokens with spaces and hands the result to
// cmd.exe, so widening this set would re-open command injection on that path.
const SAFE_TOKEN = /^[A-Za-z0-9@._+,/:=~-]+$/;

export type CommandResult = {
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

// Bootstrap may only start a known interpreter or packager. Arguments stay
// unvalidated on purpose (a legitimate argument is sometimes a whole shell
// command line), so the binary itself is what gets bounded here.
const SAFE_BOOTSTRAP_BINS = new Set([
  "node", "npm", "npx", "uv", "uvx", "sh", "bash", "pwsh", "powershell", "cmd", "cmd.exe", "python", "py"
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

// Bootstrap argv is trusted: it comes from catalog/providers.json, which ships
// inside the repository. Arguments stay unvalidated on purpose, because a
// legitimate argument can be a whole shell command line (for example
// `sh -c "curl ... | sh"`) that must reach its interpreter as one unparsed
// token. The binary itself is bounded to SAFE_BOOTSTRAP_BINS, so editing the
// registry to point `bin` at an arbitrary executable is refused.
export function runScript(argv: string[]): CommandResult {
  if (argv.length === 0) return refused("");
  const [bin, ...args] = argv;
  if (!SAFE_TOKEN.test(bin)) return refused(bin);
  if (!bootstrapBinAllowed(bin)) return refusedBootstrap(bin);
  const result = spawnSync(bin, args, { encoding: "utf8", windowsHide: true, shell: false });
  return resultFrom(result.status, result.stdout ?? "", result.stderr ?? "", result.error?.message);
}
