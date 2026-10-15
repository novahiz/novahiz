# Product context — Novahiz

Captured for `impeccable` (`/impeccable init`).
Sources: `README.md`, `docs/CONSTITUTION.md`, `CHANGELOG.md`, `package.json`.
Anything those files do not settle is marked *not determined* rather than
guessed — this record is meant to be checkable line by line.

## Audience

- **Operators of AI coding agents** running the `opencode` harness. That is the
  only adapter shipped today (`docs/CONSTITUTION.md`, principle IV), and the
  one-line install targets their machine (`npm install -g --allow-scripts=novahiz novahiz`).
- **The agent itself**, as the immediate consumer: it receives the
  classification, the roadmap checklist, and the gate verdict inside the
  session, and acts on them.
- **Not addressed today:** any other harness. The constitution states "opencode
  is the only adapter today" and requires a new harness to arrive as an
  adapter, never as a branch of the core.

## What the product does

Novahiz is an application layer for AI coding agents. Per `README.md` it
classifies prompts, assigns an execution roadmap, blocks unsafe edits until the
right skills are loaded, and persists decisions across sessions —
deterministically, with no model call.

A session runs: classify (17 categories, up to three per prompt, with a
confidence level and a `trivial` / `lite` / `full` tier) → roadmap (the primary
category selects an ordered checklist) → gate on every write → verification →
memory.

## Goals — what "working" means

1. **Predictable enforcement.** The same prompt against the same rule set
   always yields the same result; classification, gating and roadmap selection
   are pure functions of the prompt, the catalog, the rules and the loaded
   skills.
2. **Unavoidable quality gates.** Every mutation is checked before it lands.
   "Advice that can be ignored is not enforcement."
3. **Explainable blocks.** A block names exactly which skills are missing and
   the retry rule. A silent or unexplained block counts as a bug.
4. **Auditable by reading.** The tool is meant to be read and trusted end to
   end: standard library only, no third-party runtime code.
5. **Decisions survive the session.** Rationale, root causes and next steps
   persist through the memory layer so the next session starts informed.

## Constraints

From `docs/CONSTITUTION.md` (the binding list):

- **I. Deterministic by construction** — no model vote, no random sampling, no
  hidden state in the decision path; catalog ranking is a deterministic lexical
  score with no embeddings. A feature that cannot be made deterministic is
  rejected or isolated behind an explicit opt-in.
- **II. No runtime dependencies** — Node standard library plus `node:sqlite`
  only; no new `dependencies` in `package.json`. Dev tooling is allowed but
  pinned. Node 22.18 is the floor. A need that would pull a native or remote
  dependency gets a design change instead.
- **III. Enforce before writing** — `edit`, `write`, `patch`, `apply_patch` and
  shell writes are gated; read-only tools are not.
- **IV. Harness-agnostic core** — decision logic lives in the CLI and MCP
  surface; adapters stay thin.
- **V. Tested and non-destructive** — `tsc --noEmit` returns 0 and the full
  suite passes before any commit; the installer copies and backfills, never
  deletes; machine-specific state (`novahiz.config.json`, the SQLite database)
  stays out of version control. A change no test confirms is reported as
  unverified, never as done.
- **Versioned configuration is code** — `catalog/categories.json`,
  `catalog/rules.json` and `catalog/overrides.json` change through review like
  source.
- **The published package** ships `src`, `adapters`, `catalog`, `install`,
  `bin`, `mcp`, `skills`, `docs`, `tsconfig.json`, `README.md`, `NOTICE.md`,
  `CHANGELOG.md`, `LICENSES.md`, `docs/CREDENTIALS.md`,
  `novahiz.config.example.json` and `LICENSE`, and never carries secrets, the
  local database, or machine-specific config.
- **License** Apache-2.0; third-party derived material keeps its attribution.

## Distribution and support

- Published on npm; a tag `v*` triggers `.github/workflows/release.yml`, which
  runs the test suite and publishes with provenance. Releases are never
  published by hand from a workstation.
- Documentation lives in `docs/` (one file per subsystem: `GATE.md`,
  `RULES.md`, `ROADMAPS.md`, `PROVIDERS.md`, `ARCHITECTURE.md`, `CLI.md`, …).

## Not determined

- Commercial model, pricing, or any distribution channel beyond npm — no source
  for this exists in the repository.
- Audience outside the `opencode` harness — explicitly unsupported today.
- Release cadence or roadmap commitments beyond what `CHANGELOG.md` records.
- Whether `PRODUCT.md`/`DESIGN.md` themselves should ship in the npm tarball
  (`package.json.files` does not list them); doctor skips both rows when run
  from the Novahiz home, so they are not needed there.
