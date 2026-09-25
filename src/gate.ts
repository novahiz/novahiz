import type { Rule, Spec } from "./spec.ts";
import { hasPlaceholder, hasProse, hasStyle, isTrivial } from "./content.ts";
import { determineTier, type ComplexityTier } from "./complexity.ts";
// Shared ledger enforcement (audit P1-D/M1): the CLI command and the MCP
// novahiz_gate tool both run these checks so their verdicts cannot diverge.
import { activeTask, recordEdit, reviewBlockReason, reviewDue, traceCheck } from "./ledger.ts";
import { autoCommit } from "./graft.ts";
import type { openDb } from "./db.ts";

type GateDb = ReturnType<typeof openDb>;

type FileClass = "code" | "text" | "design" | "data" | "config" | "other";

const CLASS_BY_EXTENSION: Record<string, FileClass> = {
  css: "design",
  scss: "design",
  sass: "design",
  less: "design",
  styl: "design",
  html: "design",
  htm: "design",
  vue: "design",
  svelte: "design",
  astro: "design",
  jsx: "design",
  tsx: "design",
  md: "text",
  mdx: "text",
  markdown: "text",
  txt: "text",
  rst: "text",
  adoc: "text",
  json: "data",
  jsonc: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  csv: "data",
  tsv: "data",
  xml: "data",
  env: "config",
  ini: "config",
  cfg: "config",
  conf: "config",
  gitignore: "config",
  gitattributes: "config",
  js: "code",
  mjs: "code",
  cjs: "code",
  ts: "code",
  mts: "code",
  cts: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  kts: "code",
  swift: "code",
  c: "code",
  cc: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  cs: "code",
  php: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  ps1: "code",
  sql: "code",
  lua: "code",
  dart: "code",
  ex: "code",
  exs: "code",
  erl: "code",
  clj: "code",
  scala: "code"
};

export function fileClass(filePath: string): FileClass {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (base.length === 0) return "other";

// M8: dotted dotfiles (.env.local, .eslintrc.json, .babelrc.js) carry a config
// basename before their extension — classify by basename first.
const CONFIG_BASENAMES = new Set([
  "env",
  "eslintrc",
  "babelrc",
  "prettierrc",
  "stylelintrc",
  "editorconfig",
  "dockerignore",
  "npmrc",
  "yarnrc",
  "nvmrc",
  "terraformrc",
  "gitignore",
  "gitattributes"
]);

  if (base.startsWith(".")) {
    const rest = base.replace(/^\.+/, "").toLowerCase();
    if (rest.length === 0) return "other";
    const direct = CLASS_BY_EXTENSION[rest];
    if (direct) return direct;
    const firstDot = rest.indexOf(".");
    if (firstDot > 0 && CONFIG_BASENAMES.has(rest.slice(0, firstDot))) return "config";
    const lastDot = rest.lastIndexOf(".");
    if (lastDot !== -1) {
      const ext = rest.slice(lastDot + 1);
      return CLASS_BY_EXTENSION[ext] ?? "config";
    }
    return "config";
  }

  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "other";
  const ext = base.slice(dot + 1).toLowerCase();
  return CLASS_BY_EXTENSION[ext] ?? "other";
}

// M-Gate: cache glob→RegExp conversions (same glob pattern recompiled on every call)
const GLOB_CACHE_MAX = 512;
const _globCache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  let cached = _globCache.get(glob);
  if (cached) return cached;
  const source = glob.replace(/\\/g, "/");
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "*") {
      if (source[index + 1] === "*") {
        index += 1;
        if (source[index + 1] === "/") {
          index += 1;
          output += "(?:.+/)?";
        } else if (source[index + 1] === undefined) {
          output += ".*";
        } else {
          output += "(?:[^/]+/)*[^/]*";
        }
      } else {
        output += "[^/]*";
      }
    } else if (char === "?") {
      output += "[^/]";
    } else if (".+^${}()|[]\\".includes(char)) {
      output += `\\${char}`;
    } else {
      output += char;
    }
  }
  cached = new RegExp(`^${output}$`, "i");
  // H4: eviction — drop oldest entry when cache is full
  if (_globCache.size >= GLOB_CACHE_MAX) {
    const firstKey = _globCache.keys().next().value;
    if (firstKey !== undefined) _globCache.delete(firstKey);
  }
  _globCache.set(glob, cached);
  return cached;
}

