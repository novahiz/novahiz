# MCP checklist (ship gate)

Service / server: __________________  Date: __________________

## Contract

- [ ] OpenAPI validated (full validator + `openapi_mcp_lint.mjs` HIGH = 0)
- [ ] Absolute https base URL
- [ ] operationIds unique; path params declared

## Tools

- [ ] Goal-oriented names (not verb dump)
- [ ] description: when + example
- [ ] inputSchema / outputSchema complete
- [ ] annotations match read vs write behavior
- [ ] search/fetch pair if retrieval surface

## Runtime

- [ ] MCP Inspector: initialize, tools/list, sample calls
- [ ] Auth 401/403 path tested
- [ ] Rate limits and timeouts on expensive tools
- [ ] Logs contain no tokens
- [ ] instructions block at initialize is short and dense

## Ship

- [ ] Names/schema backward-compatible with previous publish
- [ ] Owner and rollback contact recorded
