import { existsSync } from "node:fs";
import { join } from "node:path";

// Impeccable context resolution, shared by `novahiz init` and `doctor` so the
// two can never drift (the same lesson as the Claude hooks predicate).
// Resolution order per impeccable.style/docs/context: root, then
// .agents/context/, then docs/ — first location that contains the file.
// PRODUCT.md and DESIGN.md resolve independently of each other.
const CONTEXT_DIRS = ["", ".agents/context", "docs"] as const;

/** Absolute path of `name` (`PRODUCT.md`/`DESIGN.md`) under `cwd`, or null. */
export function findContextFile(cwd: string, name: string): string | null {
  for (const dir of CONTEXT_DIRS) {
    const candidate = dir === "" ? join(cwd, name) : join(cwd, dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
