/**
 * Scoped git commit.
 *
 * `git commit` (no pathspec) publishes everything already in the index, not
 * only what the caller staged. In a worktree shared with another session that
 * turned a clean 8-file commit into a 12-file one: four route renames staged by
 * somebody else rode along. This module commits an explicit list of paths and
 * verifies afterwards that nothing else entered the commit.
 */
import { spawnSync } from "node:child_process";

export type ScopedCommitResult = {
  ok: boolean;
  hash: string | null;
  committed: string[];
  /** Files staged before the commit that were left untouched (other sessions). */
  leftStaged: string[];
  error?: string;
};

function git(root: string, args: string[]): { ok: boolean; out: string; err: string } {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim(),
  };
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, "/"));
}

/**
 * The paths a commit is allowed to contain.
 *
 * A directory argument legitimately pulls in everything under it; comparing the
 * commit against the literal arguments flagged that expansion as an intrusion
 * (measured 2026-10-29: `--files wireframes/controle-de-theme` reported the two
 * files it had just committed as "not requested").
 */
function expandWanted(root: string, files: string[]): Set<string> {
  const wanted = new Set<string>();
  for (const file of files) {
    wanted.add(file);
    const listed = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--", file]);
    if (!listed.ok) continue;
    for (const entry of lines(listed.out)) {
      if (entry === file || entry.startsWith(`${file}/`)) wanted.add(entry);
    }
  }
  return wanted;
}

export function scopedCommit(
  projectRoot: string,
  input: { message: string; files: string[] },
): ScopedCommitResult {
  const message = input.message.trim();
  if (message.length === 0) {
    return { ok: false, hash: null, committed: [], leftStaged: [], error: "commit message is empty" };
  }
  const files = [...new Set(input.files.map((file) => file.trim()).filter(Boolean))];
  if (files.length === 0) {
    return { ok: false, hash: null, committed: [], leftStaged: [], error: "no files to commit" };
  }

  const toplevel = git(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (!toplevel.ok) {
    return { ok: false, hash: null, committed: [], leftStaged: [], error: `not a git repository: ${toplevel.err}` };
  }
  const root = toplevel.out;

  const stagedBefore = lines(git(root, ["diff", "--cached", "--name-only"]).out);
  const wanted = expandWanted(root, files);
  const leftStaged = stagedBefore.filter((file) => !wanted.has(file));

  const add = git(root, ["add", "--", ...files]);
  if (!add.ok) {
    return { ok: false, hash: null, committed: [], leftStaged, error: `git add failed: ${add.err}` };
  }

  // Pathspec form: only these paths enter the commit, whatever else is staged.
  const commit = git(root, ["commit", "-m", message, "--", ...files]);
  if (!commit.ok) {
    return { ok: false, hash: null, committed: [], leftStaged, error: `git commit failed: ${commit.err || commit.out}` };
  }

  const hash = git(root, ["rev-parse", "--short", "HEAD"]).out || null;
  const committed = lines(git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]).out);
  const intrusion = committed.filter((file) => !wanted.has(file));
  if (intrusion.length > 0) {
    // The pathspec should make this impossible; if it ever happens, say it
    // plainly instead of reporting a clean commit.
    return {
      ok: false,
      hash,
      committed,
      leftStaged,
      error: `commit ${hash} contains files that were not requested: ${intrusion.join(", ")}`,
    };
  }

  return { ok: true, hash, committed, leftStaged };
}
