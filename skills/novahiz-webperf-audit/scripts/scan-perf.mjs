#!/usr/bin/env node
// scan-perf.mjs — détection déterministe des règles de performance mécaniques.
//
// Ce script ne juge pas à la place de l'agent : il fournit des faits
// localisés (fichier, ligne, extrait) pour les règles qui se constatent
// sans exécuter l'application. Les règles qui demandent une mesure ou une
// lecture d'architecture sont marquées "manual" dans la sortie.
//
// Usage : node scan-perf.mjs [--root <dir>] [--json] [--markdown] [--images] [--help]

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";

const HELP = `scan-perf.mjs — constat déterministe des règles de performance web

Usage:
  node scan-perf.mjs [options]

Options:
  --root <dir>   Racine du projet à scanner (défaut : répertoire courant)
  --json         Sortie JSON complète (défaut : résumé lisible)
  --markdown     Sortie en lignes de tableau Markdown
  --images       Constats liés aux images uniquement
  --help         Affiche cette aide

Sortie JSON :
  { root, stack, scanned, findings[], applicability[], unmeasured[] }

Code de sortie :
  0  scan terminé (des constats peuvent exister : ce script rapporte, il ne bloque pas)
  2  option invalide ou racine introuvable

Limites assumées :
  - analyse statique : aucune exécution, donc aucune métrique Core Web Vitals
  - les constats "low" sont des indices, pas des verdicts
  - tests, sauvegardes et dossiers de build sont ignorés (voir "scanned.skipped")
  - un fichier illisible est compté dans "skipped", jamais fatal
`;

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", ".next", ".nuxt",
  ".output", ".svelte-kit", "coverage", "vendor", ".venv", "venv", "__pycache__",
  ".turbo", ".cache", ".parcel-cache", ".expo", "ios", "android", ".idea", ".vscode",
  "backups", "backup", "logs", "tmp", ".search", ".snap", ".graph", ".novahiz",
  ".backup-novahiz-fixes-20261029", "old", "archive",
]);

