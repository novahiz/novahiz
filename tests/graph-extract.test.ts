// Suite de tests de l'extracteur structurel maison (src/graph/extract.ts).
// Elle verrouille les règles du jalon 3 : masquage (chaînes, commentaires,
// regex, texte de template), déclarations et spans, imports/exports, sites
// d'appel, intégrité TSX, déterminisme, et indexation du corpus réel sans
// crash ni export manquant.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { extractFile, extractMarkdown } from "../src/graph/extract.ts";
import type { FileIndex } from "../src/graph/extract.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const symbol = (idx: FileIndex, name: string) => idx.symbols.find((s) => s.name === name);
const callNames = (idx: FileIndex) => new Set(idx.calls.map((c) => c.name));

describe("graph/extract - masquage du lexer", () => {
  const idx = extractFile("masked.ts", [
    "// ghostWordOnly in this comment",
    "const s = \"ghostStringOnly in string\";",
    "const re = /ghostRegexOnly[a-z]/;",
    "const tpl = `text ${innerFn(1)} tail`;",
    "function realFn(a) {",
    "  if (a) return ghostCallInCode(a);",
    "  return new PromiseLike(() => {});",
    "}",
  ].join("\n"));

  test("les occurrences dans chaîne/commentaire/regex n'existent pas", () => {
    const names = new Set(idx.identNames);
    for (const ghost of ["ghostWordOnly", "ghostStringOnly", "ghostRegexOnly"]) {
      assert.ok(!names.has(ghost), `${ghost} ne doit pas fuiter dans les identants`);
    }
    assert.ok(names.has("ghostCallInCode"));
  });

  test("un appel dans ${} d'un template est du code réel et est capturé", () => {
    const calls = callNames(idx);
    assert.ok(calls.has("innerFn"), "appel dans ${} attendu");
    assert.ok(calls.has("ghostCallInCode"));
    assert.ok(calls.has("PromiseLike"), "appel new attendu");
  });

  test("l'identifiant déclaré est présent, l'identifiant fantôme non", () => {
    const names = new Set(idx.identNames);
    assert.ok(names.has("realFn"));
    assert.ok(!names.has("ghostWordOnly"));
  });
});

describe("graph/extract - déclarations et spans", () => {
  const idx = extractFile("decls.ts", [
    "export function realFn(a) { return a; }",
    "export function* gen() { yield 1; }",
    "export async function runAll() { await realFn(1); }",
    "export class Widget extends Base {",
    "  constructor(opts) { this.opts = opts; }",
    "  get size() { return this.opts.size; }",
    "  async render(map) { return map.transform(this.opts); }",
    "}",
    "export interface Shape { area(): number; }",
    "export type Shape2 = { area: number };",
    "export enum Color { Red = 1 }",
    "export namespace Utils {",
    "  export function helper() { return 1; }",
    "}",
    "export const arrowFn = (x): Promise<number> => {",
    "  return realFn(x);",
    "};",
    "export const CONFIG = { retries: 3 };",
    "export default function () { return 1; }",
  ].join("\n"));

  test("tous les symboles attendus avec leur nature", () => {
    const expected: Record<string, string> = {
      realFn: "function",
      gen: "function",
      runAll: "function",
      Widget: "class",
      constructor: "constructor",
      size: "getter",
      render: "method",
      Shape: "interface",
      Shape2: "type",
      Color: "enum",
      Utils: "namespace",
      helper: "function",
      arrowFn: "function",
      CONFIG: "const",
      default: "function",
    };
    for (const [name, kind] of Object.entries(expected)) {
      const s = symbol(idx, name);
      assert.ok(s, `symbole manquant : ${name}`);
      assert.equal(s.kind, kind, `${name} : nature ${s.kind} ≠ ${kind}`);
    }
  });

  test("enclosing : méthode → classe, helper → namespace, top-level → null", () => {
    assert.equal(symbol(idx, "render")!.enclosing, "Widget");
    assert.equal(symbol(idx, "size")!.enclosing, "Widget");
    assert.equal(symbol(idx, "helper")!.enclosing, "Utils");
    assert.equal(symbol(idx, "realFn")!.enclosing, null);
    assert.equal(symbol(idx, "arrowFn")!.enclosing, null);
  });

  test("heritage de la classe et de l'interface", () => {
    assert.deepEqual(symbol(idx, "Widget")!.heritage, ["Base"]);
  });

  test("signatures sans corps, spans cohérents", () => {
    for (const s of idx.symbols) {
      assert.ok(s.signature.length > 0, `${s.name} : signature vide`);
      assert.ok(s.endLine >= s.line, `${s.name} : span ${s.line}-${s.endLine}`);
    }
    const fn = symbol(idx, "realFn")!;
    assert.equal(fn.signature, "export function realFn(a) { return a; }".split("{")[0].trim());
    const arrow = symbol(idx, "arrowFn")!;
    assert.ok(arrow.signature.startsWith("export const arrowFn = (x): Promise<number> =>"));
    assert.ok(!arrow.signature.includes("{"), `le corps ne doit pas figurer : ${arrow.signature}`);
    assert.ok(!symbol(idx, "Widget")!.signature.includes("render"), "le corps de la classe ne doit pas figurer");
    assert.equal(symbol(idx, "render")!.line, 7, "la méthode render commence ligne 7");
  });

  test("modificateurs portés", () => {
    assert.ok(symbol(idx, "runAll")!.modifiers.includes("async"));
    assert.ok(symbol(idx, "render")!.modifiers.includes("async"));
    assert.ok(symbol(idx, "realFn")!.modifiers.includes("export"));
    assert.ok(symbol(idx, "arrowFn")!.modifiers.includes("arrow"));
  });
});

