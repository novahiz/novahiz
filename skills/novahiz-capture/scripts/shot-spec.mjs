#!/usr/bin/env node
// shot-spec.mjs — calcule la config setViewportSize pour capturer un viewport
// CSS donne (echelle systeme + plafond de hauteur d'ecran). Aucune dependance,
// aucun navigateur: c'est une calculatrice, pas un launcher.
//
// Rapports mesures (machine de reference, ecran 1800x900 physiques, echelle 125%):
//   setViewport(1800, 900) -> inner 1440x720 ; 1800x1125 -> bande morte en bas.

const HELP = `shot-spec.mjs — viewport CSS -> setViewportSize

Usage:
  node shot-spec.mjs --css <W> [options]

Options:
  --css <W[xH]>      Largeur CSS voulue, hauteur optionnelle (ex: 1440 ou 1440x720)
  --scale <n>        Echelle systeme CSS->physique (defaut: 1)
  --dpr, --zoom <n>  Alias de --scale (meme role: le rapport CSS->physique)
  --screen <WxH>     Hauteur physique de l'ecran, pour le plafond anti-bande-morte
  --json             Sortie JSON seule
  --help             Cette aide

Exemples (machine de reference: echelle 1.25, ecran 1800x900):
  node shot-spec.mjs --css 1440 --scale 1.25 --screen 1800x900
  node shot-spec.mjs --css 320 --dpr 1.25 --screen 1800x900 --json

Sortie: { css, scale, setViewport: { width, height }, warnings: [...] }
warnings non vide si la hauteur demandee depasse le plafond de l'ecran
(bande morte en bas de l'image de capture).`;

function parseSize(value, label) {
  const match = /^(\d+)(?:x(\d+))?$/.exec(String(value).trim());
  if (!match) {
    console.error(`shot-spec: ${label} invalide: ${value} (attendu 1800 ou 1800x900)`);
    process.exit(1);
  }
  return { width: Number(match[1]), height: match[2] ? Number(match[2]) : null };
}

function main(argv) {
  const args = { scale: null, css: null, screen: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") {
      console.log(HELP);
      return 0;
    }
    if (flag === "--json") {
      args.json = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) {
      console.error(`shot-spec: ${flag} attend une valeur`);
      return 1;
    }
    if (flag === "--css") args.css = value;
    else if (flag === "--scale" || flag === "--dpr" || flag === "--zoom") args.scale = Number(value);
    else if (flag === "--screen") args.screen = value;
    else {
      console.error(`shot-spec: option inconnue ${flag} (voir --help)`);
      return 1;
    }
    i += 1;
  }

  if (!args.css) {
    console.error("shot-spec: --css est requis (ex: --css 1440)");
    return 1;
  }
  const css = parseSize(args.css, "--css");
  const scale = args.scale === null ? 1 : args.scale;
  if (!Number.isFinite(scale) || scale <= 0) {
    console.error(`shot-spec: --scale invalide: ${args.scale}`);
    return 1;
  }

  const warnings = [];
  let viewportHeight = Math.round((css.height ?? css.width) * scale);
  const viewportWidth = Math.round(css.width * scale);

  if (args.screen) {
    const screen = parseSize(args.screen, "--screen");
    const ceiling = screen.height;
    if (viewportHeight > ceiling) {
      warnings.push(
        `hauteur ${viewportHeight} > plafond ecran ${ceiling}: bande morte en bas de l'image. ` +
          `Descends a setViewport height ${ceiling} (CSS ${Math.floor(ceiling / scale)}px au maximum).`
      );
      viewportHeight = ceiling;
    }
  } else {
    warnings.push("aucun --screen donne: plafond anti-bande-morte non verifie");
  }

  const result = {
    css: css.height ? { width: css.width, height: css.height } : { width: css.width },
    scale,
    setViewport: { width: viewportWidth, height: viewportHeight },
    innerWidthApresSetViewport: Math.round(viewportWidth / scale),
    warnings
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`setViewportSize(${result.setViewport.width}, ${result.setViewport.height})`);
    console.log(`  -> innerWidth attendu: ${result.innerWidthApresSetViewport} CSS px (echelle x${scale})`);
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
