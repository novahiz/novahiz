import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { exec, spawn } from "child_process";

const configDir = path.join(os.homedir(), ".gemini", "config");
const sessionStatePath = path.join(configDir, "novahiz-session-state.json");
const obsidianVaultDir = path.join(os.homedir(), "Documents", "novahiz");
const obsidianSessionsDir = path.join(obsidianVaultDir, "Novahiz-Sessions");
const dashboardDir = path.join(os.homedir(), ".gemini", "dashboard");

function ensureDashboardRunning() {
  const socket = new net.Socket();
  socket.setTimeout(400);

  socket.on("connect", () => {
    socket.destroy();
  });

  socket.on("timeout", () => {
    socket.destroy();
    spawnDashboard();
  });

  socket.on("error", () => {
    spawnDashboard();
  });

  socket.connect(3456, "127.0.0.1");
}

function spawnDashboard() {
  try {
    if (fs.existsSync(dashboardDir)) {
      const isWin = process.platform === "win32";
      const cmd = isWin ? "npm.cmd" : "npm";
      const child = spawn(cmd, ["run", "start"], {
        cwd: dashboardDir,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }
  } catch (e) {
    // Non-blocking
  }
}

async function main() {
  const inputData = fs.readFileSync(0, "utf-8");
  if (!inputData) {
    console.log(JSON.stringify({}));
    return;
  }

  let payload: any = {};
  try {
    payload = JSON.parse(inputData);
  } catch (e) {
    console.log(JSON.stringify({}));
    return;
  }

  const sessionId = payload.conversationId || "default-session";
  const isStopEvent = payload.terminationReason !== undefined;

  // Load session state
  let state: any = {};
  if (fs.existsSync(sessionStatePath)) {
    try {
      state = JSON.parse(fs.readFileSync(sessionStatePath, "utf-8"));
    } catch (e) {
      state = {};
    }
  }

  if (!state[sessionId]) {
    state[sessionId] = {
      startedAt: new Date().toISOString(),
      gatePassed: false,
      mutationCount: 0,
      skillsLoaded: [],
      filesModified: [],
    };
  }

  state[sessionId].lastActivity = new Date().toISOString();
  fs.writeFileSync(sessionStatePath, JSON.stringify(state, null, 2));

  if (isStopEvent) {
    // 1. Trigger background sync to SQLite
    const migrateScript = path.join(configDir, "scripts", "novahiz_migrate.py");
    if (fs.existsSync(migrateScript)) {
      exec(`python "${migrateScript}"`, () => {});
    }

    // 2. Automated Obsidian session note sync
    try {
      if (fs.existsSync(obsidianVaultDir)) {
        if (!fs.existsSync(obsidianSessionsDir)) {
          fs.mkdirSync(obsidianSessionsDir, { recursive: true });
        }

        const sessionData = state[sessionId] || {};
        const now = new Date();
        const dateStr = now.toISOString().split("T")[0];
        const noteFilename = `Session-${dateStr}-${sessionId.slice(0, 8)}.md`;
        const notePath = path.join(obsidianSessionsDir, noteFilename);

        const noteContent = `---
type: session-log
session_id: "${sessionId}"
date: "${dateStr}"
timestamp: "${now.toISOString()}"
gate_passed: ${sessionData.gatePassed || false}
category: "${sessionData.requestCategory || "Uncategorized"}"
mutations: ${sessionData.mutationCount || 0}
tags:
  - novahiz
  - session-audit
  - antigravity
---

# 📋 Novahiz Session Log — ${dateStr}

- **Session ID** : \`${sessionId}\`
- **Démarrage** : ${sessionData.startedAt || "N/A"}
- **Fin / Arrêt** : ${now.toISOString()}
- **Raison d'arrêt** : \`${payload.terminationReason || "normal"}\`
- **Statut Gate** : ${sessionData.gatePassed ? "🟢 PASS" : "🔴 FAIL / PENDING"}
- **Catégorie** : **${sessionData.requestCategory || "Général"}**
- **Mutations de fichiers** : ${sessionData.mutationCount || 0}

## 🛠️ Skills & Fichiers
- **Skills actifs** : ${Array.isArray(sessionData.skillsLoaded) && sessionData.skillsLoaded.length > 0 ? sessionData.skillsLoaded.join(", ") : "Standards"}
- **Fichiers modifiés** : ${Array.isArray(sessionData.filesModified) && sessionData.filesModified.length > 0 ? sessionData.filesModified.map((f: string) => `\`${f}\``).join(", ") : "Aucun direct"}

---
*Généré automatiquement par le Hook de Clôture Novahiz.*
`;

        fs.writeFileSync(notePath, noteContent, "utf-8");
      }
    } catch (obsidianErr) {
      // Non-blocking error
    }

    console.log(JSON.stringify({}));
  } else {
    // PreInvocation event: Guarantee Dashboard is always running!
    ensureDashboardRunning();

    console.log(
      JSON.stringify({
        injectSteps: [],
      }),
    );
  }
}

main().catch(() => {
  console.log(JSON.stringify({}));
});
