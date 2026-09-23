---
name: dependency-auditor
description: "Audit and manage dependencies across multi-language projects. Identifies vulnerabilities, license conflicts, transitive dependency risks, and safe-upgrade paths. Use when auditing third-party packages before release, investigating a CVE, planning a major version bump, or running a license-compliance review. Examples: 'audit our npm dependencies', 'do we have GPL contamination', 'plan the upgrade to React 19'."
license: Apache-2.0
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Auditing third-party dependencies

Every package you import inherits someone else's bug surface, someone else's license, and someone else's release cadence. This skill gives you an offline pass over manifests and lockfiles: what is installed, which of it matches known vulnerable version floors, what licenses mix badly with yours, and in what order upgrades should land.

The three scripts talk to no network. They parse eight ecosystems, match a built-in advisory snapshot, and emit JSON you can archive in CI. For live CVE coverage, run the native tool of each ecosystem alongside them (`npm audit`, `pip-audit`, `cargo audit`, `govulncheck`, `osv-scanner`). Model and dataset supply chain stays in `ai-security`. Runtime secret handling stays in `env-secrets-manager`.

## Quick start

```bash
# 1. Inventory + known-vulnerability pass (exit 1 when high/critical appear)
python3 scripts/dep_scanner.py /path/to/project --format json --fail-on-high -o scan.json

# 2. License inventory and conflicts against your policy
python3 scripts/license_checker.py /path/to/project --policy strict --format json -o licenses.json

# 3. Upgrade waves derived from the scanner output
python3 scripts/upgrade_planner.py scan.json --risk-threshold medium --timeline 90 -o plan.json
```

What each artifact is for: `scan.json` lists packages and advisory hits (pin or patch those first); `licenses.json` separates legal risk from technical risk; `plan.json` sequences the remaining work into waves with rollback notes. After applying upgrades, re-run step 1 and require zero high or critical findings before you call the audit closed.

## Ecosystems the scanner parses

| Ecosystem | Manifests | Lockfiles |
|---|---|---|
| JavaScript / Node | package.json | package-lock.json, yarn.lock |
| Python | requirements.txt, pyproject.toml | poetry.lock, Pipfile.lock |
| Go | go.mod | go.sum (checksums only) |
| Rust | Cargo.toml | Cargo.lock |
| Ruby | Gemfile | Gemfile.lock |
| Java | pom.xml, build.gradle | gradle.lockfile |
| PHP | composer.json | composer.lock |
| .NET | *.csproj, packages.config | packages.lock.json |

Lockfile entries win over manifest ranges when both exist: the lockfile is what will actually install. Manifest-only ranges are still worth reporting because they describe what a fresh resolve could pull.

## What the scanner flags

The built-in advisory set is a curated snapshot of version floors for well-known issues (prototype pollution in `lodash`, deserialization in `PyYAML`, log4shell in `log4j-core`, and similar). Each hit records advisory ID, severity, installed version, and the fixed version.

Treat a hit as a question, not a verdict, then answer it with reachability:

1. Is the vulnerable module even loaded by your process? A CLI-only utility inside a server image rarely is.
2. Is the vulnerable function reachable from your inputs? Grep for the entry point named in the advisory.
3. Is a fixed version within the same major? Patch releases are the cheap path; cross-major jumps need the planner.
4. If you cannot patch today, write the mitigation (config flag, WAF rule, feature disable) into the audit note with an owner and a date.

Severity here comes from the advisory snapshot. Cross-check CVSS vector details, CISA KEV presence, and EPSS scores with live tooling before you escalate or stand down.

## License checks

`license_checker.py` reads declared licenses (SPDX IDs where manifests use them), classifies each into a family, and tests combinations against a policy:

| Policy | Allows | Warns | Fails |
|---|---|---|---|
| `strict` | permissive only (MIT, Apache-2.0, BSD, ISC, MPL-2.0 in file-level use) | weak copyleft at review | strong copyleft (GPL, AGPL, SSPL) anywhere in the graph |
| `permissive` (default) | permissive + weak copyleft with notice | unknown or missing license | strong copyleft |
| `loose` | everything except AGPL/SSPL | strong copyleft | proprietary terms you did not review |

Declared-but-missing licenses are a finding of their own: an undeclared license is not a permissive license. `references/license_compatibility_matrix.md` has the combination table; `references/vulnerability_assessment_guide.md` has the triage method.

## Upgrade planning

`upgrade_planner.py` reads `scan.json` and sorts work into waves:

1. Security wave. Advisory hits with a fixed version available, highest severity first.
2. Patch wave. Everything with a same-major patch bump, grouped per ecosystem so you get one lockfile commit per stack.
3. Minor wave. Additive upgrades, still grouped.
4. Major wave. Cross-major jumps that fit inside `--timeline` days; the rest spill to the next cycle.

Targets come from three sources: advisory `fixed_in` values, an embedded last-known-version snapshot for common packages, and explicit `--target name=version` flags (add `ecosystem:` prefix when names collide). Packages with no target data are listed under `unplanned` instead of being guessed.

Flags: `--risk-threshold` (`low|medium|high`) drops low-stakes non-security rows; `--security-only` keeps wave 1; `--timeline` sets the day budget. Every wave entry carries rollback notes (previous version to re-pin, lockfile to restore, tests that gate the next wave).

## Workflow

1. Scan. Pick the project root; the scanner auto-detects ecosystems. Keep the JSON.
2. Separate findings. Advisory hits go to engineering; license conflicts go to whoever owns legal risk; undeclared licenses go back to the author of the manifest.
3. Triage with reachability (above). Mark each hit `patch`, `mitigate`, or `accept` with reasoning.
4. Plan. Feed the scan JSON to the planner; adjust waves to your release calendar.
5. Apply and verify. Upgrade one wave at a time, run the ecosystem's test suite, re-scan, require the count of high+critical to hit zero.
6. Record. Archive `scan.json`, `licenses.json`, and `plan.json` next to the release that closed the audit.

## Report shape

```markdown
# Dependency audit: <project> (<date>)

## Inventory
Ecosystems seen, package counts, direct vs transitive split.

## Advisory findings
| Package | Installed | Fixed | Severity | Decision (patch/mitigate/accept) | Owner |

## License posture
Policy applied, conflicts, unknowns, action list for legal review.

## Upgrade waves
Wave, contents, target date, rollback reference.

## Verification
Command re-run after upgrades, resulting high/critical count (must be 0).
```
