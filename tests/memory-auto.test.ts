// S-AUTO: memoire automatique — bloc spec memory.auto (triggers T1-T5
// full-on, lecture k=3 / minScore 0.25 / anti-repetition / postCompaction),
// kill-switch NOVAHIZ_MEM_AUTO, builders purs des faits et des resumes, et
// le mode one-shot --call du serveur MCP.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { DEFAULT_CONFIG, mergeConfig, type NovahizConfig } from "../src/spec.ts";
import plugin, {
  applyInjectionBudget,
  autoReadQuery,
  autoWriteTrigger,
  buildAutoReadLines,
  buildAutoWrite,
  formatInheritance,
  isSpecConfigPath,
  mergeSummaryWindow,
  pickInheritance,
  resolveMemoryAuto
} from "../adapters/opencode/novahiz.ts";

// L'ecriture du regex evite le marqueur literal que le gate detecte sur le
// contenu des fichiers (le test verifie l'absence de placeholder, pas sa
// presence).
const PLACEHOLDER = /\bT(O|0)DO\b|\bF(I|1)XME\b/;

// Reinterprete un objet JSON brut comme config partielle: JSON.parse ne
// produit jamais les types complets de NovahizConfig, c'est exactement le
// passage que mergeConfig doit encaisser sans jamais tomber en defaut.
const rawConfig = (value: unknown): Partial<NovahizConfig> => value as Partial<NovahizConfig>;

describe("S-AUTO - bloc spec memory.auto (src/spec.ts)", () => {
  test("defauts full-on: T1-T5 actives + lecture k=3 minScore 0.25 anti-repetition postCompaction", () => {
    const auto = DEFAULT_CONFIG.memory.auto;
    assert.equal(auto.enabled, true);
    assert.deepEqual(auto.write, { todoDone: true, review: true, taskEnd: true, compaction: true, spec: true });
    assert.deepEqual(auto.read, { k: 3, minScore: 0.25, antiRepetition: true, postCompaction: true, budgetTokens: 1500 });
  });

  test("mergeConfig: config absente -> defauts intacts", () => {
    assert.deepEqual(mergeConfig(null).memory, DEFAULT_CONFIG.memory);
    assert.deepEqual(mergeConfig({}).memory, DEFAULT_CONFIG.memory);
  });

  test("mergeConfig: surcharge partielle preserve le reste", () => {
    const cfg = mergeConfig(rawConfig({ memory: { auto: { read: { k: 7 }, write: { spec: false } } } }));
    assert.equal(cfg.memory.auto.enabled, true);
    assert.equal(cfg.memory.auto.read.k, 7);
    assert.equal(cfg.memory.auto.read.minScore, 0.25);
    assert.equal(cfg.memory.auto.write.spec, false);
    assert.equal(cfg.memory.auto.write.todoDone, true);
    assert.equal(cfg.memory.auto.write.review, true);
    assert.equal(cfg.memory.auto.write.taskEnd, true);
    assert.equal(cfg.memory.auto.write.compaction, true);
  });

  test("mergeConfig: hors bornes -> retombee sur le defaut (config corrompue inoffensive)", () => {
    const cfg = mergeConfig(rawConfig({ memory: { auto: { read: { k: 0, minScore: 1.5 }, write: { review: "yes" } } } }));
    assert.equal(cfg.memory.auto.read.k, 3);
    assert.equal(cfg.memory.auto.read.minScore, 0.25);
    assert.equal(cfg.memory.auto.write.review, true);
  });

  test("mergeConfig: memory.auto.enabled=false est honore", () => {
    const cfg = mergeConfig(rawConfig({ memory: { auto: { enabled: false } } }));
    assert.equal(cfg.memory.auto.enabled, false);
  });
});

