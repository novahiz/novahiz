import type { Cleanup, Context, Plugin } from "@opencode/plugin/promise/plugin";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Plugin dedie a l'economie de tokens: troncature des sorties d'outils
// volumineuses, opt-in strict (desactive tant que NOVAHIZ_TOKEN_ECONOMY n'est
// pas pose) et estimation affichee a l'ecran. Il ne touche ni au gate ni a la
// memoire auto de novahiz-plugin.ts - les deux restent independants.
//
// Le contrat de non-degradation: on ne tronque que des outils de LOGS (shell,
// grep, webfetch...), jamais read/edit/write ni skill, la sortie complete est
// ecrite sur disque avant la troncature, et le pied de page dit au mode ou la
// relire. Un echec quelconque est fail-open: le resultat d'outil passe intact.

const HOME =
  process.env.NOVAHIZ_HOME && process.env.NOVAHIZ_HOME.length > 0
    ? process.env.NOVAHIZ_HOME
    : join(homedir(), ".config", "novahiz");

// Convention mesurable reprise de src/commands/tokens.ts: 80 octets/ligne et
// 25 tokens/ligne => 3.2 octets par token. Une seule valeur arithmetique aux
// deux endroits, l'estimation reste comparable.
export const BYTES_PER_TOKEN = 3.2;

const DEFAULT_MAX_LINES = 120;
const DEFAULT_MAX_BYTES = 16_384;
// Outils dont la sortie est du BRUIT (logs, listings, extraits web). Les
// outils qui portent du CONTENU a editer (read, edit, write, skill, question,
// memoire, ledger) ne sont jamais tronques par defaut.
const DEFAULT_TOOLS = ["shell", "execute", "bash", "webfetch", "grep", "glob"];

function envFlag(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(raw);
}

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : fallback;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = (process.env[name] ?? "").trim();
  if (raw.length === 0) return fallback;
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export const ENABLED = envFlag("NOVAHIZ_TOKEN_ECONOMY");
export const MAX_LINES = envInt("NOVAHIZ_TE_MAX_LINES", DEFAULT_MAX_LINES);
export const MAX_BYTES = envInt("NOVAHIZ_TE_MAX_BYTES", DEFAULT_MAX_BYTES);
const DUMP_DIR =
  process.env.NOVAHIZ_TE_DUMP_DIR && process.env.NOVAHIZ_TE_DUMP_DIR.length > 0
    ? process.env.NOVAHIZ_TE_DUMP_DIR
    : join(HOME, "tmp", "tool-output");
const TOOLS = new Set(envList("NOVAHIZ_TE_TOOLS", DEFAULT_TOOLS));

export type TruncationPlan = {
  keep: string;
  truncated: boolean;
  headLines: number;
  totalLines: number;
  bytesBefore: number;
  bytesAfter: number;
};

export function estimateTokens(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / BYTES_PER_TOKEN);
}

function kilo(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Decoupe pure et testable: on garde la tete, ligne a ligne, sous les deux
// budgets (lignes ET octets). Sous les deux seuils, rien ne bouge.
export function planTruncation(text: string, maxLines: number, maxBytes: number): TruncationPlan {
  const lines = text.split("\n");
  const bytesBefore = Buffer.byteLength(text, "utf8");
  if (lines.length <= maxLines && bytesBefore <= maxBytes) {
    return {
      keep: text,
      truncated: false,
      headLines: lines.length,
      totalLines: lines.length,
      bytesBefore,
      bytesAfter: bytesBefore
    };
  }
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (kept.length >= maxLines) break;
    const cost = Buffer.byteLength(line, "utf8") + 1;
    if (used + cost > maxBytes) break;
    kept.push(line);
    used += cost;
  }
  // Une seule ligne plus large que le budget d'octets laisserait une tete
  // vide: on garde alors un prefixe d'octets, coupe sur une frontiere de
  // caractere UTF-8, plutot que de rendre un resultat sans contenu.
  const keep =
    kept.length > 0
      ? kept.join("\n")
      : Buffer.from(text, "utf8")
          .subarray(0, Math.max(1, maxBytes))
          .toString("utf8")
          .replace(/\uFFFD+$/, "");
  return {
    keep,
    truncated: true,
    headLines: kept.length > 0 ? kept.length : 1,
    totalLines: lines.length,
    bytesBefore,
    bytesAfter: Buffer.byteLength(keep, "utf8")
  };
}

// Le pied de page est l'instruction de recuperation: il dit au mode ce qui a
// ete retire, combien, et OU relire - sans cela, la troncature force un
// re-run, ce qui coute plus cher que ce qu'elle a epargne.
export function buildFooter(tool: string, plan: TruncationPlan, dumpPath: string | null): string {
  const saved = Math.max(0, plan.bytesBefore - plan.bytesAfter);
  const head = [
    `[Novahiz token-economy] truncated ${tool}: kept ${plan.headLines} of ${plan.totalLines} lines`,
    `(${kilo(plan.bytesAfter)} of ${kilo(plan.bytesBefore)}, ~${estimateTokens(saved)} tokens saved)`
  ].join(" ");
  if (dumpPath) return `${head}. Full output: ${dumpPath} - grep that file instead of re-running the command.`;
  return `${head}. Full output unavailable (dump failed) - re-run only if you need the rest.`;
}

