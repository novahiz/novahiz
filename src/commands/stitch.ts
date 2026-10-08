import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { type Parsed } from "./context.ts";

// `novahiz stitch` — configure la cle Google Stitch MCP dans la config
// OpenCode de l'utilisateur, depuis n'importe quel terminal (Windows, Linux,
// macOS), sans passer par OpenCode. Valeurs canones reprises du snippet
// officiel Stitch pour OpenCode (verifie E2E : handshake initialize -> 200).

export const STITCH_URL = "https://stitch.googleapis.com/mcp";
export const STITCH_HEADER = "X-Goog-Api-Key";

/** Repertoire de config OpenCode : XDG_CONFIG_HOME si defini, sinon ~/.config. */
export function opencodeConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim().length > 0 ? xdg : join(homedir(), ".config");
  const dir = join(base, "opencode");
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return join(dir, "opencode.jsonc");
}

type Json = Record<string, unknown>;

function isObj(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Ecrit/actualise mcp.stitch (type remote, url canonique, oauth:false,
 * header X-Goog-Api-Key, enabled). Deux chemins :
 *  - JSON simple (sans commentaire) : mutation d'objet puis re-serialization ;
 *  - JSONC (commentaires) : chirurgie textuelle ciblee — jamais de
 *    re-serialization qui detruirait les commentaires.
 */
export function applyStitchKey(raw: string, key: string): string {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (isObj(parsed)) {
    const mcp: Json = isObj(parsed.mcp) ? parsed.mcp : {};
    parsed.mcp = mcp;
    const existing = isObj(mcp.stitch) ? { ...mcp.stitch } : {};
    const headers = isObj(existing.headers) ? { ...existing.headers } : {};
    // Ancien format ("Authorization": "Bearer AQ....") remplace par l'header
    // officiel : les deux envoyes au serveur serait inutilement ambigu.
    delete headers.Authorization;
    headers[STITCH_HEADER] = key;
    mcp.stitch = { ...existing, type: "remote", url: STITCH_URL, oauth: false, headers, enabled: true };
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  return applyStitchKeyText(raw, key);
}

/** Trouve la } fermante en respectant chaines, echappements et commentaires. */
export function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "/" && next === "/") inLine = true;
    else if (c === "/" && next === "*") inBlock = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Localise le bloc "stitch": renvoie [debut accolade ouvrante, fin incluse]. */
function findStitchBlock(text: string): [number, number] | null {
  const m = /"stitch"\s*:\s*\{/.exec(text);
  if (!m || m.index === undefined) return null;
  const open = text.indexOf("{", m.index);
  const close = findMatchingBrace(text, open);
  return close === -1 ? null : [open, close];
}

function stitchObjectText(indent: string, key: string): string {
  return [
    `"stitch": {`,
    `${indent}  "type": "remote",`,
    `${indent}  "url": "${STITCH_URL}",`,
    `${indent}  "oauth": false,`,
    `${indent}  "headers": {`,
    `${indent}    "${STITCH_HEADER}": ${JSON.stringify(key)}`,
    `${indent}  },`,
    `${indent}  "enabled": true`,
    `${indent}}`
  ].join("\n");
}

function applyStitchKeyText(raw: string, key: string): string {
  const block = findStitchBlock(raw);
  if (block) {
    const [open, close] = block;
    let inner = raw.slice(open + 1, close);
    const keyValue = JSON.stringify(key);
    // Normalisation canonique meme en chemin texte : un bloc legacy
    // (type "sse", url /mcp/sse) laisserait un serveur qui ne se connecte pas.
    const typeRe = /"type"\s*:\s*"[^"]*"/;
    if (typeRe.test(inner)) inner = inner.replace(typeRe, '"type": "remote"');
    else inner = `\n  "type": "remote",` + inner;
    const urlRe = /"url"\s*:\s*"[^"]*"/;
    if (urlRe.test(inner)) inner = inner.replace(urlRe, `"url": ${JSON.stringify(STITCH_URL)}`);
    else inner += `, "url": ${JSON.stringify(STITCH_URL)}`;
    const oauthRe = /"oauth"\s*:\s*(true|false)/;
    if (oauthRe.test(inner)) inner = inner.replace(oauthRe, '"oauth": false');
    else inner = `\n  "oauth": false,` + inner;
    const existingHeader = new RegExp(`"${STITCH_HEADER}"\\s*:\\s*"[^"]*"`);
    if (existingHeader.test(inner)) {
      return raw.slice(0, open + 1) + inner.replace(existingHeader, `"${STITCH_HEADER}": ${keyValue}`) + raw.slice(close);
    }
    const legacy = /"Authorization"\s*:\s*"[^"]*"/;
    if (legacy.test(inner)) {
      return raw.slice(0, open + 1) + inner.replace(legacy, `"${STITCH_HEADER}": ${keyValue}`) + raw.slice(close);
    }
    const headersObj = /"headers"\s*:\s*\{/.exec(inner);
    if (headersObj) {
      const hOpen = inner.indexOf("{", headersObj.index);
      const hClose = findMatchingBrace(inner, hOpen);
      if (hClose !== -1) {
        const hInner = inner.slice(hOpen + 1, hClose);
        const insertion = hInner.trim().length === 0 ? `\n  "${STITCH_HEADER}": ${keyValue}\n` : `, "${STITCH_HEADER}": ${keyValue}`;
        const patched = inner.slice(0, hOpen + 1) + hInner + insertion + inner.slice(hClose);
        return raw.slice(0, open + 1) + patched + raw.slice(close);
      }
    }
    // Pas de headers du tout : on en injecte juste apres l'accolade ouvrante.
    const insertion = `\n  "headers": { "${STITCH_HEADER}": ${keyValue} },`;
    return raw.slice(0, open + 1) + insertion + inner + raw.slice(close);
  }
  // Pas de bloc stitch : on le cree dans "mcp", ou on cree "mcp", ou (dernier
  // recours) on ouvre le premier objet du document.
  const mcp = /"mcp"\s*:\s*\{/.exec(raw);
  if (mcp) {
    const open = raw.indexOf("{", mcp.index);
    const close = findMatchingBrace(raw, open);
    if (close !== -1) {
      const inner = raw.slice(open + 1, close);
      const insertion = inner.trim().length === 0 ? `\n    ${stitchObjectText("    ", key)}\n  ` : `,\n    ${stitchObjectText("    ", key)}`;
      return raw.slice(0, open + 1) + inner + insertion + raw.slice(close);
    }
  }
  if (raw.trimStart().startsWith("{")) {
    const open = raw.indexOf("{");
    const close = findMatchingBrace(raw, open);
    if (close !== -1) {
      const inner = raw.slice(open + 1, close);
      const insertion = inner.trim().length === 0 ? `\n  "mcp": {\n    ${stitchObjectText("    ", key)}\n  }\n` : `,\n  "mcp": {\n    ${stitchObjectText("    ", key)}\n  }`;
      return raw.slice(0, open + 1) + inner + insertion + raw.slice(close);
    }
  }
  return raw;
}

/** Retire les commentaires JSONC pour pouvoir valider sans les detruire. */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") {
        if (next !== undefined) {
          out += next;
          i++;
        }
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

export function isValidJsonc(text: string): boolean {
  try {
    JSON.parse(stripJsonComments(text));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lecture seule : la cle Google Stitch est-elle deja configurée dans la config
 * OpenCode ? Sert aux points d'onboarding (`second-memory init`) pour ne
 * recommander `novahiz stitch` que quand il manque vraiment quelque chose.
 */
export function stitchConfigured(): boolean {
  const path = opencodeConfigPath();
  if (!existsSync(path)) return false;
  try {
    const cfg = JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as {
      mcp?: { stitch?: { headers?: Record<string, unknown>; enabled?: boolean } };
    };
    const key = cfg.mcp?.stitch?.headers?.[STITCH_HEADER];
    return typeof key === "string" && key.length > 0;
  } catch {
    return false;
  }
}

function promptKey(): Promise<string> {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question("Colle ta cle API Google Stitch puis appuie sur Entree : ", (answer) => {
      rl.close();
      resolvePromise(answer.trim());
    });
  });
}

export async function commandStitch(parsed: Parsed): Promise<void> {
  const flagKey = typeof parsed.flags.key === "string" ? parsed.flags.key.trim() : "";
  const key = flagKey.length > 0 ? flagKey : await promptKey();
  if (key.length === 0) {
    process.stderr.write("novahiz stitch: annule (cle vide).\n");
    process.exitCode = 1;
    return;
  }
  if (!/^AQ\./.test(key)) {
    process.stderr.write("novahiz stitch: attention, le format attendu est AQ.* — la cle est ecrite quand meme.\n");
  }
  const path = opencodeConfigPath();
  const fallback = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const raw = existsSync(path) ? readFileSync(path, "utf8") : fallback;
  const next = applyStitchKey(raw, key);
  // Jamais d'ecriture d'un resultat invalide : on abandonne plutot que de
  // corrompre la config OpenCode.
  if (!isValidJsonc(next)) {
    process.stderr.write("novahiz stitch: arret — le resultat ne serait pas un JSON valide, rien n'a ete ecrit.\n");
    process.exitCode = 1;
    return;
  }
  if (existsSync(path)) copyFileSync(path, `${path}.novahiz-bak`);
  writeFileSync(path, next, "utf8");
  process.stdout.write(
    `Google Stitch MCP key updated in ${path}\n` +
      `  mcp.stitch: type remote, url ${STITCH_URL}, header ${STITCH_HEADER}\n` +
      "Restart OpenCode completely for the change to take effect.\n"
  );
}