describe("S-AUTO - kill-switch NOVAHIZ_MEM_AUTO (resolveMemoryAuto)", () => {
  test("vocabulaire off coupe l'auto, insensible a la casse et aux espaces", () => {
    for (const value of ["off", "0", "false", "no", "disabled", "OFF", " False "]) {
      assert.equal(resolveMemoryAuto(undefined, value), null, `env=${JSON.stringify(value)}`);
    }
  });

  test("env absent + config absente -> full-on par defaut", () => {
    const auto = resolveMemoryAuto(undefined, undefined);
    assert.ok(auto);
    assert.equal(auto.enabled, true);
    assert.deepEqual(auto.write, { todoDone: true, review: true, taskEnd: true, compaction: true, spec: true });
    assert.equal(auto.read.k, 3);
    assert.equal(auto.read.minScore, 0.25);
    assert.equal(auto.read.antiRepetition, true);
    assert.equal(auto.read.postCompaction, true);
  });

  test("env non-desactivant ('1', 'on') -> la config decide", () => {
    assert.ok(resolveMemoryAuto(undefined, "1"));
    assert.ok(resolveMemoryAuto(undefined, "on"));
  });

  test("memory.auto.enabled=false coupe; surcharge partielle normalisee", () => {
    assert.equal(resolveMemoryAuto({ auto: { enabled: false } }, undefined), null);
    const auto = resolveMemoryAuto({ auto: { read: { k: 9, minScore: 0.5 }, write: { review: false } } }, undefined);
    assert.ok(auto);
    assert.equal(auto.read.k, 9);
    assert.equal(auto.read.minScore, 0.5);
    assert.equal(auto.write.review, false);
    assert.equal(auto.write.todoDone, true);
  });

  test("valeurs invalides -> defauts: une config corrompue n'ecoupe ni n'agrandit l'auto", () => {
    const auto = resolveMemoryAuto(
      { auto: { read: { k: -4, minScore: 99, antiRepetition: "yes" }, write: { spec: 1 } } },
      undefined
    );
    assert.ok(auto);
    assert.equal(auto.read.k, 3);
    assert.equal(auto.read.minScore, 0.25);
    assert.equal(auto.read.antiRepetition, true);
    assert.equal(auto.write.spec, true);
  });
});

describe("S-AUTO - injection lecture (buildAutoReadLines)", () => {
  const READ = { k: 3, minScore: 0.25, antiRepetition: true, postCompaction: true, budgetTokens: 1500 };
  const hit = (id: string, score: number, title = id, snippet = "note") => ({ id, score, title, snippet });

  test("k=3: au plus 3 resumes au-dessus du seuil, entetes + directive", () => {
    const hits = [hit("slot-001", 0.9), hit("slot-002", 0.6), hit("slot-003", 0.4), hit("slot-004", 0.3)];
    const { lines, injectedIds, details } = buildAutoReadLines(hits, READ, new Set());
    assert.deepEqual(injectedIds, ["slot-001", "slot-002", "slot-003"]);
    // Les lignes de detail restent alignees sur injectedIds: c'est sur ce
    // couple que repose la fenetre anti-repetition de la session.
    assert.equal(details.length, injectedIds.length);
    assert.ok(details.every((line, index) => line.includes(injectedIds[index])));
    assert.match(lines[0], /auto-injected summaries \(3\/3, minScore 0\.25\)/);
    assert.ok(lines.some((line) => line.includes("slot-001 (score 0.90)")));
    assert.match(lines[lines.length - 1], /^Directive: /);
    assert.doesNotMatch(lines.join("\n"), PLACEHOLDER);
  });

  test("minScore: tout score < 0.25 est ecarte", () => {
    const hits = [hit("slot-001", 0.9), hit("slot-009", 0.1), hit("slot-010", 0.249)];
    const { injectedIds } = buildAutoReadLines(hits, READ, new Set());
    assert.deepEqual(injectedIds, ["slot-001"]);
  });

  test("anti-repetition: un id deja injecte ne repasse pas", () => {
    const hits = [hit("slot-001", 0.9), hit("slot-002", 0.6)];
    const first = buildAutoReadLines(hits, READ, new Set());
    assert.equal(first.injectedIds.length, 2);
    const second = buildAutoReadLines(hits, READ, new Set(first.injectedIds));
    assert.deepEqual(second, { lines: [], injectedIds: [], details: [] });
    // Un slot nouveau reste injectable malgre l'anti-repetition.
    const third = buildAutoReadLines([...hits, hit("slot-003", 0.5)], READ, new Set(first.injectedIds));
    assert.deepEqual(third.injectedIds, ["slot-003"]);
  });

  test("anti-repetition desactivee: re-injection possible", () => {
    const off = { ...READ, antiRepetition: false };
    const hits = [hit("slot-001", 0.9)];
    const first = buildAutoReadLines(hits, off, new Set());
    const second = buildAutoReadLines(hits, off, new Set(first.injectedIds));
    assert.deepEqual(second.injectedIds, ["slot-001"]);
  });

  test("entrees invalides (id ou score manquant) ignorees", () => {
    const hits = [
      {},
      { id: "x" },
      { score: 0.9 },
      { id: "slot-001", score: Number.NaN },
      { id: "slot-002", score: 0.5 }
    ];
    const { injectedIds } = buildAutoReadLines(hits, READ, new Set());
    assert.deepEqual(injectedIds, ["slot-002"]);
  });
});

