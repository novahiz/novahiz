---
name: mcp-server-builder
description: Design and ship production-ready MCP (Model Context Protocol) servers from OpenAPI contracts instead of hand-written tool wrappers. Python and TypeScript support, schema validation, safe evolution, spec-current capability and auth patterns. Use when exposing an existing API as an MCP server, building tool integrations for Claude or Codex or Cursor, or scaffolding an MCP project from scratch.
license: Apache-2.0
compatibility: "OpenAPI and validator scripts need Python 3 with no MCP SDK dependency; server templates target the official Python (mcp) and TypeScript (@modelcontextprotocol/sdk) SDKs."
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# MCP Server Builder

Design, scaffold, validate, and harden MCP servers. OpenAPI stays the source of truth for tool contracts. Hand-written wrappers are the fallback when no contract exists.

## Spec baseline

Pin one spec version for the whole project and record it in the server README.

| Track | Version | Use it when |
|---|---|---|
| Stable | `2025-06-18` | Production servers that must track a published revision |
| Newer stable | `2025-11-25` (and later cuts) | You need fields that shipped after the mid-2025 revision |

Field deltas between revisions are listed in [references/spec-compatibility.md](references/spec-compatibility.md). A server on an older stable revision must ignore unknown fields from newer clients instead of failing the exchange.

## Protocol fundamentals a server must get right

### Capabilities

Declare every primitive the server implements in the `initialize` response, and set `listChanged` only when the server actually emits list-change notifications:

```json
{
  "capabilities": {
    "tools": { "listChanged": true },
    "resources": { "subscribe": true, "listChanged": true },
    "prompts": { "listChanged": true }
  }
}
```

Declaring a capability the server never implements is worse than omitting it: clients will call methods that fail.

### Primitives

| Primitive | Invoked by | Use it for |
|---|---|---|
| Tools | The model | Actions with side effects or data fetches |
| Resources | The application | Read-only context the user or app selects |
| Prompts | The user | Reusable message templates with arguments |
| Elicitation | The server, back to the user | Missing form input before a tool can finish (`elicitation/create`, `mode: "form"`) |

One task intent per tool. A tool that fetches, filters, and updates in one call trains the model to misuse it.

### Authorization roles

OAuth 2.1 splits into three roles:

- The MCP server is the **resource server** and validates access tokens.
- The MCP client is the **OAuth client** and handles the authorization flow with the user.
- The **authorization server** issues tokens; it may run beside the resource server or separately, linked through discovery metadata.

A server that expects `Authorization: Bearer` must document which scopes each tool needs, and must reject tokens whose audience does not match it.

## Tool design rules

1. **Name.** Prefer the OpenAPI `operationId`. Lowercase `snake_case`, `[a-z0-9_]`, 3 to 64 characters, verb first (`create_invoice`, not `invoices__v1__post`).
2. **Description.** One or two sentences, action verb first, states the observable result. The model picks tools by description alone, so a missing or vague one is a wrong tool call waiting to happen.
3. **Schema.** `inputSchema.type` is always `"object"`. Every key listed in `required` exists in `properties`. Each property carries its own `description`. Prefer enums and formats over free strings when the domain is closed.
4. **No secrets in the contract.** Tokens, keys, and connection strings belong in environment variables or the auth layer, never in a tool parameter or a returned payload.
5. **Validation and containment.** The spec requires servers to validate tool inputs, apply access control, rate-limit, and sanitize outputs. Destructive tools take an explicit confirmation parameter, for example `confirm: true`.
6. **Errors.** Return a consistent shape (`code`, `message`, `details`) so the agent can recover. Keep transport failures separate from domain failures.

## Workflows

### 1. OpenAPI to MCP scaffold

```bash
python3 scripts/openapi_to_mcp.py \
  --input openapi.json \
  --server-name billing-mcp \
  --language python \
  --output-dir ./out \
  --format text
```

Stdin works too:

```bash
cat openapi.json | python3 scripts/openapi_to_mcp.py --server-name billing-mcp --language typescript
```

Review the generated names and the auth story before writing handler logic.

### 2. Validate the manifest

```bash
python3 scripts/mcp_validator.py --input out/tool_manifest.json --strict --format text
```

Strict mode exits non-zero on duplicate names, malformed schemas, missing descriptions, empty required lists, and naming hygiene failures. Run it in CI next to the contract snapshot diff.

### 3. Pick a runtime

Python suits data-heavy backends and fast iteration. TypeScript suits JS stacks that want one type definition shared with the front end. Either way the tool contract stays stable when the transport changes.

### 4. Transport and logging

On stdio, stdout belongs to JSON-RPC. Log to stderr (`console.error`, Python logging to stderr); a single `print()` on stdout corrupts the session. HTTP and SSE transports do not share this constraint.

### 5. Harden, then publish

Full guidance lives in [references/production-hardening-guide.md](references/production-hardening-guide.md): outbound allowlists, structured errors, redaction, rate limits, versioning, quality gates, and the test matrix.

## Evolution rules

- Additive fields only for non-breaking changes.
- Never rename a tool in place; a breaking behavior change gets a new tool name.
- Track a contract changelog per release and keep one release window of backward compatibility.
- Snapshot `tool_manifest.json` in the repo and review its diff like any API change.

## Scripts

```bash
python3 scripts/openapi_to_mcp.py --help   # OpenAPI -> tool_manifest.json + scaffold
python3 scripts/mcp_validator.py --help    # structural and quality checks, non-zero exit in --strict
```

## Reference material

- [references/spec-compatibility.md](references/spec-compatibility.md): stable vs newer field deltas, elicitation flow, pagination and caching fields
- [references/production-hardening-guide.md](references/production-hardening-guide.md): auth and safety design, versioning, quality gates, testing, deployment, security controls
- [references/openapi-extraction-guide.md](references/openapi-extraction-guide.md)
- [references/python-server-template.md](references/python-server-template.md)
- [references/typescript-server-template.md](references/typescript-server-template.md)
- [references/validation-checklist.md](references/validation-checklist.md)
- [README.md](README.md)

## Sources

- MCP specification (server tools, resources, prompts, authorization): <https://modelcontextprotocol.io/specification/2025-06-18>
- Server tools overview: <https://modelcontextprotocol.io/server/tools>
