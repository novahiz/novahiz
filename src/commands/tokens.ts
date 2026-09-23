import { dbPathFor, emit, flagOn, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import * as ui from "../render.ts";

const AVG_LINE_BYTES = 80;
const AVG_TOKENS_PER_LINE = 25;

export function commandTokens(parsed: Parsed): void {
  const root = NovahizHome();
  const spec = loadSpec(root);
  const db = openDb(dbPathFor(root, spec));

  const enforcementEvents = (db.prepare("SELECT COUNT(*) AS n FROM enforcement_log").get() as { n: number }).n;
  const invocationEvents = (db.prepare("SELECT COUNT(*) AS n FROM skill_invocations").get() as { n: number }).n;
  const roadmapEvents = (db.prepare("SELECT COUNT(*) AS n FROM roadmap_progress").get() as { n: number }).n;
  const taskEvents = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  const todoEvents = (db.prepare("SELECT COUNT(*) AS n FROM todos").get() as { n: number }).n;

  const blocked = (db.prepare("SELECT COUNT(*) AS n FROM enforcement_log WHERE decision = 'block'").get() as { n: number }).n;
  const blockedBytes = blocked * AVG_LINE_BYTES;
  const blockedTokens = Math.round((blocked * AVG_LINE_BYTES) / AVG_TOKENS_PER_LINE);

  const byTool = db.prepare("SELECT tool, COUNT(*) AS n FROM enforcement_log GROUP BY tool ORDER BY n DESC").all() as { tool: string; n: number }[];
  const byDecision = db.prepare("SELECT decision, COUNT(*) AS n FROM enforcement_log GROUP BY decision ORDER BY n DESC").all() as { decision: string; n: number }[];

  db.close();

  const events = enforcementEvents + invocationEvents + roadmapEvents + taskEvents + todoEvents;

  const value = {
    events,
    enforcement: enforcementEvents,
    invocations: invocationEvents,
    roadmap: roadmapEvents,
    tasks: taskEvents,
    todos: todoEvents,
    blocked,
    estimatedBytesSaved: blockedBytes,
    estimatedTokensSaved: blockedTokens,
    byTool,
    byDecision
  };

  const calibrate = flagOn(parsed, "calibrate");

  emit(parsed, value, () => {
    const lines = [
      ui.heading("novahiz tokens"),
      "",
      ui.kv([
        ["events:", String(events)],
        ["enforcement:", String(enforcementEvents)],
        ["invocations:", String(invocationEvents)],
        ["roadmap:", String(roadmapEvents)],
        ["tasks:", String(taskEvents)],
        ["todos:", String(todoEvents)],
        ["blocked:", String(blocked)],
        ["est. bytes saved (~±5x):", ui.bytes(blockedBytes)],
        ["est. tokens saved (~±5x):", String(blockedTokens)]
      ]),
      "",
      ui.heading("By tool"),
      ui.table(["tool", "n"], byTool.map((row) => [row.tool, String(row.n)])),
      "",
      ui.heading("By decision"),
      ui.table(["decision", "n"], byDecision.map((row) => [row.decision, String(row.n)]))
    ];

    if (calibrate) {
      const bytesPerToken = AVG_LINE_BYTES / AVG_TOKENS_PER_LINE;
      lines.push(
        "",
        ui.heading("Calibration"),
        ui.kv([
          ["avg line bytes:", String(AVG_LINE_BYTES)],
          ["avg tokens/line:", String(AVG_TOKENS_PER_LINE)],
          ["bytes/token:", bytesPerToken.toFixed(1)]
        ])
      );
    }

    return lines.join("\n");
  });
}
