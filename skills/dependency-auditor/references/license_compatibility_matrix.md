# License compatibility matrix

How the licenses your dependencies declare interact with the license your project ships under, and how `license_checker.py` applies that under each policy. Families, not individual SPDX IDs, drive the rules: two licenses in the same family behave the same way for this purpose.

## Families

| Family | Members (common) | What it asks of you |
|---|---|---|
| Permissive | MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense, Zlib | Keep the notice; you may close the source |
| Weak copyleft (file or library level) | MPL-2.0, LGPL-2.1/3.0, EPL-2.0, CDDL | Modified files or linked library changes must go back as source; the rest of your code can stay closed |
| Strong copyleft (work level) | GPL-2.0/3.0, AGPL-3.0, SSPL-1.0, OSL-3.0 | Distributing (AGPL/SSPL: also offering over a network) may oblige you to ship your combined work's source under the same terms |
| Proprietary / custom | Source-available licenses, "non-commercial" terms, Dual terms with unusual conditions | Needs human review before any use outside a scratch branch |
| Unknown | Missing, non-SPDX, "SEE LICENSE IN FILE" with no parse | Treated as a risk, never as permissive |

`license_checker.py` maps declared strings to these families with an SPDX-aware matcher first, then a keyword fallback. Anything the matcher cannot place lands in Unknown and is listed separately.

## Project license x dependency license

Rows are your project's license; columns are the dependency's family. "OK" means no obligation beyond attribution; "Notice" means ship the license text; "Review" means talk to whoever owns legal risk; "Block" means do not ship under `strict`.

| Project \ Dependency | Permissive | Weak copyleft | Strong copyleft | Unknown |
|---|---|---|---|---|
| MIT / Apache-2.0 | OK + notice | Review (LGPL linking, MPL file scope) | Block for binary distribution; GPL source obligation on distribution | Review |
| GPL-3.0 | OK + notice | Review (must remain GPL-compatible) | OK if all parts GPL-compatible; watch version and any extra terms | Review |
| Proprietary closed source | OK + notice | Review (dynamic linking may avoid modification obligations; static may not) | Block | Review |
| AGPL-3.0 service | OK + notice | Review | OK among AGPL; non-AGPL deps fine to include | Review |

Reading the table:

- "Distribution" is the hinge for GPL family licenses. Internal-only tools distribute nothing to third parties; SaaS that never ships binaries is a different analysis from shipping a desktop app.
- AGPL and SSPL change the hinge: offering the software over a network can trigger source obligations without shipping a single binary. Under `strict`, they fail regardless of project license.
- Weak copyleft obligations track the boundary you draw. Keep MPL-covered files unmodified if you can; if you modify them, publish those files. For LGPL, prefer dynamic linking and ship the library's license and a way to swap it.
- Apache-2.0 dependencies require the NOTICE file's preservation when you redistribute; most projects already do this, few check it.

## Policy levels

| Policy | Fails on | Warns on | Fits when |
|---|---|---|---|
| `strict` | strong copyleft anywhere; proprietary without review flag | weak copyleft | You ship proprietary or permissive-licensed binaries to customers |
| `permissive` (default) | strong copyleft | unknown/missing; weak copyleft in production deps | Standard SaaS or open-source project under a permissive license |
| `loose` | nothing automatically; reports everything | strong copyleft, unknown | Internal research code, with the report archived |

Run `license_checker.py --policy <level> --fail-on-conflict` in CI at the level your release process actually enforces. A policy nobody turns into a failing check is documentation, not a control.

## Special cases

| Situation | Handling |
|---|---|
| Dual license (GPL OR commercial) | Pick one and record which; the checker lists both options |
| `license-file` only, no SPDX ID | Family goes Unknown until someone reads the file once and pins the ID in the manifest |
| Vendored code with no license at all | Treat as proprietary: obtain terms or delete the vendor directory |
| Transitive dep changes family across versions | The lockfile version decides; re-run the checker after every major bump |
| Public domain dedications (CC0, Unlicense) | Permissive family; keep the text with your notices |

## Notice file hygiene

Whatever the mix, ship one aggregated notice (NOTICE, THIRD-PARTY-LICENSES, or the platform equivalent) regenerated whenever dependencies change. Regeneration belongs in the same CI job that produces the dependency inventory, so the file cannot lag the lockfile by a quarter.