describe("graph/extract - imports et exports", () => {
  const idx = extractFile("deps.ts", [
    "import defImport, { named1, named2 as alias2 } from \"./dep.js\";",
    "import * as nsImport from \"./ns.js\";",
    "import type { OnlyType } from \"./types.js\";",
    "import \"./side-effect.js\";",
    "const dyn = import(\"./dyn.js\");",
    "const req = require(\"./legacy.js\");",
    "export { realThing as renamedThing } from \"./reexport.js\";",
    "export * from \"./star.js\";",
    "export * as tools from \"./tools.js\";",
    "export function realThing() {}",
    "export = legacyExport;",
  ].join("\n"));

  test("tous les spécificateurs sont relevés", () => {
    const raws = idx.imports.map((i) => i.raw);
    for (const r of ["./dep.js", "./ns.js", "./types.js", "./side-effect.js", "./dyn.js", "./legacy.js", "./reexport.js", "./star.js", "./tools.js"]) {
      assert.ok(raws.includes(r), `import manquant : ${r}`);
    }
  });

  test("liaisons nommées, alias, namespace, type-only", () => {
    const dep = idx.imports.find((i) => i.raw === "./dep.js")!;
    assert.deepEqual(
      dep.bindings.map((b) => [b.local, b.imported, b.typeOnly]),
      [["defImport", "default", false], ["named1", "named1", false], ["alias2", "named2", false]],
    );
    const ns = idx.imports.find((i) => i.raw === "./ns.js")!;
    assert.equal(ns.bindings[0].imported, "*");
    const types = idx.imports.find((i) => i.raw === "./types.js")!;
    assert.equal(types.bindings[0].typeOnly, true);
    const side = idx.imports.find((i) => i.raw === "./side-effect.js")!;
    assert.deepEqual(side.bindings, []);
  });

  test("import dynamique et require", () => {
    const dyn = idx.imports.find((i) => i.raw === "./dyn.js")!;
    assert.equal(dyn.dynamic, true);
    assert.equal(dyn.bindings[0].local, "dyn");
    const req = idx.imports.find((i) => i.raw === "./legacy.js")!;
    assert.equal(req.dynamic, false);
    assert.equal(req.bindings[0].imported, "default");
  });

  test("exports : déclarations, renommage, star, alias, export =", () => {
    for (const e of ["realThing", "renamedThing", "tools"]) {
      assert.ok(idx.exports.includes(e), `export manquant : ${e} (reçu : ${idx.exports.join(",")})`);
    }
    assert.ok(!idx.exports.includes("star.js"), "export * ne porte pas de nom");
  });
});

describe("graph/extract - sites d'appel", () => {
  const idx = extractFile("calls.ts", [
    "function declaredOnce(a) { return a; }",
    "function other() {",
    "  declaredOnce(1);",
    "  const x = db.query(\"SELECT 1\");",
    "  const y = new RepoStore(path);",
    "  const z = buildAll<Options>(cfg);",
    "  if (x) { switch (y) { case 1: break; } }",
    "  const g = obj.get(key);",
    "  return declaredOnce(x) + typeof z;",
    "}",
  ].join("\n"));

  test("la déclaration n'est pas un appel, l'usage si", () => {
    const declared = idx.calls.filter((c) => c.name === "declaredOnce");
    assert.equal(declared.length, 2, `attendu 2 appels, obtenu ${declared.length}`);
    assert.ok(declared.every((c) => c.line > 1), "la déclaration ligne 1 ne compte pas");
  });

  test("chaîne membre, new, génériques, mot-clé contextuel", () => {
    const byName = new Map(idx.calls.map((c) => [c.name, c]));
    assert.equal(byName.get("query")!.chain, "db.query");
    assert.equal(byName.get("RepoStore")!.newCall, true);
    assert.ok(byName.has("buildAll"), "appel avec arguments génériques attendu");
    assert.ok(byName.has("get"), "obj.get( ) : get est un nom contextuel, appelable");
  });

  test("if/switch/typeof/case/break ne sont pas des appels", () => {
    const calls = callNames(idx);
    for (const bad of ["if", "switch", "typeof", "case", "break"]) {
      assert.ok(!calls.has(bad), `${bad} ne doit pas être un appel`);
    }
  });

  test("enclosing : appel dans une fonction = cette fonction", () => {
    const c = idx.calls.find((x) => x.name === "query")!;
    assert.equal(c.enclosing, "other");
  });
});

