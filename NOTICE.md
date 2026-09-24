# Notices

Novahiz is licensed under Apache-2.0. See [LICENSE](LICENSE).

## Bundled skills

The `skills/` and `bundled-skills/` directories ship curated agent skills so the system works right after installation. Each skill is its own folder, and that folder's license governs it when one is recorded, in this order:

1. A `LICENSE`, `LICENSE.txt`, or `NOTICE` file inside the folder.
2. A `license:` field in the skill's frontmatter.
3. Otherwise the directory decides: folders under `skills/` belong to Novahiz and ship under Apache-2.0. Folders under `bundled-skills/` that record no license keep the terms of their upstream project. This repository does not claim authorship of them.

### Novahiz-owned skills

Every skill under `skills/` is authored by Novahiz and ships under Apache-2.0 unless its frontmatter declares otherwise. Two pipeline skills keep `license: MIT`: `novahiz-humanizer` and `novahiz-security`. The twelve skills that began as third-party material (`mcp-server-builder`, `anti-AI-design`, `frontend-design-taste`, `design-system-tokens`, `apple-hig-audit`, `engineering-code-standards`, `ai-security`, `dependency-auditor`, `env-secrets-manager`, `skill-creator`, `write-a-skill`, `playwright-agent`) were fully reinvented from primary sources and now carry `author: Novahiz` and `license: Apache-2.0`. `prompt-rewriter`, `gate`, and `memory` are also Novahiz-owned (Apache-2.0).

### Third-party skills with a recorded upstream

| Skill | Upstream | License |
|---|---|---|
| `android-reverse-engineering` | Simone Avogadro (SimoneAvogadro/android-reverse-engineering-skill) | Apache-2.0, see `bundled-skills/android-reverse-engineering/LICENSE` |
| `expo-animation` | Emil Kowalski | MIT, see `bundled-skills/expo-animation/LICENSE` |

Most `expo-*` and `eas-*` folders under `bundled-skills/` declare `license: MIT` in their frontmatter. A few Expo folders ship without that field (`expo-app-clip`, `expo-brownfield`, `expo-skill-feedback`); they follow their upstream terms under rule 3 above.

`supabase` and `supabase-postgres-best-practices` appear in the catalog for the `database-supabase` category but are not vendored in this repository. Install them from Supabase when you need them; their upstream licenses apply.

All other entries previously listed here (`skill-creator`, `write-a-skill`, `playwright-agent`, `novahiz-humanizer`, `novahiz-security`) were reinvented as original Novahiz work and no longer carry an upstream attribution.

### Third-party skills with no recorded upstream

No folder under `skills/` lacks a recorded license. Many folders under `bundled-skills/` (wiki helpers, marketing skills, Dart and Flutter helpers, agent utilities) ship without a `license:` field and without a LICENSE file. Rule 3 keeps their upstream terms in force; this project does not claim Apache-2.0 authorship for them.

The former third-party folders `a11y-audit`, `code-reviewer`, `defuddle`, `review-changes`, and `security-guidance` were replaced by the Novahiz-owned `novahiz-*` skills and removed from the bundle; `clean-code`, `zero-hallucination-coder`, `adversarial-reviewer`, `typescript-expert`, `postgresql-optimization`, `anti-pattern-detector`, `api-design-reviewer`, `challenge`, `code-understand`, `database-designer`, `fix`, `migrate`, `senior-architect`, `senior-backend`, `senior-secops`, and `spec-driven-workflow` were removed as redundant with the `novahiz-*` pipeline or outside this project's scope.

If you hold rights to a bundled skill and want a different attribution or a removal, open an issue on the repository.

## Providers

Providers are referenced by install command, never vendored. Each lists its upstream license in `catalog/providers.json`.

## Dependencies

The core and the MCP server use Node.js built-ins only. The opencode adapter imports only Node.js built-ins and the `@opencode-ai/plugin` types, which the harness provides.
