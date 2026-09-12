# Novahiz Constitution

## Core Principles

### I. Deterministic by Construction
The same prompt and the same rule set must always produce the same result. Every classification and gate decision runs in code, with no model vote, no random sampling, and no hidden state.
- Classification, gating, and roadmap selection are pure functions of the prompt, the catalog, the rules, and the loaded skills.
- Catalog ranking uses a deterministic lexical score. No embeddings, no sampling.
- A feature that cannot be made deterministic is rejected or isolated behind an explicit opt-in.
Rationale: the value of the tool is that enforcement is predictable and reproducible. A model judgement inside the decision path breaks that contract.

### II. No Runtime Dependencies
The shipped runtime relies only on the Node standard library and `node:sqlite`. No third-party runtime package is allowed.
- No new `dependencies` in `package.json`. Dev-only tooling (TypeScript, types, test helpers) is permitted, and pinned.
- Node 22.18 is the floor, because the sources run through type stripping.
- A need that would pull in a native or remote dependency gets a design change, not a dependency.
Rationale: auditability and simple installation. The tool is meant to be read and trusted end to end.

### III. Enforce Before Writing
The gate blocks file mutations until the skills required by the prompt's category are loaded. Advice that can be ignored is not enforcement.
- `edit`, `write`, `patch`, `apply_patch`, and shell writes are gated. Read-only tools are not.
- Rules are content-aware: `humanizer` is required only for prose, `impeccable` only for interface and style.
- A block states what is missing and why. A silent or unexplained block counts as a bug.
Rationale: the tool exists to make quality gates unavoidable. A gate that can be waved through is theatre.

### IV. Harness-Agnostic Core
All decision logic lives in the CLI and the MCP surface. Adapters stay thin.
- No harness-specific logic appears in the core modules. opencode is the only adapter today.
- An adapter may classify input, call the CLI, and translate the result into that harness's hook contract. Nothing more.
- A new harness is added by writing an adapter, never by branching the core.
Rationale: one rule set governs every harness. Duplicated logic drifts, and a drifted guarantee is no guarantee.

### V. Tested and Non-Destructive
Every core capability has a test, and the installer never removes user data.
- `tsc --noEmit` returns 0 and the full test suite passes before any commit.
- The installer copies and backfills. It never deletes a file. Machine-specific state (`novahiz.config.json`, the SQLite database) stays local and out of version control.
- A change that cannot be confirmed by a test is described as unverified, never claimed as done.
Rationale: the enforcement promise is only as strong as the evidence behind it. Verifiable behavior is the product.

## Additional Constraints

- Versioned configuration is code. Changes to `catalog/categories.json`, `catalog/rules.json`, and `catalog/overrides.json` go through review like source.
- The published package ships `src`, `adapters`, `catalog`, `install`, `bin`, `mcp`, `skills`, `docs`, `tsconfig.json`, `README.md`, `NOTICE.md`, `novahiz.config.example.json`, and `LICENSE`. It never carries secrets, the local database, or machine-specific config.
- License is Apache-2.0. The source is public. Anything derived from bundled third-party skills keeps its own attribution.

## Development Workflow

- Run `npx tsc --noEmit` and `node --test` locally. Both must be green before a commit.
- Dogfood the rules. Load `humanizer` for prose changes and `impeccable` for interface changes, because the gate requires it of everyone.
- Commit messages describe the behavior change, not the file touched.
- Before 1.0 the public interface may move. Such changes are called out in the commit and, when relevant, in the README.

## Governance

- This constitution supersedes other practices. When a habit conflicts with a principle, the principle wins, or the principle is amended. It is never worked around.
- An amendment requires a written rationale, a version bump under the policy below, and a Sync Impact Report at the top of this file stating what changed and what it affects.
- Versioning: MAJOR for a backward-incompatible removal or redefinition of a principle; MINOR for a new principle or section; PATCH for clarifications and wording.
- Compliance is checked on every pull request. Reviewers confirm that the change respects the principles, that tests were run, and that no runtime dependency slipped in.

**Version**: 1.0.0 | **Ratified**: 2026-09-11 | **Last Amended**: 2026-09-11
