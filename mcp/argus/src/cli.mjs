#!/usr/bin/env node
// Argus MCP server — stdio transport, newline-delimited JSON-RPC 2.0.
// Zero dependencies, plain JavaScript (no TypeScript syntax: Node runs this
// file directly, a single type annotation is a SyntaxError).
//
// TRANSPORT RULE (spec): stdout carries ONLY valid MCP messages, one
// single-line JSON value each. Every log goes to stderr — one stray
// console.log line corrupts the stream and the host fails to parse.
// A promise queue serializes responses (concurrent stdout.write can
// interleave mid-object).

import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ToolManager } from "./tools/toolManager.mjs";
import { RuleEngine } from "./analysis/ruleEngine.mjs";
import { Scanner } from "./analysis/scanner.mjs";
import { CONFIG } from "./config.mjs";

const SERVER_INFO = { name: "argus", version: "0.1.0" };
// Negotiation rule: echo the requested version when supported, else answer
// with the newest one we speak (the host then downgrades or disconnects).
const SUPPORTED_PROTOCOLS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07"
];
const LATEST_PROTOCOL = "2025-06-18";
// Declare ONLY the capability we implement; omitting a key means "not served".
const CAPABILITIES = { tools: { listChanged: false } };

const ruleEngine = new RuleEngine();
const scanner = new Scanner(ruleEngine);
const toolManager = new ToolManager(ruleEngine, scanner);

let initialized = false;

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------
// Patterns are validated at registration by RuleEngine (ReDoS gate: length,
// stacked/nested quantifiers, huge repetition bounds) before ever compiling.
const DEFAULT_RULES = [
  {
    id: "sql-injection",
    name: "SQL Injection",
    severity: "error",
    description:
      "SQL built from an f-string, string concatenation or template interpolation, or a query API called with a non-literal argument (CWE-89)",
    pattern:
      "f[\"'](SELECT|INSERT|UPDATE|DELETE|DROP|REPLACE)|\\b(?:SELECT|INSERT|UPDATE|DELETE|REPLACE)\\b[^\\n]{0,150}?(?:['\"`]\\s*\\+|\\$\\{|f[\"'])|\\.\\s*(?:query|execute|raw|execSQL)\\s*\\(\\s*(?![$'\"`])",
    languages: ["python", "javascript", "typescript", "php", "java"],
    examples: [
      "query = f\"SELECT * FROM users WHERE id = {user_id}\"",
      "cursor.execute('SELECT * FROM users WHERE id = ' + user_input)"
    ]
  },
  {
    id: "xss",
    name: "Cross-Site Scripting (XSS)",
    severity: "error",
    description:
      "Untrusted data written into the DOM without sanitization — innerHTML/outerHTML/document.write/insertAdjacentHTML (CWE-79)",
    pattern:
      "\\.innerHTML\\s*=|\\.outerHTML\\s*=|\\bdocument\\.write\\s*\\(|\\bdangerouslySetInnerHTML\\b|\\binsertAdjacentHTML\\s*\\(",
    languages: ["javascript", "typescript", "html"],
    examples: [
      "element.innerHTML = query;",
      "document.write('<b>' + userInput + '</b>')"
    ]
  },
  {
    id: "command-injection",
    name: "Command Injection",
    severity: "error",
    description:
      "Shell command executed through a dangerous sink (system/exec/eval/subprocess, or curl piped to a shell) (CWE-78)",
    pattern:
      "\\b(?:subprocess\\.(?:run|call|Popen|check_output)|os\\.system)\\s*\\(|\\b(?:system|shell_exec|popen)\\s*\\(|\\beval\\s*\\(|curl[^|\\n]*\\|\\s*(?:ba|z)?sh",
    languages: ["python", "bash", "javascript", "php"],
    examples: [
      "system(\"echo \" + input)",
      "subprocess.run('ls ' + user_input, shell=True)"
    ]
  },
  {
    id: "hardcoded-secret",
    name: "Hardcoded Secret",
    severity: "warning",
    description:
      "Credential or API key literal assigned in source code (CWE-798)",
    pattern:
      "\\b(?:password|passwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key|credential)\\s*[:=]\\s*[\"'][^\"'\\s]{8,}[\"']",
    languages: ["javascript", "python", "java", "php", "ruby", "bash"],
    examples: [
      "password = \"hunter2-hunter2\"",
      "api_key = 'sk_live_abcdefghijklmnop'"
    ]
  },
  {
    id: "insecure-deserialization",
    name: "Insecure Deserialization",
    severity: "error",
    description:
      "Deserialization of untrusted data with an unsafe loader — pickle/yaml/marshal/unserialize (CWE-502)",
    pattern:
      "pickle\\.(?:loads|load)\\s*\\(|yaml\\.(?:load|unsafe_load)\\s*\\(|marshal\\.loads\\s*\\(|\\bunserialize\\s*\\(",
    languages: ["python", "php", "ruby"],
    examples: [
      "data = pickle.loads(user_input)",
      "$obj = unserialize($_COOKIE['data']);"
    ]
  }
];

