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
  const shell = process.env.ComSpec ?? "cmd.exe";
  return [shell, ["/d", "/s", "/c", [bin, ...args].join(" ")]];
}

// Bootstrap argv is trusted: it comes from catalog/providers.json, which ships
// inside the repository. Only `bin` is checked, because a legitimate argument can
// be a whole shell command line (for example `sh -c "curl ... | sh"`) that must
// reach its interpreter as one unparsed token. Do not call this with untrusted input.
export function runScript(argv: string[]): CommandResult {
  if (argv.length === 0) return refused("");
  const [bin, ...args] = argv;
  if (!SAFE_TOKEN.test(bin)) return refused(bin);
  const result = spawnSync(bin, args, { encoding: "utf8", windowsHide: true, shell: false });
  return resultFrom(result.status, result.stdout ?? "", result.stderr ?? "", result.error?.message);
}