// C3: nested quantifiers — (a+)+, (x*)*, (a+)? — are the classic ReDoS shape.
// try/catch stops syntax errors but cannot stop catastrophic backtracking,
// so reject the shape before compiling.
const UNSAFE_NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)[+*?]/;

export function isSafeRegexPattern(pattern: string): boolean {
  return !UNSAFE_NESTED_QUANTIFIER.test(pattern);
}

// M3: cache compiled regex patterns to avoid recompilation on every gate check
const _regexCache = new Map<string, RegExp>();
const REGEX_CACHE_MAX = 256;

export function contentSatisfies(content: string, patterns: string[]): boolean {
  if (content.length === 0) return false;
  return patterns.some((pattern) => {
    if (pattern === "prose") return hasProse(content);
    if (pattern === "style") return hasStyle(content);
    if (pattern.length > 1000) return false;
    if (!isSafeRegexPattern(pattern)) return false;
    try {
      let re = _regexCache.get(pattern);
      if (re) {
        // M4: LRU-style — move accessed entry to end (newest) so hot entries stay
        _regexCache.delete(pattern);
        _regexCache.set(pattern, re);
      } else {
        // M-Gate: eviction — drop oldest entry when cache is full
        if (_regexCache.size >= REGEX_CACHE_MAX) {
          const firstKey = _regexCache.keys().next().value;
          if (firstKey !== undefined) _regexCache.delete(firstKey);
        }
        re = new RegExp(pattern, "i");
        _regexCache.set(pattern, re);
      }
      return re.test(content);
    } catch {
      // H1: fail-closed — propagate the error so the caller can decide.
      // For contentMatches this blocks the edit; for contentExcludes the
      // caller catches and treats it as "exclude matched" (also blocking).
      throw new Error(`regex error in pattern: ${pattern.slice(0, 80)}`);
    }
  });
}