describe("graph/extract - intégrité TSX", () => {
  const tsx = [
    "import { useState } from \"react\";",
    "export function Counter({ label }: { label: string }) {",
    "  const [n, setN] = useState(0);",
    "  return (",
    "    <section className=\"box\">",
    "      <h2>{label} (à composer)</h2>",
    "      <p>C'est l'équation : l'utilisateur tape 3/4 des chiffres.</p>",
    "      <button onClick={() => setN(n + 1)}>+1</button>",
    "    </section>",
    "  );",
    "}",
    "export const Title: React.FC = () => <span>Nilda</span>;",
    "const after = computeTotal(1, 2);",
  ].join("\n");
  const idx = extractFile("Widget.tsx", tsx);

  test("symboles avant et après le bloc JSX, sans corruption de portée", () => {
    assert.ok(symbol(idx, "Counter"), "composant manquant");
    assert.equal(symbol(idx, "Counter")!.kind, "function");
    assert.ok(symbol(idx, "Title"), "flèche JSX manquante");
    assert.ok(symbol(idx, "after"), "déclaration après JSX manquante");
    assert.equal(symbol(idx, "after")!.enclosing, null, "la portée module doit être intacte après JSX");
  });

  test("appels dans les expressions JSX capturés", () => {
    const calls = callNames(idx);
    assert.ok(calls.has("useState"));
    assert.ok(calls.has("setN"));
    assert.ok(calls.has("computeTotal"));
  });

  test("le span du composant englobe le JSX", () => {
    const counter = symbol(idx, "Counter")!;
    assert.ok(counter.endLine > counter.line + 5, `span trop court : ${counter.line}-${counter.endLine}`);
  });
});

describe("graph/extract - markdown", () => {
  const idx = extractMarkdown("SKILL.md", [
    "---",
    "name: demo",
    "---",
    "# H1",
    "texte",
    "## H2",
    "encore",
    "```bash",
    "# pas un titre",
    "```",
    "### H3",
  ].join("\n"));

  test("titres ATX hors frontmatter et hors bloc de code", () => {
    assert.deepEqual(idx.symbols.map((s) => s.name), ["H1", "H2", "H3"]);
  });

  test("spans de sections : H1 va jusqu'à la ligne avant H2", () => {
    const h1 = idx.symbols[0];
    assert.equal(h1.line, 4);
    assert.equal(h1.endLine, 5);
    assert.equal(idx.symbols[2].endLine, 11, "dernier titre jusqu'à la fin du fichier");
  });

  test("nature et signature", () => {
    const h2 = idx.symbols[1];
    assert.equal(h2.kind, "heading");
    assert.equal(h2.signature, "## H2");
  });
});

describe("graph/extract - déterminisme", () => {
  const src = "export const a = () => 1;\nexport function b() { return a(); }\n";
  test("deux extractions du même fichier sont strictement identiques", () => {
    assert.deepEqual(extractFile("x.ts", src), extractFile("x.ts", src));
  });
});

describe("graph/extract - corpus réel (src/ + mcp/)", () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", ".snap"].includes(entry.name)) continue;
        walk(p);
      } else if (/\.(ts|mjs)$/.test(entry.name)) {
        files.push(p);
      }
    }
  };
  walk(join(REPO_ROOT, "src"));
  walk(join(REPO_ROOT, "mcp"));

  test("le corpus est bien présent", () => {
    assert.ok(files.length >= 20, `corpus trop petit : ${files.length}`);
  });

  test("indexé sans crash, spans et signatures valides", () => {
    let symbols = 0;
    for (const p of files) {
      const rel = relative(REPO_ROOT, p).replaceAll("\\", "/");
      const idx = extractFile(rel, readFileSync(p, "utf8"));
      symbols += idx.symbols.length;
      for (const s of idx.symbols) {
        assert.ok(s.endLine >= s.line, `${rel} : ${s.name} span ${s.line}-${s.endLine}`);
        assert.ok(s.signature.length > 0, `${rel} : ${s.name} signature vide`);
      }
    }
    assert.ok(symbols >= 100, `symboles trop peu nombreux : ${symbols}`);
  });

  test("chaque `export <déclaration>` du source est dans l'index", () => {
    for (const p of files) {
      const rel = relative(REPO_ROOT, p).replaceAll("\\", "/");
      const src = readFileSync(p, "utf8");
      const idx = extractFile(rel, src);
      const re = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        assert.ok(
          idx.exports.includes(m[1]),
          `${rel} : export ${m[1]} absent de l'index (reçu : ${idx.exports.join(",")})`,
        );
      }
    }
  });
});
