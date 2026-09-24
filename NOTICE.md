# Notices

Novahiz is licensed under Apache-2.0. See [LICENSE](LICENSE).

## Bundled skills

The `skills/` directory ships curated agent skills so the system works right after installation. Each skill is its own folder, and that folder's license governs it when one is recorded, in this order:

1. A `LICENSE`, `LICENSE.txt`, or `NOTICE` file inside the folder.
2. A `license:` field in the skill's frontmatter.
3. Otherwise the folder ships under Apache-2.0 with the rest of Novahiz.

### Novahiz-owned skills

Every skill under `skills/` is authored by Novahiz and ships under Apache-2.0 unless its frontmatter declares otherwise. Two pipeline skills keep `license: MIT`: `novahiz-humanizer` and `novahiz-security`. Twelve skills that began as third-party material were renamed and fully reinvented from primary sources under Novahiz authorship: `anti-AI-design` → `ui-slop-remover`, `frontend-design-taste` → `ui-craft-rules`, `design-system-tokens` → `design-token-pipeline`, `apple-hig-audit` → `apple-ui-audit`, `engineering-code-standards` → `code-standards`, `ai-security` → `llm-threat-review`, `dependency-auditor` → `package-risk-audit`, `env-secrets-manager` → `secrets-hygiene`, `mcp-server-builder` → `openapi-mcp-server`, `skill-creator` → `skill-eval-loop`, `write-a-skill` → `skill-authoring`, `playwright-agent` → `browser-session`. Each carries `author: Novahiz` and `license: Apache-2.0`. `prompt-rewriter`, `gate`, and `memory` are also Novahiz-owned (Apache-2.0).

`supabase` and `supabase-postgres-best-practices` appear in the catalog for the `database-supabase` category but are not vendored in this repository. Install them from Supabase when you need them; their upstream licenses apply.

The former third-party folders `a11y-audit`, `code-reviewer`, `defuddle`, `review-changes`, and `security-guidance` were replaced by the Novahiz-owned `novahiz-*` skills and removed from the bundle; `clean-code`, `zero-hallucination-coder`, `adversarial-reviewer`, `typescript-expert`, `postgresql-optimization`, `anti-pattern-detector`, `api-design-reviewer`, `challenge`, `code-understand`, `database-designer`, `fix`, `migrate`, `senior-architect`, `senior-backend`, `senior-secops`, and `spec-driven-workflow` were removed as redundant with the `novahiz-*` pipeline or outside this project's scope. The twelve legacy folders listed above under their old names are gone; only the renamed Novahiz-owned folders remain.

If you hold rights to a skill and want a different attribution or a removal, open an issue on the repository.

## Providers

Providers are referenced by install command, never vendored. Each lists its upstream package, repository, and SPDX license in `catalog/providers.json`.

| Id | Upstream package | Repository | License |
| --- | --- | --- | --- |
| `playwright` | `@playwright/mcp` | https://github.com/microsoft/playwright-mcp | Apache-2.0 |
| `security` | `security-mcp` | https://github.com/AbrahamOO/security-mcp | MIT |
| `narsil` | `narsil-mcp` | https://github.com/postrv/narsil-mcp | MIT OR Apache-2.0 |
| `context7` | `@upstash/context7-mcp` | https://github.com/upstash/context7 | MIT |
| `cron` | `mcp-cron` | https://github.com/jolks/mcp-cron | AGPL-3.0-only |
| `novahiz` | local Novahiz MCP | https://github.com/novahiz/novahiz | Apache-2.0 |
| `dart` | Dart SDK (`dart mcp-server`) | https://github.com/dart-lang/ai (pkgs/dart_mcp_server) | BSD-3-Clause |

## Skill packs (upstream, not vendored)

Installed on demand with `npx skills add`; this repository does not copy their files.

| Id | Repository | License |
| --- | --- | --- |
| `flutter-skills` | https://github.com/flutter/agent-plugins | BSD-3-Clause |
| `dart-skills` | https://github.com/dart-lang/skills | BSD-3-Clause |

## opencode plugins (third-party)

The installer may register these OpenCode plugins from `opencode.jsonc` `plugin[]`. They are installed from npm, never vendored in this repository.

| Package | Repository | License |
| --- | --- | --- |
| `@mohak34/opencode-notifier` | https://github.com/mohak34/opencode-notifier | MIT |
| `@tarquinen/opencode-dcp` | https://github.com/Opencode-DCP/opencode-dynamic-context-pruning | AGPL-3.0-or-later |

The Novahiz adapter (`adapters/opencode/novahiz.ts`) is first-party under Apache-2.0.

## Dependencies

The core and the MCP server use Node.js built-ins only. The opencode adapter imports only Node.js built-ins and the `@opencode-ai/plugin` types, which the harness provides.
