---
name: novahiz-release
description: novahiz-release runs the versioned release process — CHANGELOG entry, npm version bump, git tag, GitHub Actions publish with provenance, post-release resync of repo→home→plugins. Triggers on "release", "cut a release", "publish the version", "bump the version", "tag a version", "new version", "changelog entry".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-release

Ship a new Novahiz version. The publish itself is done by GitHub Actions
(`.github/workflows/release.yml`) when a `v*` tag is pushed — never by hand.

## When to run

When the user asks to "release", "cut a release", "publish the version",
"bump the version", or "tag a version". Also at the end of a batch of
changes that the user wants shipped.

Do not run it to ship an unverified tree: a release that fails its tests in
CI is a public failure. Run the verification first.

## Process

1. **Verify the tree.** `npm test` and `node scripts/ci-local.mjs` must both
   be green, and `git status` must show no unintended changes.
2. **CHANGELOG.** Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`
   (Keep a Changelog format: Added / Changed / Fixed / Removed). The section
   must describe what actually changed, not planned work.
3. **Bump.** `npm version X.Y.Z --no-git-tag-version` — this edits
   `package.json` only; it must NOT create a commit or tag by itself.
4. **Commit and tag.** One commit for the bump + changelog, then
   `git tag vX.Y.Z` on that commit.
5. **Push.** `git push origin main` and `git tag vX.Y.Z`. Pushing the tag
   triggers `release.yml`: tests run, then `npm publish --provenance
   --access public` with the `NPM_TOKEN` secret. **Never run `npm publish`
   by hand** — the manual command in `docs/INSTALL.md` is an escape hatch
   for registry emergencies only.
6. **Resync local copies.** `node install/install.mjs --yes` pushes the
   release repo → `~/.config/novahiz` → `~/.config/opencode` (plugin copy).
   Propagation of the published package back through npx caches takes
   ~40 min; that lag is normal, not an incident.
7. **Confirm.** `node src/cli.ts doctor` green after the resync, and the
   three plugin copies (repo, home, `~/.config/opencode/plugins`) share the
   same hash.

## Rules

- **No push, no tag, no publish without an explicit user request.** Preparing
  steps 1-3 is fine; step 4 onward waits for the user.
- Version follows semver. The tag format is `vX.Y.Z`, matching the
  CHANGELOG heading and `package.json` version exactly.
- One release = one tag. If CI fails on the tag, fix forward with a new
  version — never delete and re-push a published tag.
- Never mix unrelated changes into the release commit: a release must be
  revertable as a single unit.
