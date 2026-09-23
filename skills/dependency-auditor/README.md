# Dependency auditor toolkit

Three offline Python 3 scripts (stdlib only) that audit third-party dependencies: scan for known vulnerable version floors, check license posture, and sequence upgrades into waves. No network calls, no API keys, no install step beyond a Python interpreter.

Skill instructions and the full workflow live in `SKILL.md`. This file is the tool reference.

## Scripts

| Script | Question it answers | Primary output |
|---|---|---|
| `scripts/dep_scanner.py` | What is installed, and does any of it sit below a known fixed version? | inventory + advisory findings (JSON or text) |
| `scripts/license_checker.py` | What did we agree to when we linked these packages? | license rows, family classification, policy conflicts |
| `scripts/upgrade_planner.py` | In what order should we move, and how do we roll back? | prioritized waves with rollback notes |

They compose: scanner JSON is a valid planner input. License checking runs independently.

## dep_scanner.py

```bash
python3 scripts/dep_scanner.py .                          # text report to stdout
python3 scripts/dep_scanner.py . --format json -o scan.json
python3 scripts/dep_scanner.py . --fail-on-high           # exit 1 on high/critical
python3 scripts/dep_scanner.py . --quick-scan             # manifest entries only, skip lockfile transitive set
python3 scripts/dep_scanner.py . --ecosystems javascript,python
```

Parses eight ecosystems (see `SKILL.md`). Direct dependencies come from manifests; the full set (including transitive) comes from lockfiles when present. `--quick-scan` keeps only manifest rows for a fast pass.

Exit codes: `0` no high/critical findings (or `--fail-on-high` not set), `1` high or critical present with `--fail-on-high`, `2` bad invocation.

Scan JSON shape:

```json
{
  "root": ".",
  "generated_at": "2026-09-01T12:00:00+00:00",
  "ecosystems": {"javascript": 42, "python": 17},
  "packages": [
    {"name": "lodash", "version": "4.17.20", "ecosystem": "javascript",
     "direct": true, "source": "package.json"}
  ],
  "findings": [
    {"package": "lodash", "version": "4.17.20", "ecosystem": "javascript",
     "advisory_id": "SF-LDASH-001", "severity": "high",
     "summary": "Command injection in template compilation", "fixed_in": "4.17.21"}
  ],
  "stats": {"packages": 59, "findings": 1, "high_or_critical": 1}
}
```

The advisory table is a built-in snapshot, not a live feed. It covers a small set of high-signal issues so the script stays useful offline; pair it with `npm audit`, `pip-audit`, `cargo audit`, `govulncheck`, or `osv-scanner` for completeness.

## license_checker.py

```bash
python3 scripts/license_checker.py .
python3 scripts/license_checker.py . --policy strict --format json -o licenses.json
python3 scripts/license_checker.py . --fail-on-conflict    # exit 1 when policy fails
```

Declared licenses are read from each ecosystem's manifest (`license` fields, `<licenses>` blocks, SPDX expressions). Families: permissive, weak copyleft, strong copyleft, proprietary, unknown. `--policy` sets which families are allowed at each severity of concern; default is `permissive`. Compatibility combinations: `references/license_compatibility_matrix.md`.

Exit codes: `0` within policy, `1` policy conflicts with `--fail-on-conflict`, `2` bad invocation.

## upgrade_planner.py

```bash
python3 scripts/upgrade_planner.py scan.json
python3 scripts/upgrade_planner.py scan.json --target react=19.0.0
python3 scripts/upgrade_planner.py scan.json --risk-threshold medium --timeline 90 --format json -o plan.json
python3 scripts/upgrade_planner.py scan.json --security-only
```

Reads scanner JSON from a file or from stdin (`-`). Emits waves: security, patch, minor, major (major limited by `--timeline` days). Targets resolve in order: advisory `fixed_in`, embedded last-known-version snapshot, then `--target` (format `name=version` or `ecosystem:name=version`). Rows without target data land in an `unplanned` list rather than a invented version. `--risk-threshold` filters the tail; `--security-only` emits wave 1 alone. Each planned entry carries the current version, the target, the reason, and rollback instructions (re-pin previous version, restore lockfile from VCS, gate tests).

Exit codes: `0` plan produced, `2` unreadable or malformed input.

## Layout

```
dependency-auditor/
  SKILL.md                     workflow and judgment calls
  README.md                    this file
  scripts/                     the three tools
  references/                  triage method, license matrix, maintenance practices
  assets/                      tiny sample manifests for smoke tests
  expected_outputs/            example reports from those samples
```

## Smoke test

```bash
python3 scripts/dep_scanner.py assets --format json | python3 -m json.tool >/dev/null && echo scan-ok
python3 scripts/license_checker.py assets --format json | python3 -m json.tool >/dev/null && echo license-ok
python3 scripts/dep_scanner.py assets --format json | python3 scripts/upgrade_planner.py - --format json >/dev/null && echo plan-ok
```

All three should print their `-ok` line. `python3 -m py_compile scripts/*.py` must pass before any change ships.