function loadDefaultRules() {
  let loaded = 0;
  for (const rule of DEFAULT_RULES) {
    try {
      ruleEngine.addRule(rule);
      loaded += 1;
    } catch (error) {
      // A broken built-in must not prevent startup, but must stay visible.
      console.error(`[argus] built-in rule "${rule.id}" rejected: ${error.message}`);
    }
  }

  // Optional user rules: <server>/rules/*.json — an array of rule objects
  // or { "rules": [...] }.
  const rulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rules");
  if (fs.existsSync(rulesDir)) {
    for (const entry of fs.readdirSync(rulesDir)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(rulesDir, entry), "utf8"));
        const list = Array.isArray(raw) ? raw : Array.isArray(raw.rules) ? raw.rules : [];
        for (const rule of list) {
          ruleEngine.addRule(rule);
          loaded += 1;
        }
      } catch (error) {
        console.error(`[argus] rules/${entry} skipped: ${error.message}`);
      }
    }
  }

  console.error(`[argus] ${loaded} rules loaded`);
  return loaded;
}

// ---------------------------------------------------------------------------
// JSON-RPC / MCP dispatch
// ---------------------------------------------------------------------------
const hasOwn = (object, key) =>
  object !== null && typeof object === "object" &&
  Object.prototype.hasOwnProperty.call(object, key);

// JSON-RPC notification = NO `id` member at all. `id: null` is not a
// notification: MCP forbids null ids, it is an Invalid Request.
function isNotification(message) {
  return !hasOwn(message, "id");
}

function send(message) {
  if (message !== null && message !== undefined) {
    process.stdout.write(JSON.stringify(message) + "\n");
  }
}

function reply(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Hosts probe these even when the capability is not advertised — answering
// with a valid empty list avoids scary host-side error logs.
const LIST_PROBES = {
  "resources/list": "resources",
  "resources/templates/list": "resourceTemplates",
  "prompts/list": "prompts"
};

async function dispatch(message) {
  const method = message.method;
  // No method => a client->server response or notification: never answer.
  if (typeof method !== "string") return null;
  if (isNotification(message)) return null; // notifications: MUST NOT respond

  const id = message.id;
  if (typeof id !== "string" && !Number.isInteger(id)) {
    // MCP: request ids must be string or integer, never null.
    return fail(null, -32600, "Invalid Request: id must be a string or integer");
  }

  switch (method) {
    case "initialize": {
      const params = message.params;
      if (!params || typeof params.protocolVersion !== "string") {
        return fail(id, -32602, "Invalid params: initialize requires protocolVersion");
      }
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(params.protocolVersion)
        ? params.protocolVersion
        : LATEST_PROTOCOL;
      initialized = true;
      return reply(id, {
        protocolVersion,
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions:
          "Argus scans source code with local security rules. Use scan on a file or directory, list_rules to see the rules, create_rule to add one, export_results to write a report (json/sarif/csv/html)."
      });
    }

    case "ping":
      return reply(id, {}); // spec: empty object, never null

    case "tools/list":
      return reply(id, { tools: toolManager.list() });

    case "tools/call": {
      const params = message.params;
      if (!params || typeof params.name !== "string") {
        return fail(id, -32602, "Invalid params: tools/call requires params.name");
      }
      // Unknown tool = protocol error (-32602). A tool that RUNS and fails
      // returns isError:true so the model can see it and self-correct.
      if (!toolManager.has(params.name)) {
        return fail(id, -32602, `Unknown tool: ${params.name}`);
      }
      const result = await toolManager.call(params.name, params.arguments ?? {});
      return reply(id, result);
    }

    default: {
      const probeKey = LIST_PROBES[method];
      if (probeKey) return reply(id, { [probeKey]: [] });
      return fail(id, -32601, `Method not found: ${method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// stdio loop
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(CONFIG.tempDir)) {
    fs.mkdirSync(CONFIG.tempDir, { recursive: true });
  }
  loadDefaultRules();
  console.error(`[argus] ${SERVER_INFO.name} v${SERVER_INFO.version} ready on stdio`);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

  // Sequential queue: responses keep their order, writes stay atomic.
  let queue = Promise.resolve();
  rl.on("line", (line) => {
    if (line.trim().length === 0) return;
    queue = queue
      .then(async () => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          send(fail(null, -32700, "Parse error: invalid JSON"));
          return;
        }

        if (message === null || typeof message !== "object") {
          send(fail(null, -32600, "Invalid Request"));
          return;
        }
        // Batch arrays are not valid MCP: reject, do not process.
        if (Array.isArray(message)) {
          send(fail(null, -32600, "Invalid Request: batch arrays are not supported"));
          return;
        }
        if (message.jsonrpc !== "2.0") {
          if (!isNotification(message)) send(fail(null, -32600, 'Invalid Request: jsonrpc must be "2.0"'));
          return;
        }
        if (isNotification(message)) return; // never respond to notifications

        if (
          !initialized &&
          message.method !== "initialize" &&
          typeof message.method === "string"
        ) {
          send(fail(message.id, -32002, "Server not initialized"));
          return;
        }

        try {
          send(await dispatch(message));
        } catch (error) {
          // Tool/execution failure that escaped the tool layer: -32603.
          send(fail(message.id, -32603, `Internal error: ${error.message}`));
        }
      })
      .catch((error) => console.error("[argus] loop error:", error)); // stderr only
  });

  // stdin closed => the host is gone: drain, then exit.
  rl.on("close", () => {
    queue.then(
      () => process.exit(0),
      () => process.exit(0)
    );
  });
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((error) => {
  console.error("[argus] fatal:", error);
  process.exit(1);
});
