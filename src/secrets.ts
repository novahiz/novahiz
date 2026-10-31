/**
 * Secret leakage scan for session artefacts.
 *
 * The dev server printed `seConnecter("user@example.com", "password")` on every
 * login during a session: the credential was in a log file, not in the repo, so
 * no pre-commit hook would ever see it. This scans the places a session writes —
 * logs, tmp/, recorded evidence — and reports matches with the value masked.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

export type SecretKind =
  | "password-assignment"
  | "bearer-token"
  | "jwt"
  | "api-key"
  | "connection-string";

export type SecretFinding = {
  kind: SecretKind;
  file: string;
  line: number;
  /** Match with the sensitive value masked. Safe to display. */
  excerpt: string;
};

type Rule = { kind: SecretKind; pattern: RegExp; mask: (match: string) => string };

function maskValue(value: string): string {
  if (value.length <= 4) return "***";
  return `${value.slice(0, 3)}***`;
}

const RULES: Rule[] = [
  {
    kind: "password-assignment",
    // password=..., motDePasse: "...", passwd = '...' — but not an empty value
    // and not an obvious placeholder.
    pattern: /\b(password|passwd|mot[_-]?de[_-]?passe)\b\s*[:=]\s*["']?([^\s"',;)]{3,})/gi,
    mask: (match) => match.replace(/([:=]\s*["']?)([^\s"',;)]{3,})/i, (_all, prefix: string, value: string) => `${prefix}${maskValue(value)}`),
  },
  {
    kind: "bearer-token",
    pattern: /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/g,
    mask: (match) => match.replace(/(Bearer\s+)(\S+)/, (_all, prefix: string, value: string) => `${prefix}${maskValue(value)}`),
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    mask: (match) => `${match.slice(0, 6)}***`,
  },
  {
    kind: "api-key",
    pattern: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{12,}|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}|\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    mask: (match) => maskValue(match),
  },
  {
    kind: "connection-string",
    pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@/gi,
    mask: (match) => match.replace(/:([^:@/]+)@/, (_all, value: string) => `:${maskValue(value)}@`),
  },
];

const PLACEHOLDER = /^(x+|\*+|changeme|placeholder|todo|redacted|example|secret|password|pass)$/i;

/** Scan one text blob. Returns findings with the secret masked. */
export function scanText(text: string, file = "<memory>"): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line)) !== null) {
        const raw = match[2] ?? match[1] ?? match[0];
        if (PLACEHOLDER.test(raw)) continue;
        findings.push({
          kind: rule.kind,
          file,
          line: index + 1,
          excerpt: rule.mask(match[0]).slice(0, 200),
        });
      }
    }
  }
  return findings;
}

const TEXT_EXTENSIONS = new Set([".log", ".txt", ".json", ".jsonl", ".md", ".env", ".out", ".err", ""]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Scan the files a session typically writes. Read-only. */
export function scanPaths(root: string, targets: string[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const walk = (path: string): void => {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      let entries: string[] = [];
      try {
        entries = readdirSync(path);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (["node_modules", ".git", ".next"].includes(entry)) continue;
        walk(join(path, entry));
      }
      return;
    }
    const extension = extname(path).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) return;
    if (stat.size > MAX_FILE_BYTES) return;
    let raw = "";
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return;
    }
    findings.push(...scanText(raw, relative(root, path).replace(/\\/g, "/")));
  };
  for (const target of targets) {
    const absolute = join(root, target);
    if (existsSync(absolute)) walk(absolute);
  }
  return findings;
}

/** Default artefacts to inspect: logs, tmp, recorded evidence. */
export const DEFAULT_SCAN_TARGETS = ["tmp", "logs", ".novahiz/evidence", "dev-server.log", ".env.local"];
