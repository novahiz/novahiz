---
name: "package-risk-audit"
description: "Dependency and supply-chain risk audit: lockfiles, typosquat and dependency confusion checks, OSV/CVE triage, license exposure, SBOM generation, update policy. Use when adding a package, reviewing package.json/pnpm-lock/Cargo.lock/go.mod, investigating a CVE, or preparing a release BOM."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# package-risk-audit

Decide whether a dependency is safe to take, keep, or drop. Aligns with OWASP Top 10 2025 A03 (software supply chain failures) and OSSF package-manager practice.

## Intake (new package)

1. Exact name and registry; prefer official source over mirrors.
2. Why this package beats a small in-repo implementation (cost of ownership).
3. Repo health: maintainers, release cadence, open critical issues, OpenSSF Scorecard if available.
4. Transitive size: what it pulls in; `deps.dev` or lockfile graph.
5. License compatible with the product license.
6. Pin strategy: exact version or lockfile hash; no floating `latest`.

Reject or quarantine when: brand-new account, name within Levenshtein distance of a popular package with no clear link, install scripts that fetch remote binaries, or maintainers you cannot map to a known org.

## Typosquat and confusion

- Compare the name to the intended package (edit distance, homoglyphs, extra suffixes like `-utils`, `-pro`).
- Scope private packages (`@yorg/...`) so npm cannot silently resolve them from the public registry.
- Disable “merge with upstream” on internal proxies; fail the build on 404 instead of falling back to public.
- Claim the org name on public registries even if you only publish privately.

Confusion attacks are mostly semantic; typos are only one mechanism. A rename that swaps one word (`discord.js` vs `discord.dll`) is a real flag.

## Vulnerability triage

| Source | Use |
|---|---|
| OSV / GitHub Advisory | Primary advisory query per ecosystem |
| NVD CVE | When OSV is thin for a stack |
| OSSF malicious-packages | Known malicious publishes |

For each hit:

1. Is the package actually reachable in your build (not dev-only, not optional unused)?
2. Fixed version available? Semver-compatible?
3. Exploitability in your call path (not only CVSS).
4. Action: upgrade, patch pin, replace, or document accepted risk with an owner and review date.

Do not mass-upgrade majors in the same PR as product changes.

## Lockfile and reproducibility

- Commit the lockfile; CI installs frozen/`--frozen-lockfile`/`cargo build --locked` style.
- Prefer hash pinning the manager already stores; treat lockfile diffs as security-relevant.
- Remove unused deps on a schedule (`npm prune`, `cargo machete` equivalent, `go mod tidy`).
- Build images and artifacts from the lockfile, not from a developer’s global cache.

## SBOM and inventory

Generate a CycloneDX or SPDX SBOM on release (and on demand for customers). Contents: direct and transitive components, versions, licenses, purls. Store next to the artifact. Diff SBOMs between releases to spot unexpected new packages.

## Update policy

- Critical/high with fix: same week (or documented exception).
- Dependabot/Renovate (or equivalent) with security alerts on.
- Staged rollout when the vendor is new to you; canary before fleet-wide.
- Unmaintained dependency with no fix: plan a replacement; virtual patch only buys time.

## Checklist

- [ ] Name and registry verified; scope confusion impossible.
- [ ] Lockfile present, committed, enforced in CI.
- [ ] OSV/advisory scan clean or triaged with owners.
- [ ] License recorded in SBOM; copyleft OK for ship context.
- [ ] Install scripts reviewed or disabled.
- [ ] Transitive graph understood for the new package.
- [ ] Update bot and alert channel configured.

## Sources

OWASP Top 10 2025 A03; OSSF package-manager best practices (npm and peers); OSV schema and OSSF malicious-packages; ConfuGuard / Neupane package-confusion research. Original Novahiz synthesis.
