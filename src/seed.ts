/**
 * What gets classified when a caller sent neither categories nor a prompt.
 *
 * This lives on its own because two surfaces ask the question — the CLI
 * (`src/commands/gate.ts`, used by the plugin daemon) and the MCP gate server
 * (`mcp/novahiz-gate`). Measured 2026-10-29: fixing the rule in the CLI left the
 * MCP server on the old behaviour, so the same edit was scoped one way through
 * the plugin and another way through the tool. One rule, one place.
 *
 * The rule: a prompt always wins. A documentation file contributes no seed at
 * all, because its prose describes work instead of being the work — a changelog
 * that mentions design skills demanded eleven of them for a one-line edit.
 * Wireframes are deliberately absent from the list: `wireframes/**` is design
 * material, so its content may speak.
 */
import { globToRegExp } from "./gate.ts";

const DOCUMENTATION_GLOBS = ["**/novahiz-docs/**/*.md", "**/docs/**/*.md", "**/README.md", "**/CHANGELOG.md"];

export function isDocumentationPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return DOCUMENTATION_GLOBS.some((glob) => globToRegExp(glob).test(normalized));
}

export function seedForClassification(input: { prompt: string; content: string; paths: string[] }): string {
  if (input.prompt.length > 0) return input.prompt;
  const documentationOnly = input.paths.length > 0 && input.paths.every(isDocumentationPath);
  if (documentationOnly) return "";
  return input.content || input.paths[0] || "";
}
