import { NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Promise<NextResponse>((resolve) => {
    const configDir = path.join(os.homedir(), ".gemini", "config");
    const scriptPath = path.join(configDir, "scripts", "novahiz_stats_json.py");

    execFile(
      "python",
      [scriptPath],
      { timeout: 4000 },
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            "Failed to execute Python stats script:",
            error,
            stderr,
          );
          return resolve(
            NextResponse.json(
              { success: false, error: "Database query failed" },
              { status: 500 },
            ),
          );
        }

        try {
          const data = JSON.parse(stdout);
          resolve(NextResponse.json(data));
        } catch (err) {
          resolve(
            NextResponse.json(
              { success: false, error: "Malformed JSON from telemetry engine" },
              { status: 500 },
            ),
          );
        }
      },
    );
  });
}