function selectorMatches(rule: Rule, classification: FileClass, path: string, categories: string[]): boolean {
  const when = rule.when;
  const checks: boolean[] = [];
  if (when.fileClasses && when.fileClasses.length > 0) checks.push(when.fileClasses.includes(classification));
  if (when.pathGlobs && when.pathGlobs.length > 0) checks.push(when.pathGlobs.some((glob) => globToRegExp(glob).test(path)));
  if (when.promptCategories && when.promptCategories.length > 0) {
    checks.push(when.promptCategories.some((category) => categories.includes(category)));
  }
  // M1: a rule with no selectors must match nothing, not everything.
  // An empty `when` is a misconfiguration — fail closed, not open.
  if (checks.length === 0) {
    console.error(`[Novahiz] rule "${rule.id}" has empty selectors — it will never match`);
    return false;
  }
  // Default to "all" — all selectors must match. This is the safe default:
  // a rule with fileClasses + promptCategories requires BOTH to match.
  return when.match === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

// C3: files whose content defines what the gate requires. They live under
// build/ but must never be treated as ignored build output.
const PROTECTED_INDEX_SUFFIXES = ["/build/installed-skills.json", "/build/catalog.json"];

function isProtectedIndexPath(path: string): boolean {
  return PROTECTED_INDEX_SUFFIXES.some((suffix) => path === suffix.slice(1) || path.endsWith(suffix));
}
type GateInput = {
  tool: string;
  filePath: string;
  content?: string;
  /** C1: user prompt that triggered the edit. The complexity tier is
   * computed from it when present — the edited content alone under-reports
   * how much pipeline a short edit of a complex request needs. */
  prompt?: string;
  categories?: string[];
  loadedSkills?: string[];
  installedSkills?: ReadonlySet<string> | null;
  installedIndexAvailable?: boolean;
  tier?: ComplexityTier;
  spec: Spec;
};

type GateResult = {
  allow: boolean;
  ignored: boolean;
  fileClass: FileClass;
  roadmap: string | null;
  tier: ComplexityTier;
  requiredSkills: string[];
  missingSkills: string[];
  unmatchedRequired: string[];
  matchedRules: string[];
  indexMissing: boolean;
  placeholder: boolean;
  reasons: string[];
};

export function evaluateGate(input: GateInput): GateResult {
  const classification = fileClass(input.filePath);
  const categories = input.categories ?? [];
  const path = input.filePath.replace(/\\/g, "/");
  const content = input.content ?? "";

  try {
    // C3: the skill index lives under build/ (matched by the default
    // **/build/** ignore glob). Editing it must never bypass the gate —
    // dropping a skill from the index would silently un-require it.
    const ignored =
      !isProtectedIndexPath(path) &&
      input.spec.config.gate.ignoreFiles.some((glob) => globToRegExp(glob).test(path));
    if (ignored) {
      return {
        allow: true,
        ignored: true,
        fileClass: classification,
        roadmap: null,
        tier: "trivial",
        requiredSkills: [],
        missingSkills: [],
        unmatchedRequired: [],
        matchedRules: [],
        indexMissing: false,
        placeholder: false,
        reasons: []
      };
    }

    // H3: Determine complexity tier BEFORE rule evaluation so that trivial
    // prompts can skip Novahiz-specific rules entirely.
    // C1: compute the tier from the user prompt when available; content is
    // only a fallback for callers that do not carry a prompt (probes).
    const prompt = (input.prompt ?? "").trim();
    const tier = input.tier ?? determineTier(prompt.length > 0 ? prompt : content);

    const requiredSkills: string[] = [];
    const matchedRules: string[] = [];

    for (const rule of input.spec.rules) {
      if (!selectorMatches(rule, classification, path, categories)) continue;
      // Tier gating for R6-Novahiz: trivial = skip entirely, lite = only implement+converge
      if (rule.id === "R6-Novahiz") {
        if (tier === "trivial") continue;
        if (tier === "lite") {
          // Only add implement and converge from R6's require list
          for (const skill of rule.require) {
            if (skill === "novahiz-implement" || skill === "novahiz-converge") {
              if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
            }
          }
          matchedRules.push(rule.id);
          continue;
        }
      }
      if (rule.when.minChange && isTrivial(content, rule.when.minChange)) continue;
      // H1: contentSatisfies now throws on regex errors (fail-closed).
      // For contentExcludes: regex error → treat as "exclude matched" → skip rule.
      // For contentMatches: regex error → treat as "match succeeded" → apply rule.
      if (rule.when.contentExcludes) {
        try { if (contentSatisfies(content, rule.when.contentExcludes)) continue; } catch { continue; }
      }
      if (rule.when.contentMatches) {
        try { if (!contentSatisfies(content, rule.when.contentMatches)) continue; } catch { /* fail-closed: apply rule */ }
      }
      matchedRules.push(rule.id);
      for (const skill of rule.require) {
        if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
      }
    }

    const primary = categories[0];
    let roadmap: string | null = null;


    if (primary) {
      const category = input.spec.categories.find((entry) => entry.id === primary);
      if (category?.roadmap) {
        roadmap = category.roadmap.id;
        for (const step of category.roadmap.steps) {
          if (step.kind !== "skill" || step.optional) continue;

          // Tier-based filtering
          if (tier === "trivial") {
            // Trivial: no skills from roadmap
            continue;
          }
          if (tier === "lite") {
            // Lite: only implement + converge skills (skip plan, clarify, etc.)
            const allowed = (step.requireSkills ?? []).filter(
              s => s === "novahiz-implement" || s === "novahiz-converge"
            );
            if (allowed.length === 0) continue;
            for (const skill of allowed) {
              if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
            }
            continue;
          }

          for (const skill of step.requireSkills ?? []) {
            if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
          }
        }
      }
    }

    const installed = input.installedSkills ?? null;
    const indexAvailable = input.installedIndexAvailable !== false;
    const effective: string[] = [];
    const unmatchedRequired: string[] = [];
    for (const skill of requiredSkills) {
      if (indexAvailable && installed && !installed.has(skill)) unmatchedRequired.push(skill);
      else effective.push(skill);
    }

    const loaded = new Set(input.loadedSkills ?? []);
    const missingSkills = effective.filter((skill) => !loaded.has(skill));

    const placeholderEligible = input.spec.config.gate.placeholders && (classification === "code" || classification === "design");
    const placeholder = placeholderEligible && hasPlaceholder(content);

    const reasons: string[] = [];
    for (const skill of missingSkills) reasons.push(`missing skill: ${skill}`);
    // C3: an index gap must be visible, not silent. The skill is not enforced
    // (kept out of requiredSkills) — say so loudly so a sync gets triggered.
    for (const skill of unmatchedRequired) {
      reasons.push(`required skill not in index, not enforced: ${skill} — run "novahiz" sync to realign`);
    }
    if (placeholder) reasons.push("placeholder marker found in content");

    return {
      allow: missingSkills.length === 0 && !placeholder,
      ignored: false,
      fileClass: classification,
      roadmap,
      tier,
      requiredSkills: effective,
      missingSkills,
      unmatchedRequired,
      matchedRules,
      indexMissing: input.installedIndexAvailable === false,
      placeholder,
      reasons
    };
  } catch (error) {
    return {
      allow: false,
      ignored: false,
      fileClass: classification,
      roadmap: null,
      tier: "trivial",
      requiredSkills: [],
      missingSkills: [],
      unmatchedRequired: [],
      matchedRules: [],
      indexMissing: false,
      placeholder: false,
      reasons: [`gate error: ${String((error as Error)?.message ?? error)}`]
    };
  }
}

// Ledger + trace enforcement shared by the CLI gate command and the MCP
// novahiz_gate tool (audit P1-D/M1): same checks and the same log rows, so the
// two entry points cannot drift apart. Mutates results[].allow exactly like
// the original CLI block; returns aggregate reasons and the review warning.
export function enforceLedgerChecks(
  db: GateDb,
  input: {
    session: string;
    tool: string;
    paths: string[];
    categories: string[];
    results: (GateResult & { path: string })[];
    spec: Spec;
    gateConfig: Spec["config"]["gate"];
  }
): { reasons: string[]; reviewWarning: string } {
  const { session, tool, paths, categories, results, spec, gateConfig } = input;
  const reasons: string[] = [];
  let reviewWarning = "";

  const traceConfig = gateConfig.trace;
  const traceRequired =
    traceConfig?.enabled === true &&
    session.length > 0 &&
    categories.some((category) => traceConfig.categories.includes(category));
  if (traceRequired) {
    for (const entry of results) {
      const trace = traceCheck(db, { sessionId: session, filePath: entry.path, required: true });
      if (!trace.ok) {
        entry.allow = false;
        reasons.push(trace.reason);
      }
    }
  }

  const ledgerConfig = spec.config.ledger;
  if (ledgerConfig?.enabled !== false) {
    const task = activeTask(db, session || undefined);
    if (task) {
      if (["edit", "write", "patch", "apply_patch"].includes(tool)) recordEdit(db, task.id);
      // Targeted review: block only paths owned by an open todo with an owner
      // pattern. A due review no longer freezes every target.
      for (const entry of results) {
        const reason = reviewBlockReason(db, task.id, entry.path, ledgerConfig.review);
        if (reason && !entry.ignored) {
          entry.allow = false;
          entry.reasons.push(reason);
        }
      }
      if (results.some((entry) => entry.reasons.some((reason) => reason.startsWith("plan review due")))) {
        reasons.push(reviewDue(db, task.id, ledgerConfig.review).reason);
      } else if (reviewDue(db, task.id, ledgerConfig.review).due) {
        reviewWarning = reviewDue(db, task.id, ledgerConfig.review).reason;
      }
    }
  }

  const currentAllow = results.every((entry) => entry.allow);
  if (session.length > 0) {
    const missing = [...new Set(results.flatMap((entry) => entry.missingSkills))];
    db.prepare(
      "INSERT INTO enforcement_log (session_id, tool, file_path, file_class, decision, missing, matched_rules, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      session,
      tool,
      paths.join(","),
      results[0]?.fileClass ?? "other",
      currentAllow ? "allow" : gateConfig.mode === "block" ? "block" : gateConfig.mode,
      JSON.stringify(missing),
      JSON.stringify(results.flatMap((entry) => entry.matchedRules)),
      new Date().toISOString()
    );
    try {
      autoCommit("enforcement", `${currentAllow ? "allow" : "block"} ${tool}`);
    } catch {
      // autoCommit failures are non-critical; the enforcement is logged regardless
    }
  }

  return { reasons, reviewWarning };
}
