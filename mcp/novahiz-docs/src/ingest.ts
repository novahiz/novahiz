// Ingestion réseau de novahiz-docs — la SEULE partie du serveur qui parle HTTP.
//
// Chaîne de replis, dans l'ordre :
//   1. llms.txt        index markdown pensé pour les agents, quand il existe ;
//   2. raw.githubusercontent  README du dépôt catalogue, quand llms.txt est
//                      absent ou illisible (la preuve de ce repli est exigée) ;
//   3. sitemap.xml     puis quelques pages HTML converties en texte.
//
// Avant toute requête d'un même origine : robots.txt (RFC 9309) et ses
// Content-Signal — `ai-input=no` signifie pas de RAG, on n'indexe pas. Une
// cadence minimale (une seconde par origine par défaut) sépare les requêtes,
// GITHUB_TOKEN reste optionnel. Chaque décision atterrit dans le journal
// d'ingestion : c'est la preuve, pas un commentaire en dur.

import type { DatabaseSync } from "node:sqlite";
import type { CatalogEntry } from "./catalog.ts";
import { splitMarkdown } from "./chunk.ts";
import { indexPage } from "./store.ts";

export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<FetchResponse>;

export interface IngestOptions {
  /** Injection pour les tests hors-ligne (défaut : fetch du runtime). */
  fetchImpl?: FetchLike;
  /** Cadence minimale entre deux requêtes vers un même origine, en ms. */
  minIntervalMs?: number;
  /** Nombre maximal de pages suivies depuis le sitemap (défaut 5). */
  maxSitemapPages?: number;
  /** Jeton GitHub optionnel (défaut : variable d'environnement GITHUB_TOKEN). */
  githubToken?: string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export type LogOutcome =
  | "checked"
  | "indexed"
  | "absent"
  | "blocked-robots"
  | "blocked-signal"
  | "http-error"
  | "unusable";

export interface LogEntry {
  step: string;
  url: string;
  outcome: LogOutcome;
  detail?: string;
}

export type IngestSource = "llms.txt" | "readme" | "sitemap";

export interface IngestResult {
  library: string;
  indexed: boolean;
  source: IngestSource | null;
  chunks: number;
  license: string;
  log: LogEntry[];
}

// Identité honnête : le User-Agent dit ce qu'est le robot, sans prétention.
const DEFAULT_UA = "novahiz-docs (documentation index local; robots.txt et Content-Signal respectes)";
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SITEMAP_PAGES = 5;

// --- robots.txt (RFC 9309) et Content-Signal -------------------------------

export interface RobotsRules {
  /** Patterns Disallow retenus (le Allow le plus long gagne, ex-aequo : Allow). */
  disallowed: string[];
  allow: string[];
  aiInput: boolean;
}

const OPEN_RULES: RobotsRules = { disallowed: [], allow: [], aiInput: true };

interface RobotsGroup {
  agents: string[];
  rules: Array<{ kind: "allow" | "disallow"; pattern: string }>;
  signals: string[];
}

function parseContentSignal(value: string): boolean | null {
  // Format : paires séparées par des virgules, clé=valeur — « ai-input=no ».
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim().toLowerCase();
    if (key !== "ai-input") continue;
    const flag = pair.slice(separator + 1).trim().toLowerCase();
    if (flag === "no" || flag === "false") return false;
    if (flag === "yes" || flag === "true") return true;
  }
  return null;
}

/**
 * Lecture d'un robots.txt pour notre jeton d'agent. Les groupes qui nous
 * nomment priment sur le groupe `*` ; faute de tout groupe applicable, la
 * RFC 9309 autorise (fichier absent ou inaccessible).
 */