const CODE_EXT = new Set([".html", ".htm", ".tsx", ".jsx", ".vue", ".svelte", ".astro", ".ts", ".js", ".mjs", ".cjs", ".php", ".rb", ".py", ".sql"]);
const STYLE_EXT = new Set([".css", ".scss", ".sass", ".less"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);
const VIEW_EXT = /\.(html|htm|tsx|jsx|vue|svelte|astro)$/i;
const CODE_FILE_EXT = /\.(tsx|jsx|vue|svelte|ts|js|mjs|cjs|php|rb|py)$/i;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 6000;

const SERVER_CONFIG = /(^|[\\/])(vercel\.json|netlify\.toml|next\.config\.(js|mjs|ts)|nuxt\.config\.(js|ts)|nginx[^\\/]*\.conf|\.htaccess|docker-compose\.ya?ml|Dockerfile|fly\.toml|render\.yaml|wrangler\.toml|server\.(js|mjs|ts))$/i;

const HEAVY_DEPS = [
  ["moment", "moment : ~70 Ko, remplaçable par date-fns ou Intl"],
  ["lodash", "lodash entier : imports ciblés ou lodash-es"],
  ["chart.js", "chart.js : lourd sur une page publique, à charger en différé"],
  ["@mui/icons-material", "icônes MUI : imports non ciblés = bundle qui explose"],
  ["three", "three : rarement justifié sur une page publique"],
  ["antd", "antd : bibliothèque complète pour quelques composants"],
];

function parseArgs(argv) {
  const opts = { root: process.cwd(), json: false, markdown: false, images: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--markdown") opts.markdown = true;
    else if (arg === "--images") opts.images = true;
    else if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) fail("--root attend un chemin");
      opts.root = value;
      i += 1;
    } else if (arg.startsWith("--root=")) {
      opts.root = arg.slice("--root=".length);
    } else {
      fail(`option inconnue : ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  process.stderr.write(`scan-perf: ${message}\n\n${HELP}`);
  process.exit(2);
}

function walk(root) {
  const files = [];
  const skipped = { unreadable: 0, tooLarge: 0, capped: false };
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      skipped.unreadable += 1;
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || /^backups?[-.]/.test(entry.name)) continue;
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_FILES) {
        skipped.capped = true;
        return { files, skipped };
      }
      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        skipped.unreadable += 1;
        continue;
      }
      if (size > MAX_FILE_BYTES) {
        skipped.tooLarge += 1;
        files.push({ path: full, size, ignoredContent: true });
        continue;
      }
      files.push({ path: full, size, ignoredContent: false });
    }
  }
  return { files, skipped };
}

function readText(file) {
  try {
    return readFileSync(file.path, "utf8");
  } catch {
    return null;
  }
}

function isTestPath(file) {
  return /(^|[\\/])(tests?|__tests__|e2e|specs?)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$/i.test(file);
}

function isScannerSelf(file) {
  return /novahiz-webperf-audit[\\/]scripts[\\/]scan-perf\.mjs$/i.test(file);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function excerpt(text, index, width = 110) {
  const start = Math.max(0, index - 20);
  const slice = text.slice(start, start + width).replace(/\s+/g, " ").trim();
  return slice.length > 0 ? slice : "(ligne vide)";
}

function evidenceOf(text, index, rel) {
  return { file: rel, line: lineOf(text, index), excerpt: excerpt(text, index) };
}

function detectStack(root, files) {
  const stack = {
    frameworks: [], backend: [], database: [], orm: [], cache: [], queue: [], ai: [],
    rum: [], virtualization: [], hosting: [], deps: [],
    hasPackageJson: false, hasSql: false, hasDocker: false, routeFiles: 0,
  };
  const pkg = files.find((f) => f.path === join(root, "package.json"));
  if (pkg) {
    const text = readText(pkg);
    if (text) {
      try {
        const json = JSON.parse(text);
        const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
        stack.deps = Object.keys(deps);
        const has = (...names) => names.some((name) => name in deps);
        if (has("next")) stack.frameworks.push("next");
        if (has("nuxt")) stack.frameworks.push("nuxt");
        if (has("@remix-run/react")) stack.frameworks.push("remix");
        if (has("astro")) stack.frameworks.push("astro");
        if (has("@sveltejs/kit", "svelte")) stack.frameworks.push("svelte");
        if (has("vue")) stack.frameworks.push("vue");
        if (has("react")) stack.frameworks.push("react");
        if (has("vite")) stack.frameworks.push("vite");
        if (has("express", "fastify", "koa", "hono", "@hapi/hapi")) stack.backend.push("node-server");
        if (has("prisma", "@prisma/client")) stack.orm.push("prisma");
        if (has("drizzle-orm")) stack.orm.push("drizzle");
        if (has("typeorm")) stack.orm.push("typeorm");
        if (has("sequelize")) stack.orm.push("sequelize");
        if (has("mongoose")) stack.database.push("mongodb");
        if (has("pg", "postgres", "@neondatabase/serverless")) stack.database.push("postgres");
        if (has("mysql2", "mysql")) stack.database.push("mysql");
        if (has("better-sqlite3", "sqlite3")) stack.database.push("sqlite");
        if (has("@supabase/supabase-js")) { stack.database.push("supabase"); stack.backend.push("baas"); }
        if (has("ioredis", "redis", "@upstash/redis")) stack.cache.push("redis");
        if (has("bullmq", "bull", "inngest", "@trigger.dev/sdk", "@upstash/qstash")) stack.queue.push("jobs");
        if (has("openai", "@anthropic-ai/sdk", "ai", "langchain", "@google/generative-ai")) stack.ai.push("llm");
        if (has("web-vitals", "@vercel/speed-insights", "@sentry/nextjs", "@sentry/browser", "@sentry/react")) stack.rum.push("rum");
        if (has("react-window", "react-virtualized", "@tanstack/react-virtual", "virtua")) stack.virtualization.push("react");
        stack.hasPackageJson = true;
      } catch {
        stack.hasPackageJson = false;
      }
    }
  }
  const names = new Set(files.map((f) => basename(f.path)));
  if (names.has("vercel.json") || [...names].some((n) => /^next\.config\./.test(n))) stack.hosting.push("vercel-like");
  if (names.has("netlify.toml")) stack.hosting.push("netlify");
  if (names.has("fly.toml")) stack.hosting.push("fly");
  if (names.has("render.yaml")) stack.hosting.push("render");
  if (names.has("wrangler.toml")) stack.hosting.push("cloudflare");
  if (names.has("docker-compose.yml") || names.has("docker-compose.yaml") || names.has("Dockerfile")) stack.hasDocker = true;
  stack.hasSql = files.some((f) => extname(f.path) === ".sql" || /schema\.prisma$/i.test(f.path));
  stack.routeFiles = files.filter((f) => /(^|[\\/])(routes?|pages?|app)[\\/]/i.test(f.path) && /\.(tsx|jsx|ts|js|vue|svelte|astro)$/.test(f.path)).length;
  return stack;
}

function applicabilityOf(n, stack) {
  const noDb = stack.database.length === 0 && stack.orm.length === 0 && !stack.hasSql;
  const unknownHost = stack.hosting.length === 0 && !stack.hasDocker;
  switch (n) {
    case 7:
      return stack.queue.length === 0 && stack.deps.every((d) => !/nodemailer|resend|sendgrid|postmark|puppeteer|pdfkit/i.test(d))
        ? { state: "unknown", reason: "aucune tâche lente détectée dans les dépendances (mail, export, IA)" }
        : { state: "applicable", reason: "trace de tâche lente ou de file de jobs" };
    case 8:
    case 17:
    case 25:
      return noDb
        ? { state: "inapplicable", reason: "aucune base de données détectée (ni ORM, ni SQL, ni client)" }
        : { state: "applicable", reason: `base détectée : ${[...stack.database, ...stack.orm].join(", ")}` };
    case 10:
      return stack.cache.length > 0
        ? { state: "applicable", reason: "client cache déjà présent" }
        : { state: "unknown", reason: "aucun cache partagé : pertinent seulement si lecture répétée sous charge" };
    case 13:
      return stack.ai.length === 0
        ? { state: "inapplicable", reason: "aucune dépendance IA détectée" }
        : { state: "applicable", reason: "fonctionnalité IA présente" };
    case 6:
    case 19:
    case 28:
      return unknownHost
        ? { state: "unknown", reason: "hébergement non constatable depuis le code" }
        : { state: "applicable", reason: `hébergement détecté : ${stack.hosting.join(", ") || "conteneur"}` };
    case 18:
      return stack.backend.length === 0
        ? { state: "unknown", reason: "aucun serveur applicatif propre détecté" }
        : { state: "applicable", reason: `backend détecté : ${stack.backend.join(", ")}` };
    case 20:
      if (["next", "nuxt", "remix", "astro", "svelte"].some((f) => stack.frameworks.includes(f))) {
        return { state: "applicable", reason: `framework avec rendu serveur : ${stack.frameworks.join(", ")}` };
      }
      if (stack.frameworks.includes("react") || stack.frameworks.includes("vue")) {
        return { state: "applicable", reason: "SPA : le rendu serveur est absent par construction" };
      }
      return { state: "unknown", reason: "stack front non identifiée" };
    case 23:
      return stack.virtualization.length > 0
        ? { state: "applicable", reason: "bibliothèque de virtualisation installée" }
        : { state: "unknown", reason: "à juger sur la taille réelle des listes" };
    case 30:
      return stack.rum.length > 0
        ? { state: "applicable", reason: "collecte RUM présente" }
        : { state: "applicable", reason: "aucune collecte RUM détectée" };
    case 31:
      return { state: "manual", reason: "exige une trace Lighthouse ou Playwright bridée" };
    case 14:
    case 16:
    case 26:
      return { state: "manual", reason: "demande la lecture des flux d'état, pas un motif textuel" };
    default:
      return { state: "manual", reason: "vérification par lecture ou par mesure" };
  }
}

function finding(n, id, title, verdict, confidence, evidence, note) {
  return { rule: n, id, title, verdict, confidence, count: evidence.length, evidence: evidence.slice(0, 6), note };
}

function scan(root) {
  const { files, skipped } = walk(root);
  const stack = detectStack(root, files);
  const applicability = [];
  for (let n = 1; n <= 31; n += 1) applicability.push({ rule: n, ...applicabilityOf(n, stack) });
  const inapplicable = new Set(applicability.filter((a) => a.state === "inapplicable").map((a) => a.rule));

  const findings = [];
  const scanned = { files: files.length, code: 0, style: 0, images: 0, skipped, ignoredTests: 0, ignoredSelf: 0 };

  const codeFiles = [];
  const imageFiles = [];
  const styleFiles = [];
  const configFiles = [];
  for (const file of files) {
    const ext = extname(file.path).toLowerCase();
    if (isTestPath(file.path)) { scanned.ignoredTests += 1; continue; }
    if (isScannerSelf(file.path)) { scanned.ignoredSelf += 1; continue; }
    if (SERVER_CONFIG.test(file.path)) { configFiles.push(file); continue; }
    if (CODE_EXT.has(ext)) { codeFiles.push(file); scanned.code += 1; }
    if (STYLE_EXT.has(ext)) { styleFiles.push(file); scanned.style += 1; }
    if (IMAGE_EXT.has(ext)) { imageFiles.push(file); scanned.images += 1; }
  }

  // Règle 2 — images
  if (!inapplicable.has(2) && imageFiles.length > 0) {
    const heavy = imageFiles.filter((f) => f.size > 100 * 1024).sort((a, b) => b.size - a.size);
    findings.push(finding(2, "img-format", "Images WebP ou AVIF, tailles adaptées",
      heavy.length > 0 ? "absent" : "applied", heavy.length > 0 ? "high" : "medium",
      heavy.map((f) => ({ file: relative(root, f.path), line: 0, excerpt: `${Math.round(f.size / 1024)} Ko en ${extname(f.path)}` })),
      heavy.length === 0 ? "aucune image raster au-dessus de 100 Ko" : "formats raster lourds : conversion WebP/AVIF à évaluer"));
  }

  // Règles 15 et 2 (dimensions) — balises <img>
  const imgLazy = [];
  const imgNoDim = [];
  let imgTotal = 0;
  const imgPattern = /<img\b[^>]*>/gi;
  for (const file of codeFiles) {
    if (file.ignoredContent || !VIEW_EXT.test(file.path)) continue;
    const text = readText(file);
    if (!text) continue;
    const rel = relative(root, file.path);
    let match;
    while ((match = imgPattern.exec(text)) !== null) {
      imgTotal += 1;
      const tag = match[0];
      if (!/loading\s*=\s*["']?lazy/i.test(tag)) imgLazy.push(evidenceOf(text, match.index, rel));
      if (!/width\s*=/i.test(tag) || !/height\s*=/i.test(tag)) imgNoDim.push(evidenceOf(text, match.index, rel));
    }
  }
  if (!inapplicable.has(15)) {
    findings.push(finding(15, "img-no-lazy", "Lazy load des images sous l'écran",
      imgTotal === 0 ? "unknown" : imgLazy.length > 0 ? "absent" : "applied",
      imgTotal === 0 ? "low" : "medium", imgLazy,
      imgTotal === 0 ? "aucune balise <img> trouvée" : `${imgLazy.length}/${imgTotal} balise(s) sans loading=lazy`));
  }
  if (!inapplicable.has(2)) {
    findings.push(finding(2, "img-no-dimensions", "Images : taille contrainte (CLS)",
      imgTotal === 0 ? "unknown" : imgNoDim.length > 0 ? "absent" : "applied",
      imgTotal === 0 ? "low" : "medium", imgNoDim,
      imgTotal === 0 ? "aucune balise <img> trouvée" : "largeur et hauteur absentes : le layout saute au chargement"));
  }

  // Règle 1 — squelettes
  const spinners = [];
  const skeletons = [];
  const spinnerPattern = /(CircularProgress|ActivityIndicator|<Loader\b|Loader2|spinner|Spinner)/g;
  const skeletonPattern = /(Skeleton|skeleton|shimmer|Shimmer|placeholder-pulse)/g;
  for (const file of codeFiles) {
    if (file.ignoredContent || !CODE_FILE_EXT.test(file.path)) continue;
    const text = readText(file);
    if (!text) continue;
    const rel = relative(root, file.path);
    let m;
    while ((m = spinnerPattern.exec(text)) !== null) spinners.push(evidenceOf(text, m.index, rel));
    while ((m = skeletonPattern.exec(text)) !== null) skeletons.push(evidenceOf(text, m.index, rel));
  }
  findings.push(finding(1, "spinner-instead-of-skeleton", "Écrans de chargement en squelette",
    spinners.length === 0 ? "unknown" : skeletons.length === 0 ? "absent" : "partial", "low", spinners,
    `${spinners.length} marqueur(s) de spinner, ${skeletons.length} marqueur(s) de squelette`));

  // Règle 21 — scripts tiers bloquants
  const blocking = [];
  let thirdParty = 0;
  const scriptPattern = /<script\b[^>]*src\s*=\s*["'][^"']*(analytics|gtag|googletagmanager|hotjar|intercom|clarity|fbq|facebook|segment|mixpanel)[^"']*["'][^>]*>/gi;
  for (const file of codeFiles) {
    if (file.ignoredContent || !VIEW_EXT.test(file.path)) continue;
    const text = readText(file);
    if (!text) continue;
    const rel = relative(root, file.path);
    let m;
    while ((m = scriptPattern.exec(text)) !== null) {
      thirdParty += 1;
      if (!/\b(async|defer)\b/i.test(m[0])) blocking.push(evidenceOf(text, m.index, rel));
    }
  }
  findings.push(finding(21, "script-blocking", "Scripts tiers chargés après la page",
    thirdParty === 0 ? "unknown" : blocking.length > 0 ? "absent" : "applied",
    thirdParty === 0 ? "low" : "high", blocking,
    thirdParty === 0 ? "aucun script tiers de ce type trouvé" : `${blocking.length}/${thirdParty} script(s) sans async ni defer`));

  // Règle 29 — polices
  const fontIssues = [];
  let weightCount = 0;
  for (const file of styleFiles) {
    if (file.ignoredContent) continue;
    const text = readText(file);
    if (!text) continue;
    const rel = relative(root, file.path);
    const remote = /@import\s+url\(\s*['"]?https?:\/\/fonts\.googleapis\.com/gi;
    let m;
    while ((m = remote.exec(text)) !== null) fontIssues.push(evidenceOf(text, m.index, rel));
    weightCount += (text.match(/font-weight\s*:/gi) ?? []).length;
  }
  const fontFiles = files.filter((f) => /\.(ttf|otf|woff)$/i.test(f.path));
  for (const f of fontFiles.slice(0, 5)) {
    fontIssues.push({ file: relative(root, f.path), line: 0, excerpt: `format ${extname(f.path)} (WOFF2 attendu)` });
  }
  findings.push(finding(29, "font-tiers", "Polices auto-hébergées, WOFF2, deux graisses",
    fontIssues.length === 0 && weightCount === 0 ? "unknown" : fontIssues.length > 0 ? "absent" : "applied",
    fontIssues.length > 0 ? "medium" : "low", fontIssues,
    `${weightCount} déclaration(s) font-weight, ${fontFiles.length} fichier(s) de police non WOFF2`));

  // Règles 9 et 27 — compression et cache, sur fichiers de configuration serveur
  const configEntries = configFiles.filter((f) => !f.ignoredContent).map((f) => ({ file: f, text: readText(f) })).filter((e) => e.text);
  const compressionHits = configEntries.filter((e) => /(brotli|gzip|compression\s*\(|content-encoding)/i.test(e.text));
  const serverCompression = compressionHits.filter((e) => /nginx|htaccess|docker|server\.(js|mjs|ts)$/i.test(e.file.path));
  findings.push(finding(9, "compression", "Compression Brotli ou gzip",
    configEntries.length === 0 ? "unknown" : serverCompression.length > 0 ? "applied" : "unknown",
    configEntries.length === 0 ? "low" : "medium",
    (serverCompression.length > 0 ? serverCompression : compressionHits).slice(0, 3).map((e) => ({ file: relative(root, e.file.path), line: 0, excerpt: "configuration de compression" })),
    "se confirme sur une réponse réelle : content-encoding (voir references/measure.md)"));
  const cacheHits = configEntries.filter((e) => /(immutable|max-age|s-maxage|cache-control)/i.test(e.text));
  findings.push(finding(27, "static-cache-headers", "Cache navigateur sur les fichiers versionnés",
    configEntries.length === 0 ? "unknown" : cacheHits.length > 0 ? "applied" : "unknown",
    configEntries.length === 0 ? "low" : "medium",
    cacheHits.slice(0, 3).map((e) => ({ file: relative(root, e.file.path), line: 0, excerpt: "en-tête de cache" })),
    "à confirmer sur une réponse réelle : cache-control public, max-age, immutable"));

  // Règle 3 — requêtes dupliquées
  const urlPattern = /(?:fetch|axios\.(?:get|post|put|delete)|useSWR|\$fetch)\(\s*[`'"]([^`'"]+)[`'"]/g;
  const urls = new Map();
  for (const file of codeFiles) {
    if (file.ignoredContent) continue;
    const text = readText(file);
    if (!text) continue;
    const rel = relative(root, file.path);
    let m;
    while ((m = urlPattern.exec(text)) !== null) {
      const key = m[1].split("?")[0].replace(/\$\{[^}]*\}/g, ":id");
      if (!key.startsWith("/") && !key.startsWith("http")) continue;
      if (!urls.has(key)) urls.set(key, []);
      urls.get(key).push(evidenceOf(text, m.index, rel));
    }
  }
  const duplicated = [...urls.entries()].filter(([, hits]) => hits.length > 1);
  findings.push(finding(3, "duplicate-request", "Pas d'appels API en double",
    urls.size === 0 ? "unknown" : duplicated.length === 0 ? "applied" : "absent",
    duplicated.length > 0 ? "medium" : "low",
    duplicated.flatMap(([, hits]) => hits).slice(0, 6),
    urls.size === 0
      ? "aucun appel réseau à URL littérale"
      : duplicated.length === 0
        ? "aucune URL appelée depuis plusieurs emplacements"
        : `${duplicated.length} URL appelée(s) à plusieurs endroits ; vérifier le cache de requêtes`));

  // Règle 4 — debounce
  const noDebounce = [];
  for (const file of codeFiles) {
    if (file.ignoredContent || !CODE_FILE_EXT.test(file.path)) continue;
    const text = readText(file);
    if (!text || !/<input/i.test(text)) continue;
    if (/(debounce|useDebounce|useDeferredValue|setTimeout\()/i.test(text)) continue;
    if (!/(fetch\(|axios\.|useQuery|\$fetch)/i.test(text)) continue;
    noDebounce.push(evidenceOf(text, text.search(/<input/i), relative(root, file.path)));
  }
  findings.push(finding(4, "search-no-debounce", "Debounce sur la recherche",
    noDebounce.length === 0 ? "unknown" : "absent", "low", noDebounce,
    noDebounce.length === 0 ? "aucun input couplé à un appel réseau sans debounce" : "input qui déclenche un appel réseau sans debounce"));

  // Règle 24 — SELECT *
  const selectStar = [];
  let sqlFiles = 0;
  for (const file of codeFiles) {
    if (file.ignoredContent || !/\.(sql|ts|js|py|php|rb)$/i.test(file.path)) continue;
    const text = readText(file);
    if (!text) continue;
    if (/\bselect\b/i.test(text)) sqlFiles += 1;
    let m;
    const starPattern = /\bselect\s+\*/gi;
    while ((m = starPattern.exec(text)) !== null) selectStar.push(evidenceOf(text, m.index, relative(root, file.path)));
  }
  findings.push(finding(24, "select-star", "Seulement les colonnes utiles",
    selectStar.length > 0 ? "absent" : sqlFiles === 0 ? "unknown" : "applied",
    selectStar.length > 0 ? "high" : "medium", selectStar,
    selectStar.length === 0 ? (sqlFiles === 0 ? "aucune requête SQL littérale" : "aucun SELECT * littéral") : "SELECT * dans le code"));

  // Règle 12 — timeouts
  const noTimeout = [];
  let fetchCount = 0;
  const fetchPattern = /\bfetch\(\s*[`'"][^`'"]+[`'"]/g;
  for (const file of codeFiles) {
    if (file.ignoredContent) continue;
    const text = readText(file);
    if (!text) continue;
    let m;
    while ((m = fetchPattern.exec(text)) !== null) {
      fetchCount += 1;
      const window = text.slice(m.index, m.index + 400);
      const closed = window.slice(0, window.indexOf(")") + 1);
      if (/signal|timeout|AbortController|AbortSignal/i.test(closed)) continue;
      noTimeout.push(evidenceOf(text, m.index, relative(root, file.path)));
    }
  }
  findings.push(finding(12, "fetch-no-timeout", "Timeouts sur les API externes",
    fetchCount === 0 ? "unknown" : noTimeout.length > 0 ? "absent" : "applied",
    noTimeout.length > 0 ? "medium" : "low", noTimeout,
    fetchCount === 0 ? "aucun appel fetch à URL littérale" : `${noTimeout.length}/${fetchCount} fetch sans signal ni timeout`));

  // Règle 25 — client base par requête
  const perRequest = [];
  let dbClientFiles = 0;
  for (const file of codeFiles) {
    if (file.ignoredContent || !CODE_FILE_EXT.test(file.path)) continue;
    const text = readText(file);
    if (!text) continue;
    if (!/new\s+(Pool|Client)\s*\(|prisma\.\$connect\(|createConnection\s*\(/.test(text)) continue;
    dbClientFiles += 1;
    const inHandler = /(app\.(get|post|put|delete)|router\.(get|post|put|delete)|export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE)|handler\s*\()/i.test(text);
    if (!inHandler) continue;
    let m;
    const clientPattern = /new\s+(Pool|Client)\s*\(|prisma\.\$connect\(|createConnection\s*\(/g;
    while ((m = clientPattern.exec(text)) !== null) perRequest.push(evidenceOf(text, m.index, relative(root, file.path)));
  }
  if (!inapplicable.has(25)) {
    findings.push(finding(25, "db-client-per-request", "Pool de connexions à la base",
      perRequest.length > 0 ? "absent" : dbClientFiles > 0 ? "applied" : "unknown",
      perRequest.length > 0 ? "medium" : "low", perRequest,
      perRequest.length === 0 ? "client base instancié hors handler de requête" : "client instancié dans un fichier de route : vérifier qu'il n'est pas créé par requête"));
  }

  // Règle 11 — dépendances lourdes
  if (stack.hasPackageJson) {
    const heavyDeps = stack.deps.filter((dep) => HEAVY_DEPS.some(([name]) => dep === name));
    findings.push(finding(11, "heavy-deps", "Dépendances inutiles supprimées",
      heavyDeps.length > 0 ? "absent" : "unknown", "low",
      heavyDeps.map((dep) => ({ file: "package.json", line: 0, excerpt: HEAVY_DEPS.find(([name]) => name === dep)?.[1] ?? dep })),
      `${stack.deps.length} dépendance(s) déclarée(s) ; croiser avec knip pour les paquets inutilisés`));
  }

  // Règle 22 — découpage du JS
  const lazyFiles = codeFiles.filter((f) => !f.ignoredContent).filter((f) => {
    const text = readText(f);
    return text ? /(\bdynamic\(|React\.lazy|defineAsyncComponent|import\()/.test(text) : false;
  }).length;
  findings.push(finding(22, "code-splitting", "JavaScript découpé par page",
    stack.routeFiles === 0 ? "unknown" : lazyFiles > 0 ? "applied" : stack.routeFiles > 5 ? "absent" : "unknown",
    lazyFiles > 0 ? "medium" : "low", [],
    `${stack.routeFiles} fichier(s) de route, ${lazyFiles} fichier(s) avec import différé`));

  // Règle 5 — pagination
  const noLimit = [];
  let readCalls = 0;
  for (const file of codeFiles) {
    if (file.ignoredContent) continue;
    const text = readText(file);
    if (!text) continue;
    const findManyPattern = /\.(findMany|select|all)\(\s*\{?/g;
    let m;
    while ((m = findManyPattern.exec(text)) !== null) {
      readCalls += 1;
      const window = text.slice(m.index, m.index + 300);
      if (/(take|limit|first|cursor|skip|offset)/i.test(window)) continue;
      noLimit.push(evidenceOf(text, m.index, relative(root, file.path)));
    }
  }
  findings.push(finding(5, "no-pagination", "Résultats d'API paginés",
    readCalls === 0 ? "unknown" : noLimit.length > 0 ? "absent" : "applied", "low", noLimit,
    readCalls === 0 ? "aucune lecture de liste détectée" : "lecture sans take/limit : à confirmer sur la route de liste"));

  const decided = new Set(findings.filter((f) => f.verdict !== "unknown").map((f) => f.rule));
  const unmeasured = applicability
    .filter((a) => a.state === "manual" || a.state === "unknown")
    .map((a) => a.rule)
    .filter((n) => !decided.has(n));
  return {
    root,
    stack,
    scanned,
    findings: findings.filter((f) => !inapplicable.has(f.rule)).sort((a, b) => a.rule - b.rule),
    applicability,
    unmeasured,
  };
}

function formatSummary(result) {
  const lines = [];
  lines.push(`Racine : ${result.root}`);
  lines.push(`Stack : ${[...result.stack.frameworks, ...result.stack.backend, ...result.stack.database, ...result.stack.orm].join(", ") || "non identifiée"}`);
  lines.push(`Fichiers : ${result.scanned.files} (code ${result.scanned.code}, styles ${result.scanned.style}, images ${result.scanned.images}) | ignorés : ${result.scanned.ignoredTests} test(s), ${result.scanned.ignoredSelf} script(s) de ce skill`);
  const skipped = result.scanned.skipped;
  if (skipped.unreadable || skipped.tooLarge || skipped.capped) {
    lines.push(`Limites : ${skipped.unreadable} illisible(s), ${skipped.tooLarge} trop gros, plafond atteint : ${skipped.capped}`);
  }
  lines.push("");
  lines.push("Constats déterministes :");
  for (const f of result.findings) {
    lines.push(`  R${f.rule} ${f.title} — ${f.verdict} (${f.confidence}) · ${f.note}`);
    for (const e of f.evidence.slice(0, 3)) {
      lines.push(`      ${e.file}${e.line > 0 ? ":" + e.line : ""}  ${e.excerpt}`);
    }
  }
  const inapplicable = result.applicability.filter((a) => a.state === "inapplicable");
  if (inapplicable.length > 0) {
    lines.push("");
    lines.push("Sans objet constaté :");
    for (const a of inapplicable) lines.push(`  R${a.rule} — ${a.reason}`);
  }
  lines.push("");
  lines.push("À établir par lecture ou par mesure : " + result.unmeasured.join(", "));
  return lines.join("\n");
}

function formatMarkdown(result) {
  const rows = ["| # | Constat | Verdict | Confiance | Preuve |", "|---|---|---|---|---|"];
  for (const f of result.findings) {
    const first = f.evidence[0];
    const proof = first ? `${first.file}${first.line > 0 ? ":" + first.line : ""}` : f.note;
    rows.push(`| ${f.rule} | ${f.title} | ${f.verdict} | ${f.confidence} | ${proof} |`);
  }
  return rows.join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!existsSync(opts.root)) fail(`racine introuvable : ${opts.root}`);
  const result = scan(opts.root);
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (opts.markdown) {
    process.stdout.write(formatMarkdown(result) + "\n");
    return;
  }
  if (opts.images) {
    const images = result.findings.filter((f) => f.id === "img-format" || f.id === "img-no-lazy" || f.id === "img-no-dimensions");
    process.stdout.write(JSON.stringify(images, null, 2) + "\n");
    return;
  }
  process.stdout.write(formatSummary(result) + "\n");
}

main();
