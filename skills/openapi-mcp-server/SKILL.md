---
name: "openapi-mcp-server"
description: "Ship an MCP server from an OpenAPI contract: tool granularity, JSON Schema 2020-12, streamable HTTP, OAuth, annotations, search/fetch read pair, MCP Inspector. Use when exposing a REST API to agents, generating tools from openapi.yaml, or reviewing an MCP server before production."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# openapi-mcp-server

Turn a documented REST API into an MCP server agents can call safely. Spec first: MCP JSON Schema is the source of truth for messages (TypeScript schema + generated JSON Schema).

## Contract prep

1. OpenAPI 2.0 or 3.x, absolute base URL in `servers`, security schemes declared.
2. Fix common defects before codegen: duplicate `operationId`, missing path params, wrong types, dangling `$ref`.
3. Pick a dialect: JSON Schema 2020-12 is the MCP default when `$schema` is absent.
4. Auth stays in the host (bearer, OAuth 2.1, mTLS). Tokens never enter tool results or `_meta`.

A clean contract usually yields working tools on the first pass; residual failures are often small schema bugs, not framework issues.

## Tool shape (do not mirror 1:1)

Map **user goals**, not every endpoint:

| Bad | Good |
|---|---|
| 80 REST verbs as tools | `search`, `get_project`, `update_project` |
| One mega-tool with mode enum | One action per tool |

Each tool needs:

- Action-oriented `name` (prefer `camelCase` for tokenization).
- `description` that says **when** to use it and one short example.
- Explicit `inputSchema`; `outputSchema` when structured.
- Accurate annotations: `readOnlyHint`, `destructiveHint`, `openWorldHint`.
- Handler that authorizes, validates, and rate-limits.

Annotations are hints. They never replace server-side authz.

For research-style hosts, implement the standard read pair:

- `search(query)` → `id`, `title`, `text`, `url` (canonical, citable).
- `fetch(id)` → full document + same `url` shape.

Return `structuredContent` plus a JSON string in `content` for older clients. Stable ids let later tool calls join records.

## Server surface

- `instructions` on initialize: workflows, required tool order, rate limits. Keep the first characters dense; do not rewrite every tool description.
- Prefer a handful of high-level tools over dozens of micro-tools (token cost and multi-hop thrash).
- Avoid framing empty search results as hard “not found”; return closest matches so the model can reason.

## Transport and deploy

- Dev: stdio. Prod remote: streamable HTTP at a stable URL (often `.../mcp`).
- HTTPS, auth on every request, timeouts, limits on expensive tools.
- Secrets from the host secret manager only; no secrets in the OpenAPI file or tool results.
- Post-deploy: MCP Inspector against initialize, tools list, schemas, auth, and error paths.

## Security checklist

- [ ] Every tool input treated as untrusted; validated server-side.
- [ ] Authz in the handler for every call (model never decides access).
- [ ] Confirmation path for write/destructive tools.
- [ ] No tokens, PII, or internal ids that grant access in results.
- [ ] Rate limits + logs that omit credentials.
- [ ] Schema dialect documented; output schemas validate.
- [ ] Names and schemas stay backward compatible once published.

## Sources

MCP specification (modelcontextprotocol.io, 2025 revisions): tools, JSON Schema dialect, authorization. OpenAI developer guidance on building MCP servers and plugin tools. Cloudflare openApiMcpServer pattern. AutoMCP paper on OpenAPI-to-MCP failure modes. Original Novahiz synthesis; no upstream skill text.