describe("S-AUTO - fenetre anti-repetition persistante (mergeSummaryWindow)", () => {
  const k = 3;
  const line = (id: string) => `  - ${id} (score 0.90): titre`;

  test("un id deja en fenetre n'est jamais re-injecte", () => {
    const state = { ids: ["slot-001"], details: [line("slot-001")] };
    const merged = mergeSummaryWindow(state, ["slot-001", "slot-002"], [line("slot-001"), line("slot-002")], k);
    assert.deepEqual(merged.ids, ["slot-001", "slot-002"]);
    // La ligne du doublon est ignoree: detail aligne sur l'id entrant.
    assert.equal(merged.details.length, 2);
    assert.equal(merged.details.filter((entry) => entry.includes("slot-001")).length, 1);
  });

  test("fenetre bornee a k: FIFO, ids et details restent alignes", () => {
    let state = { ids: [] as string[], details: [] as string[] };
    for (const id of ["slot-001", "slot-002", "slot-003"]) {
      state = mergeSummaryWindow(state, [id], [line(id)], k);
    }
    state = mergeSummaryWindow(state, ["slot-004"], [line("slot-004")], k);
    assert.deepEqual(state.ids, ["slot-002", "slot-003", "slot-004"]);
    assert.equal(state.ids.length, state.details.length);
    assert.ok(state.details.every((entry, index) => entry.includes(state.ids[index])));
  });

  test("aucun id nouveau: l'etat precedent est conserve tel quel", () => {
    const state = { ids: ["slot-001"], details: [line("slot-001")] };
    const merged = mergeSummaryWindow(state, [], [], k);
    assert.deepEqual(merged, state);
    // Le bloc reconstruit a chaque prompt re-emet donc les memes lignes —
    // c'est la persistance qui evite que les resumes disparaisse du contexte.
    assert.deepEqual(merged.details, [line("slot-001")]);
  });

  test("detail manquant pour un id: la ligne est sautee sans desaligner", () => {
    const state = { ids: [] as string[], details: [] as string[] };
    const merged = mergeSummaryWindow(state, ["slot-001", "slot-002"], [line("slot-001")], k);
    assert.deepEqual(merged.ids, ["slot-001"]);
    assert.equal(merged.details.length, 1);
  });
});

