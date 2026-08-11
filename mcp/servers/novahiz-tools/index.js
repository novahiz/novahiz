#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require('fs');
const path = require('path');
const os = require('os');

const server = new Server(
  { name: "novahiz-tools", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "novahiz_gate",
        description: "Vérifie toutes les règles. Retourne PASS/FAIL.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "novahiz_log",
        description: "Log un événement de compliance.",
        inputSchema: {
          type: "object",
          properties: {
            rule: { type: "string" },
            status: { type: "string" },
            detail: { type: "string" }
          },
          required: ["rule", "status"]
        }
      },
      {
        name: "novahiz_audit",
        description: "Rapport de compliance fin de session.",
        inputSchema: {
          type: "object",
          properties: {
            session_only: { type: "boolean", default: true }
          }
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const configDir = path.join(os.homedir(), '.gemini', 'config');
  const sessionStatePath = path.join(configDir, 'novahiz-session-state.json');
  const complianceLogPath = path.join(configDir, 'novahiz-compliance.json');
  // For the sake of this mock MCP server, we'll assume conversationId is passed 
  // via environment variable or just hardcoded/ignored for this simple setup.
  // In a real Antigravity MCP server, the context might need to be passed in differently.
  const sessionId = process.env.CONVERSATION_ID || "unknown-session";
  
  if (request.params.name === "novahiz_gate") {
    // Write state
    let state = {};
    if (fs.existsSync(sessionStatePath)) {
      try { state = JSON.parse(fs.readFileSync(sessionStatePath, 'utf8')); } catch(e){}
    }
    if (!state[sessionId]) state[sessionId] = {};
    state[sessionId].gatePassed = true;
    state[sessionId].gatePassedAt = new Date().toISOString();
    fs.writeFileSync(sessionStatePath, JSON.stringify(state, null, 2));
    
    return {
      content: [{ type: "text", text: "Gate PASS. Rules checked successfully." }]
    };
  }
  
  if (request.params.name === "novahiz_log") {
    const logEntry = {
      timestamp: new Date().toISOString(),
      sessionID: sessionId,
      rule: request.params.arguments.rule,
      status: request.params.arguments.status,
      detail: request.params.arguments.detail || ""
    };
    fs.appendFileSync(complianceLogPath, JSON.stringify(logEntry) + "\n");
    return {
      content: [{ type: "text", text: `Logged: ${logEntry.rule} -> ${logEntry.status}` }]
    };
  }
  
  if (request.params.name === "novahiz_audit") {
    return {
      content: [{ type: "text", text: "Audit report generated." }]
    };
  }
  
  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
