# MCP Server Builder

Generate and validate MCP servers from OpenAPI contracts with production-focused tooling, on top of current MCP spec patterns (capabilities, OAuth 2.1 roles, elicitation, tool design rules). This skill helps teams bootstrap fast and enforce schema quality before shipping.

## Quick Start

```bash
# Generate scaffold from OpenAPI
python3 scripts/openapi_to_mcp.py \
  --input openapi.json \
  --server-name my-mcp \
  --language python \
  --output-dir ./generated \
  --format text

# Validate generated manifest
python3 scripts/mcp_validator.py --input generated/tool_manifest.json --strict --format text
```

## Included Tools

- `scripts/openapi_to_mcp.py`: OpenAPI -> `tool_manifest.json` + starter server scaffold
- `scripts/mcp_validator.py`: structural and quality validation for MCP tool definitions

## References

- `references/spec-compatibility.md`
- `references/production-hardening-guide.md`
- `references/openapi-extraction-guide.md`
- `references/python-server-template.md`
- `references/typescript-server-template.md`
- `references/validation-checklist.md`

## Installation

Copy this folder into your agent skills directory, for example:

```bash
cp -R mcp-server-builder ~/.agents/skills/mcp-server-builder
```

Adjust the destination to match the host you use (opencode skills path, Claude skills path, Codex skills path, or OpenClaw skills path).