export function parseRobots(text: string, agentToken: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let group: RobotsGroup | null = null;
  let lastKey = "";
  const token = agentToken.toLowerCase();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) {
      group = null;
      lastKey = "";
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      // Une ligne d'agent après des règles ouvre un nouveau groupe.
      if (group === null || lastKey === "allow" || lastKey === "disallow" || lastKey === "content-signal") {
        group = { agents: [], rules: [], signals: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      lastKey = "user-agent";
      continue;
    }
    if (key === "allow" || key === "disallow") {
      if (group === null) {
        group = { agents: [], rules: [], signals: [] };
        groups.push(group);
      }
      group.rules.push({ kind: key, pattern: value });
      lastKey = key;
      continue;
    }
    if (key === "content-signal") {
      if (group === null) {
        group = { agents: [], rules: [], signals: [] };
        groups.push(group);
      }
      group.signals.push(value);
      lastKey = key;
      continue;
    }
    lastKey = key;
  }

  const named = groups.filter((candidate) => candidate.agents.includes(token));
  const applicable = named.length > 0 ? named : groups.filter((candidate) => candidate.agents.includes("*"));
  if (applicable.length === 0) return { ...OPEN_RULES };

  const rules: RobotsRules = { disallowed: [], allow: [], aiInput: true };
  for (const candidate of applicable) {
    for (const rule of candidate.rules) {
      if (rule.pattern.length === 0) continue;
      if (rule.kind === "allow") rules.allow.push(rule.pattern);
      else rules.disallowed.push(rule.pattern);
    }
    for (const signal of candidate.signals) {
      const decision = parseContentSignal(signal);
      if (decision !== null) rules.aiInput = decision;
    }
  }
  return rules;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}`);
}

/** Plus long motif applicable : Disallow gagne, ex-aequo : Allow (RFC 9309). */
export function blockedBy(rules: RobotsRules, path: string): string | null {
  let best: { pattern: string; blocked: boolean } | null = null;
  for (const pattern of rules.disallowed) {
    if (!patternToRegex(pattern).test(path)) continue;
    if (best === null || pattern.length >= best.pattern.length) best = { pattern, blocked: true };
  }
  for (const pattern of rules.allow) {
    if (!patternToRegex(pattern).test(path)) continue;
    if (best === null || pattern.length > best.pattern.length) best = { pattern, blocked: false };
  }
  return best !== null && best.blocked ? best.pattern : null;
}

// --- Conversion HTML -> texte ----------------------------------------------

/**
 * Extraction grossière mais honnête du texte utile : les titres H1-H3
 * redeviennent des titres markdown (le chunker retrouve ses frontières), les
 * blocs deviennent des paragraphes, le reste du balisage disparaît.
 */
export function htmlToText(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(
    /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_match: string, level: string, inner: string) =>
      `\n\n${"#".repeat(Number(level))} ${inner.replace(/<[^>]+>/g, " ")}\n\n`
  );
  text = text.replace(
    /<\/(p|div|section|article|li|tr|pre|blockquote|ul|ol|table|header|footer|nav|main|aside|figcaption)>/gi,
    "\n\n"
  );
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Un index llms.txt valide commence (BOM compris) par un titre H1. */
export function isLlmsIndex(text: string): boolean {
  const withoutBom = text.replace(/^\uFEFF/, "");
  const firstLine = withoutBom.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  return /^#\s+\S/.test(firstLine.trim());
}

function detectLicense(text: string): string {
  if (/AGPL|AFFERO/i.test(text)) return "AGPL-3.0";
  if (/Lesser General Public/i.test(text)) return "LGPL-3.0";
  if (/General Public License/i.test(text)) return "GPL-3.0";
  if (/Mozilla Public License/i.test(text)) return "MPL-2.0";
  if (/Apache License/i.test(text)) return "Apache-2.0";
  if (/MIT License/i.test(text)) return "MIT";
  if (/Redistribution and use/i.test(text)) return "BSD-3-Clause";
  return "unknown";
}

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"];

// --- Le moteur --------------------------------------------------------------

export interface Ingester {
  ingest(entry: CatalogEntry, db: DatabaseSync): Promise<IngestResult>;
}

export function createIngester(options: IngestOptions = {}): Ingester {
  const fetchImpl: FetchLike =
    options.fetchImpl ??
    ((url, init) => fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) }));
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_INTERVAL_MS;
  const maxSitemapPages = Math.max(1, options.maxSitemapPages ?? DEFAULT_SITEMAP_PAGES);
  const token = options.githubToken ?? process.env.GITHUB_TOKEN ?? null;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const userAgent = options.userAgent ?? DEFAULT_UA;

  const robotsCache = new Map<string, Promise<RobotsRules>>();
  const lastFetchAt = new Map<string, number>();

  async function throttle(origin: string): Promise<void> {
    const previous = lastFetchAt.get(origin) ?? Number.NEGATIVE_INFINITY;
    const wait = previous + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastFetchAt.set(origin, now());
  }

  async function httpGet(url: string): Promise<FetchResponse> {
    const parsed = new URL(url);
    await throttle(parsed.origin);
    const headers: Record<string, string> = { "user-agent": userAgent, accept: "*/*" };
    if (token !== null && (parsed.host === "raw.githubusercontent.com" || parsed.host === "api.github.com")) {
      headers.authorization = `Bearer ${token}`;
    }
    return fetchImpl(url, { headers });
  }

  function robotsFor(url: string, log: LogEntry[]): Promise<RobotsRules> {
    const origin = new URL(url).origin;
    let pending = robotsCache.get(origin);
    if (pending === undefined) {
      const robotsUrl = `${origin}/robots.txt`;
      pending = httpGet(robotsUrl)
        .then(async (response) => {
          if (!response.ok) {
            // RFC 9309 : fichier absent = aucune restriction, et on le dit.
            log.push({ step: "robots", url: robotsUrl, outcome: "absent", detail: "RFC 9309 : aucune restriction" });
            return { ...OPEN_RULES };
          }
          const rules = parseRobots(await response.text(), "novahiz-docs");
          log.push({
            step: "robots",
            url: robotsUrl,
            outcome: "checked",
            detail: `ai-input=${rules.aiInput ? "yes" : "no"}, ${rules.disallowed.length} disallow, ${rules.allow.length} allow`
          });
          return rules;
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          log.push({ step: "robots", url: robotsUrl, outcome: "http-error", detail });
          return { ...OPEN_RULES }; // Injoignable : traité comme vide (RFC 9309)
        });
      robotsCache.set(origin, pending);
    }
    return pending;
  }

  async function checkAccess(url: string, step: string, log: LogEntry[]): Promise<boolean> {
    const rules = await robotsFor(url, log);
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    const pattern = blockedBy(rules, path);
    if (pattern !== null) {
      log.push({ step, url, outcome: "blocked-robots", detail: `Disallow: ${pattern}` });
      return false;
    }
    if (!rules.aiInput) {
      log.push({ step, url, outcome: "blocked-signal", detail: "Content-Signal: ai-input=no" });
      return false;
    }
    return true;
  }

  async function fetchLicense(entry: CatalogEntry, log: LogEntry[]): Promise<string> {
    for (const file of LICENSE_FILES) {
      const url = `https://raw.githubusercontent.com/${entry.repo}/HEAD/${file}`;
      if (!(await checkAccess(url, "license", log))) return "unknown";
      try {
        const response = await httpGet(url);
        if (!response.ok) {
          log.push({ step: "license", url, outcome: "absent", detail: `HTTP ${response.status}` });
          continue;
        }
        const license = detectLicense(await response.text());
        log.push({ step: "license", url, outcome: "indexed", detail: license });
        return license;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log.push({ step: "license", url, outcome: "http-error", detail });
        return "unknown";
      }
    }
    log.push({ step: "license", url: `github:${entry.repo}`, outcome: "absent" });
    return "unknown";
  }

  function indexText(
    db: DatabaseSync,
    entry: CatalogEntry,
    url: string,
    license: string,
    text: string
  ): number {
    const chunks = splitMarkdown(text);
    indexPage(
      db,
      { library: entry.id, version: "", sourceUrl: url, license, fetchedAt: new Date(now()).toISOString() },
      chunks
    );
    return chunks.length;
  }

  async function tryStep(
    db: DatabaseSync,
    entry: CatalogEntry,
    step: LogEntry["step"],
    source: IngestSource,
    url: string,
    license: string,
    log: LogEntry[]
  ): Promise<number | null> {
    if (!(await checkAccess(url, step, log))) return null;
    let response: FetchResponse;
    try {
      response = await httpGet(url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.push({ step, url, outcome: "http-error", detail });
      return null;
    }
    if (!response.ok) {
      log.push({ step, url, outcome: "absent", detail: `HTTP ${response.status}` });
      return null;
    }
    const body = await response.text();
    if (source === "llms.txt" && !isLlmsIndex(body)) {
      log.push({ step, url, outcome: "unusable", detail: "H1 absent : ce n'est pas un index llms.txt" });
      return null;
    }
    const content = source === "sitemap" ? htmlToText(body) : body;
    if (content.trim().length === 0) {
      log.push({ step, url, outcome: "unusable", detail: "corps vide apres extraction" });
      return null;
    }
    const chunks = indexText(db, entry, url, license, content);
    log.push({ step, url, outcome: "indexed", detail: `${chunks} passages` });
    return chunks;
  }

  async function fromSitemap(
    db: DatabaseSync,
    entry: CatalogEntry,
    license: string,
    log: LogEntry[]
  ): Promise<number | null> {
    const origin = new URL(entry.docsUrl).origin;
    const sitemapUrl = `${origin}/sitemap.xml`;
    if (!(await checkAccess(sitemapUrl, "sitemap", log))) return null;
    let body: string;
    try {
      const response = await httpGet(sitemapUrl);
      if (!response.ok) {
        log.push({ step: "sitemap", url: sitemapUrl, outcome: "absent", detail: `HTTP ${response.status}` });
        return null;
      }
      body = await response.text();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.push({ step: "sitemap", url: sitemapUrl, outcome: "http-error", detail });
      return null;
    }
    const locations = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((match) => match[1])
      .filter((loc) => {
        try {
          return new URL(loc).origin === origin;
        } catch {
          return false;
        }
      })
      .slice(0, maxSitemapPages);
    if (locations.length === 0) {
      log.push({ step: "sitemap", url: sitemapUrl, outcome: "unusable", detail: "aucune loc exploitable" });
      return null;
    }
    log.push({ step: "sitemap", url: sitemapUrl, outcome: "indexed", detail: `${locations.length} pages suivies` });
    let total = 0;
    for (const page of locations) {
      const chunks = await tryStep(db, entry, "page", "sitemap", page, license, log);
      if (chunks !== null) total += chunks;
    }
    return total > 0 ? total : null;
  }

  async function ingest(entry: CatalogEntry, db: DatabaseSync): Promise<IngestResult> {
    const log: LogEntry[] = [];
    const license = await fetchLicense(entry, log);
    const base: IngestResult = { library: entry.id, indexed: false, source: null, chunks: 0, license, log };

    // 1. llms.txt — l'entrée du catalogue si mesurée, sinon probe sur l'origine.
    const llmsUrl = entry.llmsTxt ?? new URL("/llms.txt", entry.docsUrl).toString();
    const fromLlms = await tryStep(db, entry, "llms.txt", "llms.txt", llmsUrl, license, log);
    if (fromLlms !== null) return { ...base, indexed: true, source: "llms.txt", chunks: fromLlms };

    // 2. Repli README sur raw.githubusercontent — la preuve exigée vaut ici.
    const readmeUrl = `https://raw.githubusercontent.com/${entry.repo}/HEAD/README.md`;
    const fromReadme = await tryStep(db, entry, "readme", "readme", readmeUrl, license, log);
    if (fromReadme !== null) return { ...base, indexed: true, source: "readme", chunks: fromReadme };

    // 3. Dernier repli : sitemap, puis quelques pages HTML du site officiel.
    const fromSitemapPages = await fromSitemap(db, entry, license, log);
    if (fromSitemapPages !== null) return { ...base, indexed: true, source: "sitemap", chunks: fromSitemapPages };

    return base;
  }

  return { ingest };
}
