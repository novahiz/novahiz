# Dependency maintenance practices

Habits that keep the audit numbers from climbing back the day after you close them. Organized by the four moments where dependency decisions actually happen: selection, pinning, upgrade, and removal.

## Selection

- Prefer packages whose age and release cadence you can live with. A library with three maintainers and no release in two years is a future fork, not a dependency.
- Check the ecosystem advisory history before the first merge: has this package been the epicenter of a serious issue, and how fast did they ship the fix?
- Read the transitive footprint. `npm ls --all` or `cargo tree` on a candidate often shows fifty packages you did not choose. Budget for that.
- For anything that parses untrusted input (markdown, HTML, XML, images, archives, templates), the bar for "small, audited, actively patched" goes up, not down.
- Standardize per ecosystem. Two HTTP clients and three date libraries multiply the audit surface for no user benefit.

## Pinning and lockfiles

| Mechanism | Commit it? | Why |
|---|---|---|
| Application lockfile (package-lock.json, poetry.lock, Cargo.lock, go.sum, composer.lock, Gemfile.lock, gradle.lockfile) | yes | Reproducible installs are the precondition for every other check |
| Library manifest ranges (`^`, `~`, compatible ranges) | yes, ranges in manifest | Library consumers need room to deduplicate; your library's lockfile still pins CI |
| Exact pins in applications (`==`, no caret) in the manifest itself | optional | Belt and braces when lockfiles are ignored by a platform (some serverless builders) |
| Internal shared packages | exact or tilde ranges + publish pipeline | You control the cadence; floating ranges just hide who broke the build |

Rules that follow: installs in CI use `--frozen-lockfile` / `--locked` / `- lockfile` equivalents so a drifted lockfile fails loudly; direct and transitive versions never get hand-edited in the lockfile (edit the manifest and re-resolve); the lockfile and the manifest always land in the same commit.

## Upgrades

- Cadence over heroics. A weekly automated batch of patch and minor upgrades keeps each diff reviewable; quarterly fire drills do not.
- Route automation (Dependabot, Renovate, or equivalent) through one PR per ecosystem per week, with tests and the scanner as required checks. Auto-merge only patch-level updates whose CI is green and whose advisory count does not increase.
- Separate security from chore. An advisory hit jumps the queue and may bypass the batch window; everything else waits for its slot.
- Majors get the planner: `upgrade_planner.py` waves, a named owner, a migration checklist from the upstream changelog, and a rollback tag before merge.
- One wave per PR. Mixing a major bump with unrelated updates destroys the bisect path when something breaks.
- Read the changelog of the first minor you skip, not just the target version. Skipping five minors means five sets of deprecations.

## Transitive risk

- Direct-dep policies do not reach the tree. A clean `package.json` with a vulnerable hoisted leaf still ships the leaf.
- Use the ecosystem's override mechanism (`overrides` / `resolutions`, `pip` constraints, `[patch]` in Cargo) to force a fixed transitive version when upstream has not moved. Record the override with a comment referencing the advisory; delete it when the parent upgrades.
- Watch for dependency confusion on private package names: internal registries must be scoped so public names cannot shadow them.
- Periodically count the tree. A slow climb in transitive count with no feature change usually means a utility dependency grew its own dependency graph; consider a smaller alternative.

## Removal

Uninstalling is an upgrade with zero risk. Inventory what has not been imported in months (bundle analysis, import graphs, dead-code detection), remove it, re-run the scanner, and watch the package count drop. Same audit discipline applies to devDependencies and build plugins; they execute on your machines too.

## Evidence to keep

Each closed audit leaves three files next to the release: the scan JSON, the license report, and the upgrade plan with completion marks. Together they answer, months later, what was known, what was decided, and who owned the decision. Store them where the next person on call will actually look.
