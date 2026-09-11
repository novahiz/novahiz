# Novahiz — Project Memory

## What works
- Core (catalog, classifier, gate, roadmap, enforcement ledger), MCP server, opencode adapter, and installer are implemented and covered by tests.
- Token economy: `tool.execute.after` trimming, stale-read dedup, optional output cap; `novahiz tokens [--format text] [--calibrate]` reports savings. Verified live (8999 tokens on one read, byte counts recorded).
- Shared Obsidian config at `~/.config/obsidian-wiki/config` (`OBSIDIAN_VAULT_PATH`), read by every harness that follows the resolution protocol.

## What changed (key files)
- `catalog/providers.json`, `tests/providers.test.ts`, `tests/deps.test.ts`, `tests/cli.test.ts`, `README.md`, `docs/PROVIDERS.md` — the `speckit` command-pack provider was removed.
- `docs/CONSTITUTION.md` — the project constitution (5 principles), kept as a standalone doc.

## Notes
- spec-kit is fully removed (repo and machine): provider entry, docs, tests, the uv tool, the clone, and the commands.
- The dashboard was built and then removed at the user's request; no dashboard code or docs remain.
- The last commit is `815d9f4`; the spec-kit removal and this memory file are uncommitted.
