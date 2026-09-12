# Notices

Novahiz is licensed under Apache-2.0. See [LICENSE](LICENSE).

## Bundled skills

The `skills/` directory ships a curated set of agent skills so the system works right after installation. Each skill is its own folder, and that folder's license governs it when one is recorded, in this order:

1. A `LICENSE`, `LICENSE.txt`, or `NOTICE` file inside the folder.
2. A `license:` field in the skill's frontmatter.
3. Otherwise the skill belongs to Novahiz and ships under Apache-2.0.

The `novahiz-*` pipeline skills, plus the `gate` and `memory` aliases, are Novahiz's own and always Apache-2.0.

### Third-party skills with a recorded upstream

| Skill | Upstream | License |
|---|---|---|
| `skill-creator` | Anthropic | see `skills/skill-creator/LICENSE.txt` |
| `humanizer` | pattern catalogue from Wikipedia's "Signs of AI writing" (WikiProject AI Cleanup), attributed in the skill body | MIT as declared in its frontmatter; the source page is CC BY-SA 4.0 |
| `security-guidance` | ported by Alireza Rezvani from David Dworken's implementation | MIT |
| `supabase-postgres-best-practices` | Supabase | MIT, declared in its frontmatter |
| `supabase` | Supabase | not recorded |
| `write-a-skill` | Matt Pocock (`mattpocock/skills`) | not recorded |
| `clean-code` | `jackjin1997/ClawForge` | not recorded |
| `zero-hallucination-coder` | draws on Ralph (`@snarktank`) and GSD Core (`@open-gsd`) | not recorded |
| `adversarial-reviewer` | ekreloff | not recorded |
| `apple-hig-expert` | Alireza Rezvani | not recorded |
| `design-taste-frontend` | Leonxlnx | not recorded |
| `typescript-expert`, `postgresql-optimization` | community contributions, authors not recorded | not recorded |

### Third-party skills with no recorded upstream

These folders carry no license file, no `license:` field, and no author. Their upstream and license could not be verified from the bundle:

`a11y-audit`, `ai-security`, `anti-AI-design`, `anti-pattern-detector`, `api-design-reviewer`, `code-reviewer`, `code-understand`, `database-designer`, `defuddle`, `dependency-auditor`, `engineering-standards`, `env-secrets-manager`, `fix`, `mcp-server-builder`, `migrate`, `review-changes`, `senior-architect`, `senior-backend`, `senior-secops`, `spec-driven-workflow`, `ui-design-system`.

They are redistributed as they were found, and this project asserts no license over them. Each one is a candidate for either recording its license or removing it from the bundle. If you hold the rights and want a different attribution or a removal, open an issue on the repository.

## Providers

Providers are referenced by install command, never vendored. Each lists its upstream license in `catalog/providers.json`. `impeccable` is installed by its provider and is not bundled.

## Dependencies

The core and the MCP server use Node.js built-ins only. The opencode adapter imports only Node.js built-ins and the `@opencode-ai/plugin` types, which the harness provides.