export function contentText(content: unknown): string | null {
  if (typeof content === "string") return content.length > 0 ? content : null;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

type Stats = { outputs: number; before: number; after: number };

export function formatStats(stats: Stats, enabled: boolean): string {
  const savedBytes = Math.max(0, stats.before - stats.after);
  const state = enabled ? "ON" : "OFF (set NOVAHIZ_TOKEN_ECONOMY=1 to enable)";
  return [
    `[Novahiz token-economy] ${state}`,
    `outputs truncated: ${stats.outputs}`,
    `bytes kept: ${kilo(stats.before)} -> ${kilo(stats.after)}`,
    `estimated saved: ${kilo(savedBytes)} (~${estimateTokens(savedBytes)} tokens, ${BYTES_PER_TOKEN} bytes/token)`
  ].join("\n");
}

function log(message: string): void {
  // Canal console: c'est ce que capturent les logs opencode (--print-logs).
  console.log(`[Novahiz token-economy] ${message}`);
}

function writeDump(tool: string, id: string, text: string): string | null {
  try {
    mkdirSync(DUMP_DIR, { recursive: true });
    const safeTool = tool.replace(/[^a-z0-9_-]/gi, "");
    const safeId = String(id).replace(/[^a-z0-9_-]/gi, "") || String(Date.now());
    const path = join(DUMP_DIR, `${safeTool}-${safeId}.txt`);
    writeFileSync(path, text, "utf8");
    return path;
  } catch {
    return null;
  }
}

async function setup(ctx: Context): Promise<Cleanup> {
  const statsBySession = new Map<string, Stats>();

  if (ENABLED) {
    await ctx.tool.hook("execute.after", async (event) => {
      // Fail-open par principe: le resultat d'outil ne doit jamais casser a
      // cause du plugin - toute exception se limite a un log.
      try {
        if (event.status !== "completed") return;
        const tool = event.tool.toLowerCase();
        if (!TOOLS.has(tool)) return;
        const result = event.result as { content?: unknown; metadata?: Record<string, unknown> } | undefined;
        if (!result || typeof result !== "object") return;
        if (result.metadata && result.metadata.truncated === true) return;
        const text = contentText(result.content);
        if (text === null) return;
        const plan = planTruncation(text, MAX_LINES, MAX_BYTES);
        if (!plan.truncated) return;

        const dumpPath = writeDump(tool, event.id, text);
        const replacement = `${plan.keep}\n${buildFooter(tool, plan, dumpPath)}`;
        // Mutation sur place plutot que remplacement de event.result: le
        // runtime peut tenir la reference de l'objet resultat - les deux
        // lectures voient alors la version tronquee.
        (result as { content?: unknown }).content = replacement;

        const stats = statsBySession.get(event.sessionID) ?? { outputs: 0, before: 0, after: 0 };
        stats.outputs += 1;
        stats.before += plan.bytesBefore;
        stats.after += Buffer.byteLength(replacement, "utf8");
        statsBySession.set(event.sessionID, stats);
        log(
          `truncated ${tool}: ${kilo(plan.bytesBefore)} -> ${kilo(plan.bytesAfter)} kept (~${estimateTokens(plan.bytesBefore - plan.bytesAfter)} tokens saved)`
        );
      } catch (error) {
        log(`skip: ${String(error).slice(0, 200)}`);
      }
    });
  }

  // Estimation affichee a l'ecran: la commande est enregistree meme quand le
  // plugin est coupe, pour que l'etat (et le rappel de la variable d'env)
  // reste consultable.
  await ctx.command.transform((editor) => {
    editor.add({
      name: "novahiz-tokens",
      description: "Show the tokens saved by the Novahiz token-economy plugin in this session",
      execute: async (input) => {
        const stats = statsBySession.get(input.sessionID) ?? { outputs: 0, before: 0, after: 0 };
        const text = formatStats(stats, ENABLED);
        log(text.replace(/\n/g, " | "));
        try {
          await ctx.session.synthetic({
            sessionID: input.sessionID,
            text,
            description: "novahiz token-economy"
          });
        } catch (error) {
          log(`display failed: ${String(error).slice(0, 200)}`);
        }
      }
    });
  });

  if (ENABLED) {
    log(`enabled (max ${MAX_LINES} lines / ${kilo(MAX_BYTES)}, tools: ${[...TOOLS].join(",")})`);
  }
  return () => undefined;
}

const tokenEconomyPlugin: Plugin = { id: "novahiz-token-economy", setup };
export default tokenEconomyPlugin;
