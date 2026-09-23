# Spec compatibility across MCP revisions

Read this when a client or generated manifest uses fields your pinned spec does not
know, or when you decide whether to adopt newer fields before you bump the pin.

Pinned baseline for this skill: `2025-06-18`. Later stable cuts (for example
`2025-11-25`) add fields; treat them as optional until you move the pin in the
project README.

## Capability declarations

Capabilities are declared in `initialize`:

```json
{
  "capabilities": {
    "tools": { "listChanged": true },
    "resources": { "subscribe": true, "listChanged": true },
    "prompts": { "listChanged": true },
    "sampling": {}
  }
}
```

- Set `listChanged` or `subscribe` only when the server really emits the matching
  notification.
- Prefer omitting optional sampling context keys unless the client declares the
  matching capability. Unknown optional values may disappear in a later release.

## Tools list results

A typical `tools/list` result:

```json
{
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current weather information for a location",
      "inputSchema": {
        "type": "object",
        "properties": {
          "location": { "type": "string", "description": "City name or zip code" }
        },
        "required": ["location"]
      }
    }
  ],
  "nextCursor": "next-page-cursor"
}
```

| Field | Notes |
|---|---|
| `name`, `description`, `inputSchema` | Core tool contract on every revision |
| `nextCursor` pagination | Supported on list methods; omit when there is no next page |
| Presentation or cache hints (`title`, `icons`, `ttlMs`, and similar) | Present only on newer revisions; treat as optional and never as contract |
| `inputSchema` default dialect | JSON Schema unless the tool states otherwise |

A server pinned to an older revision must tolerate unknown result fields from
newer clients. Rejecting unknown keys breaks forward compatibility for no gain.

## Elicitation (server asks the user)

When a tool cannot finish without user input, the server returns an input request
that points at `elicitation/create` in form mode, and the client renders the form:

```json
{
  "id": 3,
  "jsonrpc": "2.0",
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "echo_input": {
        "method": "elicitation/create",
        "params": {
          "mode": "form",
          "message": "Please provide the input string to echo back",
          "requestedSchema": {
            "type": "object",
            "properties": { "input": { "type": "string" } },
            "required": ["input"]
          }
        }
      }
    }
  }
}
```

Design rules:

1. Ask once, with every missing field in one schema, instead of one round trip per field.
2. Mark only genuinely required fields `required`.
3. Keep the `message` actionable: say what the value is for.
4. Do not use elicitation for data the server could look up itself.

## Security requirements for tools

The specification expects the server to validate all tool inputs, apply access
controls, rate-limit calls, and sanitize outputs. Clients complement that by
confirming sensitive operations with the user, showing inputs before execution,
enforcing timeouts, and keeping audit logs.

## Stdio logging

stdout carries JSON-RPC on the stdio transport. Route every log line to stderr:

```javascript
// wrong on stdio
console.log("Server started");
// right
console.error("Server started");
```

## Authorization

Three roles: the MCP server is the OAuth 2.1 resource server, the MCP client is
the OAuth client, and the authorization server issues tokens. Discovery metadata
links the three when they run apart. Document the scopes each tool needs and
validate the token audience on every call.

## Adoption checklist for newer-revision fields

- [ ] The team agreed to pin the newer revision (date the pin in the README).
- [ ] Unknown-field tolerance is tested against a client on the old pin.
- [ ] Presentation or cache fields are treated as optional data, never as contract.
- [ ] The migration point back to the next stable release is written down.
