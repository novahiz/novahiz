import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BLOCKED_TOOLS, RULES_MATRIX, Category } from './shared/novahiz-rules';

const configDir = path.join(os.homedir(), '.gemini', 'config');
const sessionStatePath = path.join(configDir, 'novahiz-session-state.json');

async function main() {
  const inputData = fs.readFileSync(0, 'utf-8');
  if (!inputData) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }
  
  const payload = JSON.parse(inputData);
  const toolName = payload.toolCall?.name;
  const sessionId = payload.conversationId;
  
  if (!toolName || !BLOCKED_TOOLS.includes(toolName)) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  // Load session state
  let state: any = {};
  if (fs.existsSync(sessionStatePath)) {
    state = JSON.parse(fs.readFileSync(sessionStatePath, 'utf-8'));
  }
  
  const session = state[sessionId] || {};
  const isGatePassed = session.gatePassed === true;
  
  if (isGatePassed) {
    console.log(JSON.stringify({ decision: "allow" }));
  } else {
    console.log(JSON.stringify({ 
      decision: "deny",
      reason: `ENFORCER BLOCK: The tool '${toolName}' is blocked because the Novahiz Gate has not passed. Please fix compliance violations and run novahiz_gate.`
    }));
  }
}

main().catch(err => {
  console.log(JSON.stringify({ decision: "allow", reason: "Error in enforcer hook" }));
});
