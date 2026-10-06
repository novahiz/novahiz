#!/usr/bin/env node
// stitch_composite.mjs — build the HTML page that puts every Stitch reference
// next to the screenshot of the running app, with a fresh marker and cache
// busted images, so a fidelity verdict can never be formed on a stale render.
//
//   node stitch_composite.mjs --config stitch/verify.config.json [--only otp,home]
//                             [--nonce abc123] [--port 8123] [--json]
//
// Reads stitch/verify.config.json plus the artifacts written by stitch_capture.mjs
// (<out>/<id>.png, <out>/<id>.bounds.json) and writes <out>/verify_<nonce>.html.
// No dependencies, no network: the page is served by any static server whose
// document root is config.serve.root.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const PAGE_NAME = 'verify';

function fail(message) {
  console.error(`stitch_composite: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { config: 'stitch/verify.config.json', only: null, nonce: null, port: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') out.config = argv[++i];
    else if (arg === '--only') out.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--nonce') out.nonce = argv[++i];
    else if (arg === '--port') out.port = Number(argv[++i]);
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  return out;
}

function stripComments(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i += 1; } continue; }
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 1; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (c === '/' && next === '*') { inBlock = true; i += 1; continue; }
    out += c;
  }
  return out;
}

function loadConfig(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) fail(`config not found: ${abs}`);
  let parsed;
  try {
    parsed = JSON.parse(stripComments(readFileSync(abs, 'utf8')));
  } catch (error) {
    fail(`config is not valid JSON (${abs}): ${String(error).slice(0, 200)}`);
  }
  const dir = dirname(abs);
  const root = basename(dir) === 'stitch' ? dirname(dir) : dir;
  return { abs, root, cfg: parsed };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The page lives in <out>, so its <img> src must be relative to the page
// directory (a serve-root-relative path would be resolved under /_cmp/ and 404).
function imageUrl(pageDir, serveRootDir, absPath, nonce) {
  const abs = resolve(absPath);
  const relToServe = relative(serveRootDir, abs);
  const outside = relToServe.startsWith('..') || isAbsolute(relToServe);
  const rel = relative(pageDir, abs).split(sep).join('/');
  return { url: `${rel}?v=${encodeURIComponent(nonce)}`, outside };
}

function readBounds(outDir, id) {
  const file = resolve(outDir, `${id}.bounds.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function expectLine(screen, bounds) {
  const expect = screen.expect ?? {};
  const rows = [];
  const cmp = (label, expected, measured) => {
    if (expected === undefined || expected === null) return;
    if (measured === null || measured === undefined) {
      rows.push(`${label}: expected ${expected}px, no measurement`);
      return;
    }
    const delta = measured - expected;
    rows.push(`${label}: expected ${expected}px, measured ${measured}px, delta ${delta > 0 ? '+' : ''}${delta}px${delta === 0 ? ' OK' : ''}`);
  };
  cmp('bottom gap', expect.bottomGapPx, bounds?.bottomGapPx ?? null);
  cmp('bottom clickable gap', expect.bottomClickableGapPx, bounds?.bottomClickableGapPx ?? null);
  if (typeof expect.minBottomGapPx === 'number') {
    const measured = bounds?.bottomGapPx ?? null;
    if (measured === null) rows.push(`min bottom gap: expected >= ${expect.minBottomGapPx}px, no measurement`);
    else rows.push(`min bottom gap: ${measured}px vs >= ${expect.minBottomGapPx}px -> ${measured >= expect.minBottomGapPx ? 'PASS' : 'FAIL'}`);
  }
  return rows;
}

function figure(label, url, outside, crop) {
  const style = crop
    ? `style="width:${crop.w}px;height:${crop.h}px;overflow:hidden"`
    : '';
  const inner = crop
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" style="margin-left:-${crop.x}px;margin-top:-${crop.y}px">`
    : `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}">`;
  const warn = outside ? '<p class="warn">image is outside serve.root — it will 404</p>' : '';
  return `<figure><figcaption>${escapeHtml(label)}</figcaption><div class="frame" ${style}>${inner}</div>${warn}</figure>`;
}

function buildPage({ cfg, root, outDir, serveRootDir, screens, nonce, generatedAt }) {
  const sections = screens.map((screen) => {
    const out = resolve(outDir, `${screen.id}.png`);
    const ref = screen.ref ? resolve(root, screen.ref) : null;
    const bounds = readBounds(outDir, screen.id);
    const refUrl = ref ? imageUrl(outDir, serveRootDir, ref, nonce) : null;
    const capUrl = imageUrl(outDir, serveRootDir, out, nonce);
    const missing = ref ? !existsSync(ref) : true;
    const captured = existsSync(out);
    const deltas = expectLine(screen, bounds);

    const figures = [
      missing
        ? `<figure><figcaption>reference (missing)</figcaption><div class="frame empty">no reference at ${escapeHtml(screen.ref ?? '(no ref configured)')}</div></figure>`
        : figure('Stitch reference', refUrl.url, refUrl.outside, screen.refCrop ?? null),
      captured
        ? figure('running app', capUrl.url, capUrl.outside, screen.crop ?? null)
        : `<figure><figcaption>running app (not captured)</figcaption><div class="frame empty">run stitch_capture.mjs first</div></figure>`,
    ].join('\n');

    const meta = [
      `route ${screen.route ?? '-'}`,
      bounds ? `${bounds.screen.w}x${bounds.screen.h} @ ${bounds.density ?? '?'} px/dp` : 'no bounds',
      bounds ? `${bounds.nodeCount} nodes` : null,
      bounds?.bottomGapPx !== undefined && bounds?.bottomGapPx !== null ? `bottom gap ${bounds.bottomGapPx}px (${bounds.bottomGapDp ?? '?'}dp)` : null,
      bounds?.lowestText ? `lowest element: "${bounds.lowestText}"` : null,
      ...deltas,
    ].filter(Boolean).map((line) => `<li>${escapeHtml(line)}</li>`).join('');

    return `<section id="${escapeHtml(screen.id)}">
  <h2>${escapeHtml(screen.id)} <code>${escapeHtml(screen.route ?? '')}</code></h2>
  <div class="pair">${figures}</div>
  <ul class="meta">${meta}</ul>
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stitch fidelity ${escapeHtml(nonce)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #14161b; color: #e7e9ee;
         font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
  h1 { font-size: 18px; margin: 0; font-weight: 650; letter-spacing: .01em; }
  h2 { font-size: 15px; margin: 28px 0 10px; font-weight: 650; }
  h2 code { font-size: 12px; color: #9aa2b1; font-weight: 500; }
  #marker { font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
            background: #1f8f4f; color: #fff; padding: 6px 10px; border-radius: 6px;
            letter-spacing: .04em; }
  .stamp { color: #9aa2b1; font-size: 12px; }
  .pair { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  figure { margin: 0; flex: 1 1 340px; min-width: 280px; }
  figcaption { font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
               color: #9aa2b1; margin-bottom: 6px; }
  .frame { background: #fff; border: 1px solid #2c313a; border-radius: 8px;
           overflow: hidden; max-height: 78vh; }
  .frame img { display: block; width: 100%; height: auto; }
  .frame .frame img { width: auto; }
  .frame.empty { display: grid; place-items: center; min-height: 220px;
                 background: #1b1e25; color: #8b93a3; font-size: 13px; padding: 24px;
                 text-align: center; }
  .warn { color: #e0a33a; font-size: 12px; margin: 6px 0 0; }
  ul.meta { list-style: none; padding: 0; margin: 10px 0 0; display: flex; gap: 8px 18px;
            flex-wrap: wrap; font-size: 13px; color: #b9c0cd; }
  ul.meta li { white-space: nowrap; }
</style>
</head>
<body>
<header>
  <span id="marker">STITCH_FRESH_${escapeHtml(nonce)}</span>
  <h1>stitch fidelity comparison</h1>
  <span class="stamp">${escapeHtml(generatedAt)} · serve root ${escapeHtml(cfg.serve?.root ?? 'stitch')}</span>
</header>
<p class="stamp">Compare each pair on the grid in references/judgment-grid.md. Confirm the marker above is
present in the screenshot of this page before forming any verdict — a missing marker means a stale render.</p>
${sections}
</body>
</html>
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node stitch_composite.mjs [--config stitch/verify.config.json] [--only id1,id2] [--nonce str] [--port n] [--json]');
    return 0;
  }

  const { root, cfg } = loadConfig(args.config);
  if (!Array.isArray(cfg.screens) || cfg.screens.length === 0) fail('config.screens is empty');

  let screens = cfg.screens;
  if (args.only) {
    const unknown = args.only.filter((id) => !cfg.screens.some((s) => s.id === id));
    if (unknown.length) fail(`unknown screen id(s): ${unknown.join(', ')}`);
    screens = cfg.screens.filter((s) => args.only.includes(s.id));
  }

  const outDir = resolve(root, cfg.out ?? 'stitch/_cmp');
  const serveRootDir = resolve(root, cfg.serve?.root ?? 'stitch');
  const port = args.port ?? cfg.serve?.port ?? 8123;
  const nonce = args.nonce ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const generatedAt = new Date().toISOString();

  const html = buildPage({ cfg, root, outDir, serveRootDir, screens, nonce, generatedAt });
  const pagePath = resolve(outDir, `${PAGE_NAME}_${nonce}.html`);
  writeFileSync(pagePath, html);

  // Relative URL the agent must open: serves.root is the document root.
  const pageRel = relative(serveRootDir, pagePath).split(sep).join('/');
  const url = `http://localhost:${port}/${pageRel}?v=${encodeURIComponent(nonce)}`;

  const marker = `STITCH_FRESH_${nonce}`;
  const images = [];
  for (const screen of screens) {
    if (screen.ref) images.push(resolve(root, screen.ref));
    images.push(resolve(outDir, `${screen.id}.png`));
  }
  const missing = images.filter((p) => !existsSync(p));
  const outsideServeRoot = images.filter((p) => relative(serveRootDir, p).startsWith('..'));

  const result = { pagePath, url, marker, nonce, port, generatedAt, screens: screens.map((s) => s.id), missing, outsideServeRoot };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`page     ${pagePath}`);
    console.log(`open     ${url}`);
    console.log(`marker   ${marker}   (must be visible in your screenshot of that tab)`);
    if (missing.length) console.log(`missing  ${missing.join(', ')}`);
    if (outsideServeRoot.length) console.log(`outside  serve.root, will 404: ${outsideServeRoot.join(', ')}`);
    console.log(`serve    static server with document root ${serveRootDir} on port ${port}, then open the URL above in a NEW tab.`);
  }
  return missing.length || outsideServeRoot.length ? 1 : 0;
}

process.exitCode = main();
