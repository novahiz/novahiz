import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9_-]{20,}/ },
  { name: 'GitHub Token', regex: /(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,})/ },
  { name: 'Anthropic API Key', regex: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'Private Key', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |PRIVATE )?KEY-----/ },
  { name: 'Slack Token', regex: /xox[baprs]-[0-9]{10,}-[a-zA-Z0-9]+/ }
];

const AUDITABLE_TOOLS = ['write_to_file', 'replace_file_content', 'run_command'];

async function main() {
  const inputData = fs.readFileSync(0, 'utf-8');
  if (!inputData) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(inputData);
  } catch (e) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  const toolName = payload.toolCall?.name;
  if (!toolName || !AUDITABLE_TOOLS.includes(toolName)) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  const argsStr = JSON.stringify(payload.toolCall.args || {});

  for (const { name, regex } of SECRET_PATTERNS) {
    if (regex.test(argsStr)) {
      // Log security violation in compliance file
      try {
        const configDir = path.join(os.homedir(), '.gemini', 'config');
        const compliancePath = path.join(configDir, 'novahiz-compliance.json');
        const logEntry = {
          timestamp: new Date().toISOString(),
          sessionID: payload.conversationId || 'unknown',
          rule: 'secret_leak_prevention',
          status: 'FAIL',
          tool: toolName,
          detail: `Blocked attempt to write hardcoded secret: ${name}`
        };
        fs.appendFileSync(compliancePath, JSON.stringify(logEntry) + '\n');
      } catch (err) {
        // silent fallback
      }

      console.log(JSON.stringify({
        decision: "deny",
        reason: `[NOVAHIZ SECURITY SWEEPER] Hardcoded credential detected (${name}). Raw secrets are prohibited in code and scripts. Please use environment variables or a secrets manager.`
      }));
      return;
    }
  }

  console.log(JSON.stringify({ decision: "allow" }));
}

main().catch(() => {
  console.log(JSON.stringify({ decision: "allow" }));
});
