import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills", "novahiz-webperf-audit", "scripts", "scan-perf.mjs");

type ScanResult = {
  stack: { frameworks: string[]; deps: string[] };
  findings: { rule: number; id: string; verdict: string; confidence: string; evidence: { file: string }[] }[];
  applicability: { rule: number; state: string; reason: string }[];
  unmeasured: number[];
};

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "novahiz-webperf-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function scan(root: string): ScanResult {
  const result = run(["--root", root, "--json"]);
  assert.equal(result.code, 0, `scan en échec : ${result.stderr}`);
  return JSON.parse(result.stdout) as ScanResult;
}

function byId(result: ScanResult, id: string) {
  return result.findings.find((entry) => entry.id === id);
}

describe("scan-perf: constats déterministes", () => {
  test("un projet web incomplet produit les constats attendus", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "fixture",
        dependencies: { next: "14.0.0", react: "18.2.0", moment: "2.29.0", prisma: "5.0.0" },
      }),
      "next.config.mjs": "export default { reactStrictMode: true };\n",
      "src/index.html": '<html><body><img src="/hero.jpg"><script src="https://www.googletagmanager.com/gtag/js"></script></body></html>\n',
      "styles/globals.css": '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700;800");\nbody { font-weight: 400; }\n',
      "app/api.js": 'export async function load() {\n  const a = await fetch("https://api.exemple.com/rates");\n  return a;\n}\n',
      "app/other.js": 'export async function again() {\n  return fetch("https://api.exemple.com/rates");\n}\n',
      "db/query.sql": "SELECT * FROM orders;\n",
    });
    const result = scan(root);

    assert.ok(result.stack.frameworks.includes("next"), "stack next détectée");
    assert.equal(byId(result, "img-no-lazy")?.verdict, "absent");
    assert.equal(byId(result, "img-no-dimensions")?.verdict, "absent");
    assert.equal(byId(result, "script-blocking")?.verdict, "absent");
    assert.equal(byId(result, "font-tiers")?.verdict, "absent");
    assert.equal(byId(result, "select-star")?.verdict, "absent");
    assert.equal(byId(result, "heavy-deps")?.verdict, "absent");
    assert.equal(byId(result, "fetch-no-timeout")?.verdict, "absent");
    assert.equal(byId(result, "duplicate-request")?.verdict, "absent");
    assert.equal(
      result.applicability.find((entry) => entry.rule === 8)?.state,
      "applicable",
      "prisma déclaré : la règle N+1 reste dans le périmètre",
    );
    assert.ok(!result.unmeasured.includes(24), "une règle tranchée ne reste pas dans les non mesurées");
  });

  test("sans base de données, les règles SQL sortent du périmètre", () => {
    const root = fixture({
      "package.json": JSON.stringify({ name: "static", dependencies: { vite: "5.0.0" } }),
      "index.html": '<html><body><img src="/a.png" loading="lazy" width="10" height="10"></body></html>\n',
    });
    const result = scan(root);

    for (const rule of [8, 17, 25]) {
      const entry = result.applicability.find((candidate) => candidate.rule === rule);
      assert.equal(entry?.state, "inapplicable", `règle ${rule} hors périmètre`);
      assert.ok(entry?.reason.includes("aucune base"), `règle ${rule} justifiée`);
    }
    assert.equal(byId(result, "db-client-per-request"), undefined, "aucun constat base sans base");
  });

  test("l'interface en ligne de commande est utilisable", () => {
    const help = run(["--help"]);
    assert.equal(help.code, 0);
    assert.ok(help.stdout.includes("Usage:"), "aide affichée");

    const bad = run(["--inconnu"]);
    assert.equal(bad.code, 2, "option invalide rejetée");
    assert.ok(bad.stderr.includes("option inconnue"));

    const missing = run(["--root", join(tmpdir(), "chemin-qui-nexiste-pas-42")]);
    assert.equal(missing.code, 2, "racine absente rejetée");
  });
});
