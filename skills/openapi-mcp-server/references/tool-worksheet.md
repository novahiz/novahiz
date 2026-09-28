# MCP tool worksheet

API / service: __________________  Owner: __________________  Date: __________________

## Goal mapping

| User goal | Proposed tool name | Read/write | Source operations |
|---|---|---|---|
| | | | |

Rules: one tool per goal; no 1:1 verb dump; `search`/`fetch` pair for retrieval.

## Per-tool fields

For each name above:

- [ ] camelCase name, stable once published
- [ ] description: when + one example
- [ ] inputSchema required fields only
- [ ] outputSchema if structured
- [ ] annotations (readOnly / destructive / openWorld) match real behavior
- [ ] server-side authz + validation + rate limit
- [ ] no secrets in results

## Ship gate

- [ ] openapi_mcp_lint HIGH = 0 (plus full OpenAPI validator)
- [ ] MCP Inspector: initialize, tools/list, sample calls
- [ ] Auth path tested (401/403)
- [ ] Logs free of tokens
