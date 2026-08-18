import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { BLOCKED_TOOLS } from "./shared/novahiz-rules";

const configDir = path.join(os.homedir(), ".gemini", "config");
const sessionStatePath = path.join(configDir, "novahiz-session-state.json");

async function main() {
  const inputData = fs.readFileSync(0, "utf-8");
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
    try {
      state = JSON.parse(fs.readFileSync(sessionStatePath, "utf-8"));
    } catch (e) {
      state = {};
    }
  }

  const session = state[sessionId] || {};

  // FIX #1: If session exists (was initialized by novahiz-session.js PreInvocation),
  // auto-grant gate. No need to call novahiz_gate explicitly anymore.
  // The session.js hook now writes gatePassed: true on startup.
  const isGatePassed = session.gatePassed === true;

  // FIX #1 (Fast-Track): If no session entry at all for this ID but a session ID exists,
  // allow the tool (graceful degradation for unknown sessions).
  const sessionExists = sessionId && state[sessionId] !== undefined;

  if (isGatePassed || !sessionExists) {
    console.log(JSON.stringify({ decision: "allow" }));
  } else {
    console.log(
      JSON.stringify({
        decision: "deny",
        reason: `ENFORCER BLOCK: The tool '${toolName}' is blocked because the Novahiz Gate has not passed. Call novahiz_gate with your session_id to unlock.`,
      }),
    );
  }
}

main().catch((err) => {
  // On any error, allow — never block the agent due to a hook crash
  console.log(
    JSON.stringify({
      decision: "allow",
      reason: "Error in enforcer hook — failing open",
    }),
  );
});
