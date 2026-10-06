#!/usr/bin/env node
// stitch_capture.mjs — capture the running app screens plus their uiautomator
// bounds, so a Stitch fidelity comparison has fresh pixels AND measurable numbers.
//
//   node stitch_capture.mjs --config stitch/verify.config.json [--only otp,home]
//                           [--from-current] [--dry-run] [--json] [--check] [--settle 6000]
//
// What is global vs what is project specific:
//   * defaults/verify.config.defaults.json ships with Novahiz and holds every
//     installation value (device policy, timings, batch size, output folder,
//     serve port). Every project inherits it — nothing to copy.
//   * the project's stitch/verify.config.json only declares its screens,
//     routes, references and deep link template, and may override any default.
//   * the device is auto-selected: the connected emulator wins, and one is
//     started automatically when nothing is online (adb.autoStart).
//
// Exit code: 0 all selected screens captured, 1 a screen was not captured,
// 2 configuration/environment problem.

import { execFileSync, spawn } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_BUFFER = 1024 * 1024 * 64;
const BATCH_LIMIT = 3; // adb drops the connection past ~3 chained screen operations
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function fail(message) {
  console.error(`stitch_capture: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    config: 'stitch/verify.config.json', only: null, fromCurrent: false,
    dryRun: false, json: false, settle: null, check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') out.config = argv[++i];
    else if (arg === '--only') out.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--settle') out.settle = Number(argv[++i]);
    else if (arg === '--scroll') out.scroll = argv[++i];
    else if (arg === '--from-current') out.fromCurrent = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--check') out.check = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  return out;
}

// Config files may carry // comments (they are documented that way).
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

function readJsonc(path) {
  return JSON.parse(stripComments(readFileSync(path, 'utf8')));
}

// Objects merge key by key, arrays and scalars are replaced by the override.
function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over;
  if (typeof base === 'object' && typeof over === 'object') {
    const out = { ...base };
    for (const key of Object.keys(over)) out[key] = deepMerge(base[key], over[key]);
    return out;
  }
  return over;
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    return execFileSync(probe, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
  } catch {
    return false;
  }
}

function loadConfig(path) {
  const abs = resolve(path);
  const defaultsPath = resolve(SKILL_DIR, 'defaults', 'verify.config.defaults.json');
  if (!existsSync(defaultsPath)) fail(`skill defaults not found: ${defaultsPath}`);
  if (!existsSync(abs)) {
    fail(`config not found: ${abs}\n  create it next to the references; it only lists screens/routes/refs ` +
      '(defaults come from the skill: see SKILL.md, "Contract").');
  }
  const defaults = readJsonc(defaultsPath);
  const project = readJsonc(abs);
  // The config normally lives in stitch/, while every path in it is written from
  // the project root (stitch/10-otp-hi.png, stitch/_cmp).
  const dir = dirname(abs);
  const root = basename(dir) === 'stitch' ? dirname(dir) : dir;
  return { abs, root, cfg: deepMerge(defaults, project), defaultsPath, project };
}

function adbBase(serial) {
  return serial ? ['-s', serial] : [];
}

function adbText(serial, args) {
  return execFileSync('adb', [...adbBase(serial), ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER,
  }).trim();
}

function adbBin(serial, args) {
  return execFileSync('adb', [...adbBase(serial), ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER });
}

function connectedDevices() {
  let lines;
  try {
    lines = adbText(null, ['devices']).split(/\r?\n/);
  } catch {
    return null; // adb missing or broken
  }
  return lines.slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List of'))
    .map((l) => {
      const [serial, state, ...rest] = l.split(/\s+/);
      return { serial, state, info: rest.join(' ') };
    });
}

function pickDevice(cfg, notes) {
  const all = connectedDevices();
  if (all === null) return null;
  const online = all.filter((d) => d.state === 'device');
  const want = cfg.adb?.serial;
  if (want && want !== 'auto') {
    const found = online.find((d) => d.serial === want);
    if (found) return found.serial;
    notes.push(`configured adb.serial "${want}" is not connected -> auto-selecting`);
  }
  if (!online.length) return null;
  const emulator = online.find((d) => /^emulator-/.test(d.serial)) ?? online[0];
  if (online.length > 1) {
    notes.push(`auto-selected ${emulator.serial} (${online.length} devices online: ${online.map((d) => d.serial).join(', ')})`);
  }
  return emulator.serial;
}

function listAvds() {
  try {
    return execFileSync('emulator', ['-list-avds'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^INFO/i.test(s));
  } catch {
    return [];
  }
}

// No device online: boot one, then wait for it to actually finish booting.
async function ensureDevice(cfg, notes) {
  const picked = pickDevice(cfg, notes);
  if (picked) return picked;
  if (cfg.adb?.autoStart === false) {
    notes.push('no device online and adb.autoStart is disabled');
    return null;
  }
  if (!commandExists('adb')) { notes.push('adb is not on PATH'); return null; }
  if (!commandExists('emulator')) {
    notes.push('no device online and the `emulator` tool is not on PATH (install Android SDK + platform-tools)');
    return null;
  }
  const avds = listAvds();
  if (!avds.length) { notes.push('no device online and `emulator -list-avds` returned no AVD'); return null; }
  const wanted = cfg.adb?.avd;
  const avd = wanted && avds.includes(wanted) ? wanted : avds[0];
  notes.push(`starting emulator "${avd}"${wanted && avd !== wanted ? ` (requested "${wanted}" not found)` : ''}`);
  try {
    spawn('emulator', ['-avd', avd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (error) {
    notes.push(`emulator launch failed: ${String(error).slice(0, 120)}`);
    return null;
  }
  const timeout = cfg.adb?.bootTimeoutMs ?? 180000;
  try {
    execFileSync('adb', ['wait-for-device'], { timeout, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    notes.push(`emulator did not appear within ${timeout}ms`);
    return null;
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (adbText(null, ['shell', 'getprop', 'sys.boot_completed']) === '1') break;
    } catch { /* transitional */ }
    await sleep(1500);
  }
  return pickDevice(cfg, notes);
}

async function resolveDensity(cfg, serial) {
  if (cfg.adb?.density) return Number(cfg.adb.density);
  try {
    const out = adbText(serial, ['shell', 'wm', 'density']);
    const match = /(?:Physical|Override)\s+density:\s*(\d+)/i.exec(out);
    if (match) return Math.round((Number(match[1]) / 160) * 1000) / 1000;
  } catch { /* non fatal: measurements fall back to px only */ }
  return null;
}

function deepLinkUrl(template, route) {
  const raw = template.replace('{route}', route);
  // '--/{route}' with route '/' must not become '--//' (same rule as the
  // hand-written capture script: one slash after the Expo redirect marker).
  return raw.replace(/--\/+/, '--/');
}

function parseBounds(xml) {
  const nodes = [];
  const tagRe = /<node\s+([^>]*?)\/?>/g;
  let match = tagRe.exec(xml);
  while (match !== null) {
    const attrs = {};
    const attrRe = /([\w:-]+)="([^"]*)"/g;
    let a = attrRe.exec(match[1]);
    while (a !== null) { attrs[a[1]] = a[2]; a = attrRe.exec(match[1]); }
    const b = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attrs.bounds || '');
    if (b) {
      const x1 = Number(b[1]); const y1 = Number(b[2]);
      const x2 = Number(b[3]); const y2 = Number(b[4]);
      nodes.push({
        text: attrs.text || '',
        desc: attrs['content-desc'] || '',
        id: attrs['resource-id'] || '',
        cls: attrs.class || '',
        clickable: attrs.clickable === 'true',
        bounds: { x: x1, y: y1, w: x2 - x1, h: y2 - y1, x2, y2 },
      });
    }
    match = tagRe.exec(xml);
  }
  return nodes;
}

function metrics(nodes, density) {
  const root = nodes.find((n) => n.bounds.x === 0 && n.bounds.y === 0) || null;
  const w = root ? root.bounds.w : Math.max(0, ...nodes.map((n) => n.bounds.x2));
  const h = root ? root.bounds.h : Math.max(0, ...nodes.map((n) => n.bounds.y2));
  // Full-height containers (screens, scroll views) report y2 == h and would
  // collapse every gap to 0: only content-bearing, non-full-height nodes count.
  const isFullHeight = (n) => h > 0 && n.bounds.h >= h * 0.98;
  const content = nodes.filter((n) => (n.text || n.desc || n.clickable) && !isFullHeight(n));
  const counted = nodes.filter((n) => n.text || n.desc || n.id || n.clickable);
  const lowest = content.reduce((acc, n) => (acc === null || n.bounds.y2 > acc.bounds.y2 ? n : acc), null);
  const lowestClickable = content
    .filter((n) => n.clickable)
    .reduce((acc, n) => (acc === null || n.bounds.y2 > acc.bounds.y2 ? n : acc), null);
  return {
    screen: { w, h },
    density,
    bottomGapPx: lowest ? Math.round(h - lowest.bounds.y2) : null,
    bottomGapDp: lowest && density ? Math.round((h - lowest.bounds.y2) / density) : null,
    bottomClickableGapPx: lowestClickable ? Math.round(h - lowestClickable.bounds.y2) : null,
    bottomClickableGapDp: lowestClickable && density ? Math.round((h - lowestClickable.bounds.y2) / density) : null,
    lowestText: lowest ? (lowest.text || lowest.desc).slice(0, 60) : null,
    nodeCount: counted.length,
  };
}

let lastDumpError = null;

// uiautomator dump fails while an animation runs: wait and retry. No synthetic
// tap — a "neutral" point on an unknown screen can press a real control.
async function dumpXml(serial) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const dump = adbText(serial, ['shell', 'uiautomator', 'dump', '/sdcard/stitch_ui.xml']);
      if (dump.includes('dumped to')) {
        const xml = adbText(serial, ['exec-out', 'cat', '/sdcard/stitch_ui.xml']);
        if (xml && xml.includes('<node') && !xml.includes('ERROR')) { lastDumpError = null; return xml; }
        lastDumpError = `dump written but xml unusable (len ${xml ? xml.length : 0})`;
      } else {
        lastDumpError = dump.slice(0, 140) || 'empty dump output';
      }
    } catch (error) {
      lastDumpError = String(error).replace(/\s+/g, ' ').slice(0, 180);
    }
    await sleep(600);
  }
  return null;
}

// Content nodes only, and geometry only: decorative or animated nodes (spinner,
// progress bar, shield pulse) churn forever, and a live screen (OTP countdown,
// clock) changes text every second — stability is judged on where the real
// content sits. "Richness" (below) is what keeps the splash screen out.
const signature = (nodes) => nodes
  .filter((n) => n.text || n.desc || n.clickable)
  .map((n) => `${n.cls}|${n.id}|${n.bounds.x},${n.bounds.y},${n.bounds.w},${n.bounds.h}`)
  .join('\n');

// Wait until the UI is actually rendered: the splash screen (a logo plus the
// dev menu) is static too, so "stable" alone is not enough — the hierarchy must
// also carry real content. Two identical rich dumps in a row means ready.
async function waitForRenderedUi(serial, cfg, minMs, maxMs, pollMs) {
  const started = Date.now();
  await sleep(minMs);
  let prev = null;
  let streak = 0;
  let last = null;
  let blind = 0; // consecutive unusable dumps: an animation can hold uiautomator
  while (Date.now() - started < maxMs) {
    const xml = await dumpXml(serial);
    if (xml) {
      blind = 0;
      const nodes = parseBounds(xml);
      const texts = nodes.filter((n) => n.text || n.desc).length;
      const clickable = nodes.filter((n) => n.clickable).length;
      const rich = texts >= (cfg.ready?.minTexts ?? 3)
        || clickable >= 1
        || nodes.length >= (cfg.ready?.minNodes ?? 12);
      const sig = signature(nodes);
      streak = rich && sig === prev ? streak + 1 : 0;
      prev = sig;
      last = { texts, clickable, total: nodes.length, rich };
      if (streak >= 1) return { ready: true, waitedMs: Date.now() - started, stats: last };
    } else {
      blind += 1;
      // Give up early: the final dump after the screenshot still decides.
      if (blind >= 6) break;
    }
    await sleep(pollMs);
  }
  return { ready: false, waitedMs: Date.now() - started, stats: last, dumpError: lastDumpError };
}

// Scroll state is part of the measurement: the same screen gives a bottom gap
// 155px different depending on where the ScrollView sits, so the capture pins it
// (resetScroll -> top, screen.scroll -> top/bottom) instead of inheriting
// whatever the previous interaction left behind.
async function normalizeScroll(serial, cfg, screen, args) {
  const target = args.scroll ?? screen.scroll ?? (cfg.launch?.resetScroll === false ? null : 'top');
  if (!target) return null;
  const [x1, y1, x2, y2] = target === 'bottom' ? [540, 1900, 540, 500] : [540, 500, 540, 1900];
  const times = target === 'bottom' ? (screen.scrollSwipes ?? 4) : 2;
  for (let i = 0; i < times; i += 1) {
    try { adbText(serial, ['shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), '400']); }
    catch { return `scroll ${target} failed`; }
    await sleep(cfg.launch?.scrollSettleMs ?? 900);
  }
  return `scroll reset to ${target}`;
}

async function captureScreen(ctx, screen) {
  const { serial, cfg, outDir, args } = ctx;
  const status = { id: screen.id, route: screen.route ?? null, status: 'ok', notes: [] };
  const png = resolve(outDir, `${screen.id}.png`);
  const boundsFile = resolve(outDir, `${screen.id}.bounds.json`);

  try {
    if (args.dryRun) { status.notes.push('dry-run: no adb call made'); return status; }

    if (!args.fromCurrent) {
      if (screen.taps?.length) {
        // Ladder level 3: the screen is reached through the real UI.
        for (const tap of screen.taps) {
          const [x, y] = Array.isArray(tap) ? tap : [tap.x, tap.y];
          adbText(serial, ['shell', 'input', 'tap', String(x), String(y)]);
          await sleep(screen.tapSettleMs ?? cfg.launch?.tapSettleMs ?? 900);
        }
      }
      const template = screen.deepLink ?? cfg.launch?.deepLink;
      if (screen.route && template) {
        if (screen.cold ?? cfg.launch?.coldStart) {
          const pkg = screen.package ?? cfg.launch?.package;
          if (pkg) { try { adbText(serial, ['shell', 'am', 'force-stop', pkg]); await sleep(800); } catch { /* best effort */ } }
        }
        const url = deepLinkUrl(template, screen.route);
        status.notes.push(`launch ${url}`);
        adbText(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
      } else if (!screen.taps?.length) {
        // Ladder level 2: initial route — the app is started and shows the screen first.
        status.notes.push('no deep link configured: capturing the current screen');
      }
    } else {
      status.notes.push('--from-current');
    }

    const ready = await waitForRenderedUi(
      serial, cfg,
      args.settle ?? screen.waitMs ?? cfg.launch?.waitForIdleMs ?? 6000,
      cfg.launch?.maxWaitMs ?? 30000,
      cfg.launch?.pollMs ?? 800,
    );
    status.notes.push(ready.ready
      ? `rendered in ${ready.waitedMs}ms (${ready.stats.texts} texts, ${ready.stats.clickable} clickable)`
      : `UI never stabilized within ${ready.waitedMs}ms (${ready.stats ? JSON.stringify(ready.stats) : 'no usable dump'})`
        + (ready.dumpError ? `; last dump error: ${ready.dumpError}` : ''));

    const scrollNote = await normalizeScroll(serial, cfg, screen, args);
    if (scrollNote) status.notes.push(scrollNote);

    const pngBytes = adbBin(serial, ['exec-out', 'screencap', '-p']);
    if (!pngBytes.length) throw new Error('empty screencap');
    writeFileSync(png, pngBytes);
    status.png = png;

    const xml = await dumpXml(serial);
    if (!xml) {
      status.status = ready.ready ? 'no-bounds' : 'unstable';
      status.notes.push('uiautomator dump failed: png captured, measurements unavailable');
      return status;
    }

    const nodes = parseBounds(xml);
    const data = {
      screenId: screen.id,
      route: screen.route ?? null,
      capturedAt: new Date().toISOString(),
      ...metrics(nodes, ctx.density),
      nodes: nodes.filter((n) => n.text || n.desc || n.id || n.clickable),
    };
    writeFileSync(boundsFile, JSON.stringify(data, null, 2));
    status.bounds = boundsFile;
    status.bottomGapPx = data.bottomGapPx;
    status.bottomClickableGapPx = data.bottomClickableGapPx;
    status.nodes = data.nodeCount;
    if (!ready.ready) {
      // The wait may have been blind (dumps failing during the whole window)
      // while the screen itself was fine: the final dump decides, on content.
      const texts = data.nodes.filter((n) => n.text || n.desc).length;
      const clickable = data.nodes.filter((n) => n.clickable).length;
      if (texts >= (cfg.ready?.minTexts ?? 3) || clickable >= 1) {
        status.notes.push(`rendered confirmed by the final dump (${texts} texts, ${clickable} clickable)`);
      } else {
        status.status = 'unstable';
      }
    }
    return status;
  } catch (error) {
    status.status = 'unreachable';
    status.notes.push(String(error).slice(0, 200));
    return status;
  }
}

// --check: the "is this machine ready?" answer, before any capture is attempted.
function runCheck(cfg, root, args) {
  const rows = [];
  const add = (label, ok, detail) => rows.push({ label, ok, detail });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('node >= 22', nodeMajor >= 22, `found ${process.version}`);

  const hasAdb = commandExists('adb');
  add('adb on PATH', hasAdb, hasAdb ? 'Android platform-tools available' : 'install Android platform-tools (winget/brew/apt: see provider "stitch-fidelity" in catalog/providers.json)');

  const notes = [];
  const serial = pickDevice(cfg, notes);
  if (serial) {
    add('device online', true, serial);
  } else {
    const hasEmu = commandExists('emulator');
    const avds = hasEmu ? listAvds() : [];
    const canBoot = hasAdb && hasEmu && avds.length > 0 && cfg.adb?.autoStart !== false;
    add('device online', canBoot,
      canBoot ? `none yet — will auto-start "${avds[0]}"` : (hasEmu ? 'no device online and no AVD to start' : 'no device online and no `emulator` tool to start one'));
  }

  const template = cfg.launch?.deepLink;
  add('deep link template', !cfg.screens.some((s) => s.route) || Boolean(template),
    template ?? 'no template: screens with a route will be captured on the current screen');

  const missingRefs = cfg.screens.filter((s) => s.ref && !existsSync(resolve(root, s.ref))).map((s) => s.ref);
  add('references present', missingRefs.length === 0,
    missingRefs.length ? `missing: ${missingRefs.join(', ')}` : `${cfg.screens.filter((s) => s.ref).length} reference files`);

  const outDir = resolve(root, cfg.out ?? 'stitch/_cmp');
  let writable = true;
  try { mkdirSync(outDir, { recursive: true }); } catch { writable = false; }
  add(`output dir ${cfg.out}`, writable, writable ? outDir : 'not writable');

  const serveRoot = resolve(root, cfg.serve?.root ?? 'stitch');
  add(`serve root ${cfg.serve?.root ?? 'stitch'}`, existsSync(serveRoot), serveRoot);

  for (const note of notes) add('device', false, note);

  const failed = rows.filter((r) => !r.ok);
  if (args.json) console.log(JSON.stringify({ ok: failed.length === 0, rows }, null, 2));
  else {
    console.log('stitch_capture --check');
    for (const row of rows) console.log(`  ${row.ok ? 'OK  ' : 'MISS'} ${row.label.padEnd(30)} ${row.detail}`);
    console.log(failed.length === 0 ? '\nready: every dependency is satisfied' : `\n${failed.length} missing: fix the MISS lines above, then re-run --check`);
  }
  return failed.length ? 1 : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node stitch_capture.mjs [--config stitch/verify.config.json] [--only id1,id2]\n' +
      '                               [--from-current] [--settle ms] [--scroll top|bottom]\n' +
      '                               [--dry-run] [--check] [--json]');
    return 0;
  }

  const { root, cfg } = loadConfig(args.config);
  if (!Array.isArray(cfg.screens) || cfg.screens.length === 0) fail('config.screens is empty (project file overrides the skill defaults)');
  for (const screen of cfg.screens) if (!screen.id) fail('every config.screens entry needs an id');

  if (args.check) return runCheck(cfg, root, args);

  let screens = cfg.screens;
  if (args.only) {
    const unknown = args.only.filter((id) => !cfg.screens.some((s) => s.id === id));
    if (unknown.length) fail(`unknown screen id(s): ${unknown.join(', ')}`);
    screens = cfg.screens.filter((s) => args.only.includes(s.id));
  }

  const outDir = resolve(root, cfg.out ?? 'stitch/_cmp');
  mkdirSync(outDir, { recursive: true });
  const batch = Math.min(BATCH_LIMIT, Math.max(1, Number(cfg.launch?.batch ?? BATCH_LIMIT)));

  const notes = [];
  let serial = null;
  let density = cfg.adb?.density ?? null;
  if (args.dryRun) {
    notes.push('dry-run: device resolution skipped');
  } else {
    serial = await ensureDevice(cfg, notes);
    if (!serial) {
      for (const note of notes) console.error(`stitch_capture: ${note}`);
      console.error('stitch_capture: no usable device — run `node stitch_capture.mjs --check` for the full picture');
      return 2;
    }
    density = await resolveDensity(cfg, serial);
    if (!density) notes.push('could not read wm density: gaps stay in px only');
  }
  for (const note of notes) console.error(`stitch_capture: ${note}`);

  const ctx = { serial, cfg, outDir, args, root, density };
  const results = [];
  for (let i = 0; i < screens.length; i += batch) {
    const group = screens.slice(i, i + batch);
    for (const screen of group) results.push(await captureScreen(ctx, screen));
    if (i + batch < screens.length) await sleep(500);
  }

  const summary = {
    config: args.config,
    device: serial ?? 'dry-run',
    density,
    outDir,
    batch,
    capturedAt: new Date().toISOString(),
    screens: results,
  };
  writeFileSync(resolve(outDir, 'capture-summary.json'), JSON.stringify(summary, null, 2));

  const failed = results.filter((r) => r.status !== 'ok');
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log('screen        status     nodes  bottomGapPx  path');
    for (const r of results) {
      console.log(
        `${(r.id ?? '').padEnd(13)} ${r.status.padEnd(10)} ${String(r.nodes ?? '-').padEnd(6)} ` +
        `${String(r.bottomGapPx ?? '-').padEnd(12)} ${(r.png ?? '(none)').replace(outDir, '.')}`,
      );
      for (const note of r.notes) console.log(`              note: ${note}`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} ok on ${serial ?? 'dry-run'} -> ${outDir}`);
    if (failed.length) console.log(`not captured: ${failed.map((f) => `${f.id} (${f.status})`).join(', ')}`);
  }
  return failed.length ? 1 : 0;
}

process.exitCode = await main();