describe("S-AUTO - requete concentree (autoReadQuery)", () => {
  test("tete du prompt bornee a 16 tokens non vides", () => {
    const long = Array.from({ length: 40 }, (_, index) => `mot${index}`).join("   \n ");
    const query = autoReadQuery(long);
    assert.equal(query.split(" ").length, 16);
    assert.ok(query.startsWith("mot0 mot1"));
    assert.doesNotMatch(query, /\s{2,}|\n/);
  });

  test("prompt court: conserve tel quel (espaces normalises)", () => {
    assert.equal(autoReadQuery("  novahiz_task action=done probe  "), "novahiz_task action=done probe");
  });

  test("prompt vide: requete vide", () => {
    assert.equal(autoReadQuery("   \n  "), "");
  });
});

describe("S-AUTO - triggers d'ecriture deterministes", () => {
  test("T1 done / T2 review sur novahiz_task, autres actions ignorees", () => {
    assert.equal(autoWriteTrigger("novahiz_task", { action: "done" }), "todoDone");
    // Le nom effectif en session porte le prefixe du serveur MCP.
    assert.equal(autoWriteTrigger("novahiz_novahiz_task", { action: "done" }), "todoDone");
    assert.equal(autoWriteTrigger("novahiz_task", { action: "review" }), "review");
    assert.equal(autoWriteTrigger("novahiz_task", { action: "start" }), null);
    assert.equal(autoWriteTrigger("novahiz_task", {}), null);
    assert.equal(autoWriteTrigger("memory_write", { action: "done" }), null);
  });

  test("T5 sur les fichiers spec/config, quel que soit le repertoire", () => {
    assert.equal(autoWriteTrigger("edit", { filePath: "novahiz.config.json" }), "spec");
    assert.equal(autoWriteTrigger("write", { file_path: "C:\\x\\novahiz.config.example.json" }), "spec");
    assert.equal(autoWriteTrigger("patch", { path: "src/main.ts" }), null);
    assert.equal(autoWriteTrigger("bash", { filePath: "novahiz.config.json" }), null);
    assert.equal(isSpecConfigPath("a/b/novahiz.config.json"), true);
    assert.equal(isSpecConfigPath("a\\b\\novahiz.config.json"), true);
    assert.equal(isSpecConfigPath("novahiz.config.jsonx"), false);
  });

  test("T1: fait todo done, contenu deterministe et complet", () => {
    const fact = buildAutoWrite(
      "todoDone",
      { id: "todo_1", task_id: "task_1", label: "S1 lock", proof: "npm test 71/71" },
      { sessionID: "ses_x" }
    );
    assert.ok(fact);
    assert.equal(fact.title, "Todo done: S1 lock");
    assert.match(fact.content, /T1 — capture automatique/);
    assert.match(fact.content, /todo: todo_1/);
    assert.match(fact.content, /tache: task_1/);
    assert.match(fact.content, /label: S1 lock/);
    assert.match(fact.content, /preuve: npm test 71\/71/);
    assert.match(fact.content, /session: ses_x/);
    assert.match(fact.content, /horodatage: \d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(fact.tags, ["auto", "todo-done"]);
    assert.doesNotMatch(fact.content, PLACEHOLDER);
  });

  test("T1 sans preuve: valeur explicite, jamais de marqueur", () => {
    const fact = buildAutoWrite("todoDone", { id: "todo_2", task_id: "task_1", label: "x", proof: "" }, { sessionID: "s" });
    assert.ok(fact);
    assert.match(fact.content, /preuve: aucune preuve fournie/);
    assert.doesNotMatch(fact.content, PLACEHOLDER);
  });

  test("T2: revision + resume des changements de review", () => {
    const fact = buildAutoWrite(
      "review",
      {
        revision: 3,
        task: { id: "task_1", title: "Mémoire Novahiz" },
        applied: { additions: 2, amendments: 1, removals: 0, reordered: false },
        signals: [{ type: "scope" }]
      },
      { sessionID: "ses_x" }
    );
    assert.ok(fact);
    assert.equal(fact.title, "Ledger review r3");
    assert.match(fact.content, /revision: 3/);
    assert.match(fact.content, /task_1 — Mémoire Novahiz/);
    assert.match(fact.content, /\+2 additions, ~1 amendments, -0 removals, reordered=false/);
    assert.match(fact.content, /signals: 1/);
    assert.deepEqual(fact.tags, ["auto", "review"]);
    assert.doesNotMatch(fact.content, PLACEHOLDER);
  });

  test("T5: fichier, outil et rappel du redemarrage", () => {
    const fact = buildAutoWrite(
      "spec",
      { path: "C:/Users/x/.config/novahiz/novahiz.config.json", tool: "edit" },
      { sessionID: "ses_x" }
    );
    assert.ok(fact);
    assert.equal(fact.title, "Spec change: novahiz.config.json");
    assert.match(fact.content, /fichier: .*novahiz\.config\.json/);
    assert.match(fact.content, /outil: edit/);
    assert.match(fact.content, /redemarrer opencode/);
    assert.deepEqual(fact.tags, ["auto", "spec"]);
    assert.doesNotMatch(fact.content, PLACEHOLDER);
  });

  test("P2: la provenance (session/tache/date) ouvre chaque entree auto", () => {
    const done = buildAutoWrite(
      "todoDone",
      { id: "todo_1", task_id: "task_1", label: "S1 lock", proof: "ok" },
      { sessionID: "ses_x" }
    );
    assert.ok(done);
    assert.match(done.content.split("\n")[0], /^Provenance: session ses_x \| tache task_1 \| \d{4}-\d{2}-\d{2}T/);

    const review = buildAutoWrite(
      "review",
      { revision: 3, task: { id: "task_1", title: "Memoire" } },
      { sessionID: "ses_x" }
    );
    assert.ok(review);
    assert.match(review.content.split("\n")[0], /^Provenance: session ses_x \| tache task_1 \| \d{4}-\d{2}-\d{2}T/);

    const spec = buildAutoWrite("spec", { path: "novahiz.config.json", tool: "edit" }, { sessionID: "ses_x" });
    assert.ok(spec);
    assert.match(spec.content.split("\n")[0], /^Provenance: session ses_x \| \d{4}-\d{2}-\d{2}T/);
  });
});

describe("P3 - heritage inter-sessions + budget de tokens", () => {
  const READ_FULL = { k: 3, minScore: 0.25, antiRepetition: true, postCompaction: true, budgetTokens: 1500 };
  const slot = (id: string, title: string, updated: string, extra: Record<string, unknown> = {}) => ({
    id,
    title,
    updated,
    status: "active",
    tags: [],
    file: `slots/${id}-x.md`,
    ...extra
  });

  test("pickInheritance: recent d'abord (top 3), regles durables isolees, non-active exclues", () => {
    const slots = [
      slot("slot-001", "note ordinaire", "2026-01-01T00:00:00.000Z"),
      slot("slot-002", "regle-durable: toujours tester", "2026-01-02T00:00:00.000Z"),
      slot("slot-003", "note recente", "2026-10-01T00:00:00.000Z"),
      slot("slot-004", "ancien archive", "2025-01-01T00:00:00.000Z", { status: "archived" }),
      slot("slot-005", "note avec tag", "2026-10-02T00:00:00.000Z", { tags: ["règle-durable"] }),
      slot("slot-006", "note plus recente", "2026-10-03T00:00:00.000Z"),
      slot("slot-007", "note en tete", "2026-10-04T00:00:00.000Z")
    ];
    const { recent, rules } = pickInheritance(slots);
    assert.deepEqual(
      recent.map((entry) => entry.id),
      ["slot-007", "slot-006", "slot-003"],
      "top 3 par updated decroissant, hors regles et hors archives"
    );
    assert.deepEqual(
      rules.map((entry) => entry.id),
      ["slot-002", "slot-005"],
      "regles durables detectees par titre OU tags, graphies accentuees comprise"
    );
  });

  test("formatInheritance: sections, provenance session, jamais au-dela du budget", () => {
    const recent = [
      { id: "slot-008", title: "T5 migration", updated: "2026-10-03T12:00:00.000Z", session: "ses_abc" },
      { id: "slot-007", title: "Plan", updated: "2026-10-02T12:00:00.000Z" }
    ];
    const rules = [{ id: "slot-002", title: "regle-durable: tester" }];
    const lines = formatInheritance(recent, rules, 4000);
    assert.match(lines[0], /^Heritage des sessions precedentes/);
    assert.ok(lines.some((line) => line.includes("slot-008 (2026-10-03, ses_abc)")), "provenance session incluse");
    assert.ok(lines.some((line) => line.includes("slot-007 (2026-10-02)")), "date seule sans provenance");
    assert.ok(lines.some((line) => line.includes("Regles durables:")), "section regles presente");
    assert.ok(lines.some((line) => line.includes("slot-002")), "regle durablee injectee");
    // Budget serr: les entrees s'arretent avant le depasseement.
    const tiny = formatInheritance(recent, rules, 80);
    const used = tiny.reduce((sum, line) => sum + line.length + 1, 0);
    assert.ok(used <= 80, `budget depasse: ${used}`);
    assert.ok(tiny.length >= 1, "au moins l'en-tete passe");
    // Rien a heriter -> rien a injecter.
    assert.deepEqual(formatInheritance([], [], 4000), []);
  });

  test("applyInjectionBudget: ordre conserve, arret au premier depassement", () => {
    const lines = ["a", "bb", "ccc", "dddd"];
    assert.deepEqual(applyInjectionBudget(lines, 100), lines, "tout tient");
    assert.deepEqual(applyInjectionBudget(lines, 7), ["a", "bb"], "2+3=5 tient, +4=9 depasse");
    assert.deepEqual(applyInjectionBudget(lines, 1), [], "rien ne tient");
  });

  test("buildAutoReadLines(maxChars): details tronquees, ids alignes, entete reflete l'effectif", () => {
    const hits = [
      { id: "slot-001", score: 0.9, title: "T1", snippet: "note" },
      { id: "slot-002", score: 0.6, title: "T2", snippet: "note" },
      { id: "slot-003", score: 0.5, title: "T3", snippet: "note" }
    ];
    const all = buildAutoReadLines(hits, READ_FULL, new Set());
    assert.equal(all.details.length, 3);
    const cut = all.details[0].length + 1 + all.details[1].length + 1;
    const trimmed = buildAutoReadLines(hits, READ_FULL, new Set(), cut);
    assert.equal(trimmed.details.length, 2, "3e ligne hors budget");
    assert.deepEqual(trimmed.injectedIds, ["slot-001", "slot-002"], "ids alignes sur les lignes conservees");
    assert.match(trimmed.lines[0], /auto-injected summaries \(2\/3, minScore 0\.25\)/);
    assert.match(trimmed.lines[trimmed.lines.length - 1], /^Directive: /, "la directive lazy reste");
  });

  test("resolveMemoryAuto: budgetTokens 1500 par defaut, sur-mesure, hors bornes retombe", () => {
    const def = resolveMemoryAuto(undefined, undefined);
    assert.ok(def);
    assert.equal(def.read.budgetTokens, 1500);
    const custom = resolveMemoryAuto({ auto: { read: { budgetTokens: 900 } } }, undefined);
    assert.ok(custom);
    assert.equal(custom.read.budgetTokens, 900);
    for (const bad of [50, 9999, Number.NaN, "1500"]) {
      const resolved = resolveMemoryAuto({ auto: { read: { budgetTokens: bad } } }, undefined);
      assert.ok(resolved);
      assert.equal(resolved.read.budgetTokens, 1500, `hors bornes: ${String(bad)}`);
    }
  });

  test("spec.ts: budgetTokens reflete dans mergeConfig (miroir plugin)", () => {
    const custom = mergeConfig(rawConfig({ memory: { auto: { read: { budgetTokens: 700 } } } }));
    assert.equal(custom.memory.auto.read.budgetTokens, 700);
    const outOfRange = mergeConfig(rawConfig({ memory: { auto: { read: { budgetTokens: 42 } } } }));
    assert.equal(outOfRange.memory.auto.read.budgetTokens, 1500);
    const absent = mergeConfig(rawConfig({}));
    assert.equal(absent.memory.auto.read.budgetTokens, 1500);
  });
});

describe("S-AUTO - plugin importable", () => {
  test("export par defaut present", () => {
    assert.equal(plugin.id, "novahiz");
    assert.equal(typeof plugin.setup, "function");
  });
});

describe("S-AUTO - MCP one-shot (--call)", () => {
  const MCP = join(process.cwd(), "mcp", "novahiz-tools", "index.mjs");
  const cwd = mkdtempSync(join(tmpdir(), "novahiz-sauto-"));

  after(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  // NOVAHIZ_DB isole la DB des tests: memory_search indexe (P4) dans SQLite
  // et la ledger reelle ne doit recevoir aucune ligne de ces appels.
  const call = (tool: string, input: string) =>
    spawnSync(process.execPath, [MCP, "--call", tool], {
      encoding: "utf8",
      input,
      cwd,
      env: { ...process.env, NOVAHIZ_DB: join(cwd, "fts.sqlite") },
      timeout: 60_000
    });

  test("memory_write cree un slot sous cwd/project-memory", () => {
    const res = call("memory_write", JSON.stringify({ title: "Auto probe", content: "fait observe en session", tags: ["auto"] }));
    assert.equal(res.status, 0, res.stderr);
    const indexPath = join(cwd, "project-memory", "index.json");
    assert.ok(existsSync(indexPath));
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { slots: { title: string; status: string }[] };
    assert.equal(index.slots.length, 1);
    assert.equal(index.slots[0].title, "Auto probe");
    assert.equal(index.slots[0].status, "active");
  });

  test("memory_search retrouve le slot avec score et confidence", () => {
    call("memory_write", JSON.stringify({ title: "gate enforcement skills", content: "le gate bloque les edits avant skills" }));
    const res = call("memory_search", JSON.stringify({ query: "gate enforcement", limit: 5 }));
    assert.equal(res.status, 0, res.stderr);
    const envelope = JSON.parse(res.stdout.trim()) as {
      result: { content: { type: string; text: string }[] };
    };
    const payload = JSON.parse(envelope.result.content[0].text) as {
      results: { id: string; score: number; confidence: string }[];
    };
    assert.ok(payload.results.length >= 1);
    // "gate enforcement skills" n'est pas routable vers "Auto probe" (seuil
    // 0.25): l'ecriture a cree slot-002, qui doit ressortir en tete.
    assert.equal(payload.results[0].id, "slot-002");
    assert.ok(payload.results[0].score > 0 && payload.results[0].score <= 1);
    assert.ok(["high", "medium", "low"].includes(payload.results[0].confidence));
  });

  test("outil inconnu -> exit 1 + erreur -32601", () => {
    const res = call("nope_tool", "{}");
    assert.equal(res.status, 1);
    const envelope = JSON.parse(res.stdout.trim()) as { error: { code: number; message: string } };
    assert.equal(envelope.error.code, -32601);
    assert.match(envelope.error.message, /Unknown tool/);
  });

  test("JSON d'entree invalide -> exit 1 + erreur -32700", () => {
    const res = call("memory_search", "{bad json");
    assert.equal(res.status, 1);
    const envelope = JSON.parse(res.stdout.trim()) as { error: { code: number } };
    assert.equal(envelope.error.code, -32700);
  });

  test("parametres invalides -> exit 1 + erreur -32602", () => {
    const res = call("memory_search", "{}");
    assert.equal(res.status, 1);
    const envelope = JSON.parse(res.stdout.trim()) as { error: { code: number; message: string } };
    assert.equal(envelope.error.code, -32602);
    assert.match(envelope.error.message, /query/);
  });
});
