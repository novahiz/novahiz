/**
 * Verifiable documentation claims.
 *
 * A doc sentence is only worth what proves it. `SOURCES.md` claimed "5 low
 * contrast pairs" that were measurement artefacts, and `PRODUCT.md` promised a
 * dark theme the stylesheet had removed — both stayed true in prose for weeks
 * because nothing replayed them.
 *
 * The contract is one comment:
 *
 *   - Le projet compile. <!-- verify: typecheck -->
 *   - La migration est appliquée. <!-- verify: catalogue expect="favoris" -->
 *
 * `verify` names a command declared in the project's `.novahiz/verify.json`, so
 * documentation can never smuggle in its own shell.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export type DocClaim = {
  file: string;
  line: number;
  verify: string;
  expect?: string;
  /** The sentence the marker annotates, trimmed and bounded. */
  text: string;
};

const CLAIM = /<!--\s*verify:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:\s+expect="([^"]*)")?\s*-->/g;

export function findClaims(file: string, raw: string): DocClaim[] {
  const claims: DocClaim[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    CLAIM.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CLAIM.exec(line)) !== null) {
      const inline = line.replace(match[0], "").trim();
      const text = inline.length > 0 ? inline : (lines.slice(index + 1).find((entry) => entry.trim().length > 0) ?? "").trim();
      claims.push({
        file,
        line: index + 1,
        verify: match[1],
        ...(match[2] !== undefined ? { expect: match[2] } : {}),
        text: text.replace(/^[-*]\s*/, "").slice(0, 180),
      });
    }
  }
  return claims;
}

export const DEFAULT_DOC_FILES = ["PRODUCT.md", "DESIGN.md", "SOURCES.md", "README.md"];

/** Claims of the given files, or of the default doc set plus novahiz-docs/. */
export function collectClaims(projectRoot: string, files?: string[]): DocClaim[] {
  const targets: string[] = [];
  if (files && files.length > 0) {
    targets.push(...files);
  } else {
    for (const name of DEFAULT_DOC_FILES) if (existsSync(join(projectRoot, name))) targets.push(name);
    const docsDir = join(projectRoot, "novahiz-docs");
    if (existsSync(docsDir)) {
      for (const name of readdirSync(docsDir).filter((entry) => entry.endsWith(".md"))) {
        targets.push(join("novahiz-docs", name));
      }
    }
  }
  const claims: DocClaim[] = [];
  for (const target of targets) {
    const absolute = join(projectRoot, target);
    if (!existsSync(absolute)) continue;
    let raw = "";
    try {
      raw = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    claims.push(...findClaims(relative(projectRoot, absolute).replace(/\\/g, "/"), raw));
  }
  return claims;
}
