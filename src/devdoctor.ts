/**
 * Development-environment diagnosis.
 *
 * Three failures cost this project hours and none of them announced themselves:
 * an orphaned `next dev` still holding a port, a Turbopack cache purged while a
 * server ran, and `next/font` failing on a network whose IPv6 route is dead. Each
 * one looks like "the app is broken" until you measure it.
 */
import { connect } from "node:net";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type PortState = {
  port: number;
  listening: boolean;
  /** HTTP status when the port answers to GET /, null otherwise. */
  httpStatus: number | null;
};

export type FontProbe = {
  checked: boolean;
  ok: boolean;
  detail: string;
  advice: string | null;
};

export type DevReport = {
  projectRoot: string;
  ports: PortState[];
  nextCache: { present: boolean; sizeBytes: number | null };
  warnings: string[];
  fonts: FontProbe;
};

function probePort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (value: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function httpStatus(port: number, timeoutMs: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    return response.status;
  } catch {
    return null;
  }
}

function directorySize(path: string): number | null {
  // Du is enough here; a missing path is not an error.
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export async function devDoctor(options: {
  projectRoot: string;
  ports?: number[];
  probeFonts?: boolean;
  probeHttp?: boolean;
  timeoutMs?: number;
}): Promise<DevReport> {
  const projectRoot = options.projectRoot;
  const ports = options.ports ?? Array.from({ length: 8 }, (_, index) => 3000 + index);
  const timeoutMs = Math.max(Number(options.timeoutMs) || 400, 50);
  const probeHttp = options.probeHttp !== false;

  const states: PortState[] = [];
  for (const port of ports) {
    const listening = await probePort(port, timeoutMs);
    states.push({
      port,
      listening,
      httpStatus: listening && probeHttp ? await httpStatus(port, Math.max(timeoutMs * 4, 1500)) : null,
    });
  }

  const nextDir = join(projectRoot, ".next");
  const nextCache = { present: existsSync(nextDir), sizeBytes: directorySize(nextDir) };

  const warnings: string[] = [];
  const devServers = states.filter((state) => state.listening && state.httpStatus !== null);
  if (devServers.length > 1) {
    warnings.push(
      `${devServers.length} serveurs répondent (${devServers.map((s) => s.port).join(", ")}). ` +
        `Next refuse d'en démarrer un second : travaille sur celui qui écoute, ou arrête-le explicitement.`,
    );
  }
  if (nextCache.present && devServers.length > 0) {
    warnings.push(
      `.next existe et un serveur tourne : ne jamais purger .next maintenant — Next panique sur un cache disparu. ` +
        `Arrêter le serveur d'abord.`,
    );
  }
  /*
   * NX-40 : un serveur figé accepte les connexions TCP et ne répond jamais en
   * HTTP. Il n'entrait dans aucun compteur — `devServers` ne retient que les
   * ports qui répondent — donc `dev doctor` affichait « aucun serveur » alors
   * que le port était pris. Constaté deux fois le 2026-10-31 : Next refusait
   * d'en démarrer un second, et toutes les requêtes expiraient.
   */
  const figes = states.filter((state) => state.listening && state.httpStatus === null);
  if (figes.length > 0) {
    warnings.push(
      `${figes.length} port(s) acceptent les connexions sans jamais répondre en HTTP (${figes
        .map((state) => state.port)
        .join(", ")}). ` +
        `C'est un serveur figé : le port reste pris et Next refusera d'en démarrer un autre. ` +
        `Trouver le processus (Get-NetTCPConnection -LocalPort <port>, ou lsof -i :<port>) et l'arrêter avant de relancer.`,
    );
  }

  const fonts: FontProbe = options.probeFonts === false
    ? { checked: false, ok: true, detail: "sonde désactivée", advice: null }
    : await probeFonts(timeoutMs);

  return { projectRoot, ports: states, nextCache, warnings, fonts };
}

async function probeFonts(timeoutMs: number): Promise<FontProbe> {
  try {
    const response = await fetch("https://fonts.gstatic.com/", {
      method: "HEAD",
      signal: AbortSignal.timeout(Math.max(timeoutMs * 8, 3000)),
    });
    if (response.ok || response.status === 404) {
      // 404 is a valid answer from the CDN root: the network path works.
      return { checked: true, ok: true, detail: `fonts.gstatic.com joignable (${response.status})`, advice: null };
    }
    return {
      checked: true,
      ok: false,
      detail: `fonts.gstatic.com répond ${response.status}`,
      advice: "si le serveur Next échoue sur @vercel/turbopack-next/internal/font/google, démarrer avec --webpack",
    };
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as Error)?.name ?? "inconnu";
    return {
      checked: true,
      ok: false,
      detail: `fonts.gstatic.com injoignable (${code})`,
      advice:
        "réseau IPv6/DNS suspect. Vérifier avec node -e \"fetch('https://fonts.gstatic.com').then(r=>console.log(r.status))\". " +
        "Si Node passe mais pas le bundler : npx next dev --webpack. Ne pas modifier le hosts sans droits admin.",
    };
  }
}
