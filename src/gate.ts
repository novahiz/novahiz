import type { Rule, Spec } from "./spec.ts";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { hasPlaceholder, hasProse, hasStyle, isTrivial } from "./content.ts";
import { determineTier, liteKeeps, type ComplexityTier } from "./complexity.ts";
// Shared ledger enforcement (audit P1-D/M1): the CLI command and the MCP
// novahiz_gate tool both run these checks so their verdicts cannot diverge.
import { activeTask, ownedByOpenTodo, recordEdit, reviewBlockReason, reviewDue, traceCheck } from "./ledger.ts";
import { capture } from "./snap.ts";
import { claimedByAny, conflictingClaim, migrationCommand } from "./claims.ts";
import { sessionFamily } from "./lineage.ts";
import { activeSessionsOnProject, isProjectRoot, projectRootForPath } from "./sessions.ts";
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

export function fileClass(filePath: string | undefined): FileClass {
  // Pathless calls (M1/l.135) carry no target path. Deriving a class from
  // undefined must not throw before evaluateGate reaches its pathless branch:
  // "" already yielded "other", so the guard preserves every existing verdict.
  const normalized = (filePath ?? "").replace(/\\/g, "/");
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

// R16: "only in projects that carry X" cannot be expressed per file — the gate
// sees the edited path, not the repository. `when.projectGlobs` closes that gap:
// the globs are resolved from the project root (the nearest ancestor of the
// edited file holding .git, package.json or pubspec.yaml) and scanned from the
// glob's literal prefix, so a rule never walks node_modules.
const PROJECT_ROOT_MARKERS = [".git", "package.json", "pubspec.yaml"];
const PROJECT_SKIP_DIRS = new Set([".git", "node_modules"]);

export function projectRootOf(filePath: string): string | null {
  let dir = dirname(resolve(filePath || "."));
  for (;;) {
    if (PROJECT_ROOT_MARKERS.some((marker) => existsSync(join(dir, marker)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function listFilesUnder(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory: contributes nothing rather than throwing
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!PROJECT_SKIP_DIRS.has(entry.name)) listFilesUnder(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

export function projectGlobsMatch(root: string | null, globs: string[]): boolean {
  if (!root) {
    console.error("[Novahiz] projectGlobs: project root could not be resolved — the rule will not apply");
    return false;
  }
  for (const glob of globs) {
    const normalized = glob.replace(/\\/g, "/");
    // Scanning starts at the literal prefix: "stitch/**" only reads stitch/.
    // A glob whose prefix is pure wildcards cannot be scoped — fail closed on
    // that pattern (never matches) instead of walking the whole project.
    const literalPrefix = normalized.split(/[?*[\]]/, 1)[0].replace(/\/+$/, "");
    if (literalPrefix.length === 0) {
      console.error(`[Novahiz] projectGlobs "${glob}" must start with a literal segment — skipped`);
      continue;
    }
    const base = join(root, literalPrefix);
    const stats = statSync(base, { throwIfNoEntry: false });
    if (!stats) continue;
    const candidates: string[] = [];
    if (stats.isFile()) candidates.push(base);
    else listFilesUnder(base, candidates);
    const pattern = globToRegExp(normalized);
    for (const file of candidates) {
      const rel = relative(root, file).split("\\").join("/");
      if (pattern.test(rel)) return true;
    }
  }
  return false;
}

function selectorMatches(rule: Rule, classification: FileClass, path: string, categories: string[], pathless = false): boolean {
  const when = rule.when;
  const checks: boolean[] = [];
  if (pathless) {
    // MAJEUR l.135: with no target path, only prompt-scoped selectors can
    // apply. Path/file rules are skipped silently — there is no path to test
    // and the absence is not the misconfiguration M1 warns about.
    if (!when.promptCategories || when.promptCategories.length === 0) return false;
    checks.push(when.promptCategories.some((category) => categories.includes(category)));
  } else {
    // E1: pathExcludes is the negative counterpart of pathGlobs. A rule that
    // carries it never applies to an excluded path, whatever the other
    // selectors say — the only way to express "never on tests" when match is
    // "any", where a prompt category alone would otherwise fire on any file.
    /*
     * A design rule names a UI surface. On infrastructure code (.ts, .sql,
     * .json, .md) it must not fire at all, even when its path globs happen to
     * match a source directory such as app or components. Without this early
     * return, a large edit to an action file still demanded the wireframe
     * through the path selector. UI-capable sources keep matching.
     */
    const designRule = when.promptCategories?.includes("design-ui") ?? false;
    const uiPath = /\.(css|scss|sass|less|styl|html?|vue|svelte|astro|jsx|tsx|dart|swift|kt|kts)$/i.test(path);
    if (designRule && !uiPath) return false;

    if (
      when.pathExcludes &&
      when.pathExcludes.length > 0 &&
      when.pathExcludes.some((glob) => globToRegExp(glob).test(path))
    ) {
      return false;
    }
    /*
     * fileClasses is a scope guard, not an alternative selector. Under
     * `match: "any"`, a check that merely adds a candidate let a design rule
     * fire on a .ts file as soon as the prompt carried `design-ui` — exactly
     * the false positive that forced four design skills on a one-line comment.
     * A rule that names file classes never applies outside them.
     */
    if (when.fileClasses && when.fileClasses.length > 0) {
      if (!when.fileClasses.includes(classification)) return false;
    }
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
  }
  // Default to "all" — all selectors must match. This is the safe default:
  // a rule with fileClasses + promptCategories requires BOTH to match.
  return when.match === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

// C3: files whose content defines what the gate requires. They live under
// build/ but must never be treated as ignored build output.
const PROTECTED_INDEX_SUFFIXES = ["/build/installed-skills.json", "/build/catalog.json"];

/**
 * NX-52 : un fichier jetable hors projet ne déclenche pas le pipeline.
 *
 * Écrire une sonde dans le dossier temporaire de la machine n'est pas un
 * travail de projet : la classification venait du prompt, donc une sonde de
 * diagnostic héritait du pipeline d'évaluation (cinq skills) parce que la
 * demande parlait d'évaluation. Le chemin tranche ici : sous le dossier
 * temporaire du système, hors du projet, le fichier est traité comme ignoré.
 */
export function isTempPath(path: string): boolean {
  if (path.trim().length === 0) return false;
  const normaliser = (valeur: string): string => valeur.replace(/\\/g, "/").replace(/\/+$/, "");
  const temporaire = normaliser(resolve(tmpdir()));
  const absolu = normaliser(isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path));
  return absolu === temporaire || absolu.startsWith(`${temporaire}/`);
}

export function isProtectedIndexPath(path: string): boolean {
  // C3 must hold on Windows too. Gate receives paths carrying the platform
  // separator (`...\build\catalog.json`), and a suffix spelled with "/" never
  // matched there, so the guard silently never fired on the platform most of
  // the community installs on - exactly the files that define what the gate
  // requires. Compare on a forward-slash normalised copy instead of guessing
  // which separator the caller used.
  const normalised = path.replace(/\\/g, "/");
  return PROTECTED_INDEX_SUFFIXES.some(
    (suffix) => normalised === suffix.slice(1) || normalised.endsWith(suffix)
  );
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
  /** MAJEUR l.135: true when the caller has no target path (bash/shell/cron
   * with no detectable file). Only prompt-scoped selectors are evaluated;
   * path/file rules cannot match and are skipped without the M1 warning. */
  pathless?: boolean;
  spec: Spec;
};

export type GateResult = {
  allow: boolean;
  ignored: boolean;
  fileClass: FileClass;
  roadmap: string | null;
  tier: ComplexityTier;
  requiredSkills: string[];
  missingSkills: string[];
  unmatchedRequired: string[];
  presentButMissingOnDisk: string[];
  matchedRules: string[];
  indexMissing: boolean;
  placeholder: boolean;
  reasons: string[];
};

export function evaluateGate(input: GateInput): GateResult {
  const classification = fileClass(input.filePath);
  const categories = input.categories ?? [];
  // Pathless calls may carry no filePath at all; normalizing undefined to ""
  // reproduces exactly what src/commands/gate.ts:173 passes explicitly.
  const path = (input.filePath ?? "").replace(/\\/g, "/");
  const content = input.content ?? "";
  // MAJEUR l.135: a pathless call (bash/shell/cron without a target) evaluates
  // prompt-scoped rules only and never consults path-based ignore globs.
  const pathless = input.pathless === true;

  try {
    // C3: the skill index lives under build/ (matched by the default
    // **/build/** ignore glob). Editing it must never bypass the gate —
    // dropping a skill from the index would silently un-require it.
    const ignored =
      !pathless &&
      (isTempPath(path) ||
        (!isProtectedIndexPath(path) &&
          input.spec.config.gate.ignoreFiles.some((glob) => globToRegExp(glob).test(path))));
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
        presentButMissingOnDisk: [],
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
    // A missing prompt must not silently disarm enforcement: callers that
    // already name a category (MCP gate, resumed session) are treated as a
    // full task when neither prompt nor content can set the tier. Without
    // this, `{categories:["audit"]}` with no prompt fell back to trivial and
    // skipped the whole roadmap — a fail-open on the MCP path.
    const seed = prompt.length > 0 ? prompt : content;
    const declaredTier = input.tier ?? (seed.length > 0 ? determineTier(seed) : categories.length > 0 ? "full" : "trivial");
    /*
     * Adapt the pipeline to the work in front of it, not only to the wording
     * of the request. A full-tier prompt that edits 300 characters is a
     * focused change: the planning steps were decided when the task was
     * opened, and replaying them on every small edit is what made a one-line
     * fix demand plan, clarify and tasks. Small edits fall to lite; domain
     * checks (implement, converge, security) stay because liteKeeps keeps
     * them. An explicitly passed tier is never downgraded.
     */
    const smallEdit = !pathless && content.trim().length > 0 && content.trim().length < 800;
    const tier = input.tier ? declaredTier : declaredTier === "full" && smallEdit ? "lite" : declaredTier;

    // P0.1: `novahiz doctor --force-readonly` est un diagnostic de secours qui
    // doit pouvoir s'exécuter même quand aucune skill n'est chargée et que le
    // gate est verrouillé. On court-circuite toute évaluation de règle et de
    // roadmap pour cette commande spécifique.
    if ((input.tool === "shell" || input.tool === "bash")) {
      const command = content.trim();
      if (/^novahiz\s+doctor\b/.test(command) && /\b--force-readonly\b/.test(command)) {
        return {
          allow: true,
          ignored: false,
          fileClass: classification,
          roadmap: null,
          tier,
          requiredSkills: [],
          missingSkills: [],
          unmatchedRequired: [],
          presentButMissingOnDisk: [],
          matchedRules: [],
          indexMissing: false,
          placeholder: false,
          reasons: ["novahiz doctor --force-readonly: gate bypassé pour diagnostic de secours"]
        };
      }
    }

    const requiredSkills: string[] = [];
    const matchedRules: string[] = [];
    // Resolved lazily: only a rule carrying projectGlobs pays for the walk up to
    // the project root (and the result is reused by every following rule).
    let projectRoot: string | null | undefined;

    for (const rule of input.spec.rules) {
      // Cheap-first (audit 2026-10-14): an O(1) guard runs before the glob
      // selectors and the content regexes. Every guard here is an AND-only
      // `continue`, so their relative order is not observable in the verdict —
      // the only effect is that a rule dropped at this line never pays for a
      // path walk or a content evaluation.
      if (rule.when.tiers && rule.when.tiers.length > 0 && !rule.when.tiers.includes(tier)) continue;
      // An absent tool means "unknown", not "none". Skipping on undefined would
      // silently disarm the rule for every caller that omits it (a fail-open).
      // Keeping it armed can only cost tokens, never enforcement.
      if (
        rule.when.tools &&
        rule.when.tools.length > 0 &&
        input.tool !== undefined &&
        !rule.when.tools.includes(input.tool)
      ) continue;
      if (!selectorMatches(rule, classification, path, categories, pathless)) continue;
      if (rule.when.projectGlobs && rule.when.projectGlobs.length > 0) {
        // Pathless probes carry no file: there is no repository to inspect, so
        // an unprovable project condition never grants the rule (fail closed).
        if (pathless) continue;
        if (projectRoot === undefined) projectRoot = projectRootOf(path);
        if (!projectGlobsMatch(projectRoot, rule.when.projectGlobs)) continue;
      }
      // Tier gating for roadmap steps lives in the roadmap loop below; no rule
      // carries the pipeline any more (R6 was removed), so a rule's require
      // list is applied as written once its selectors match.
      if (rule.when.minChange && isTrivial(content, rule.when.minChange)) continue;
      // H1: contentSatisfies now throws on regex errors (fail-closed).
      // For contentExcludes: regex error → treat as "exclude matched" → skip rule.
      // For contentMatches: regex error → treat as "match succeeded" → apply rule.
      if (rule.when.contentExcludes) {
        try {
          if (contentSatisfies(content, rule.when.contentExcludes)) continue;
        } catch {
          // MINEUR#1: an invalid exclude pattern must never disable the rule
          // (the old `continue` was a silent fail-open). Fail closed instead:
          // apply the rule and surface the catalogue bug on stderr.
          console.error(`[Novahiz] rule "${rule.id}": invalid contentExcludes pattern — applying the rule anyway`);
        }
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

    /*
     * A design roadmap carries skills that only make sense on a design file.
     * When the target is ordinary code (a .ts action, a shell component, a
     * comment in navigation.ts), those skills stop applying: the category came
     * from the session, not from the file. This is the defect that demanded
     * four design skills for a one-line comment. The work-structuring skills
     * (implement, converge) stay; security and database skills stay too.
     */
    const DESIGN_ONLY_SKILLS = new Set([
      "novahiz-wireframe",
      "design-token-pipeline",
      "novahiz-humanizer",
      "ui-slop-remover",
      "ui-craft-rules",
      "impeccable",
      "novahiz-wcag-audit",
    ]);
    const designSkillApplies = (skill: string) => {
      if (classification === "design") return true;
      const uiSource = /\.(tsx|jsx|vue|svelte|astro|dart|swift|kt|kts)$/i.test(path);
      return uiSource || !DESIGN_ONLY_SKILLS.has(skill);
    };

    if (primary) {
      const category = input.spec.categories.find((entry) => entry.id === primary);
      if (category?.roadmap) {
        roadmap = category.roadmap.id;
        for (const step of category.roadmap.steps) {
          // Enforce every non-optional step, not only `kind: "skill"`:
          // `edit:implement` and `verify:converge` are where the lite and
          // Flutter/debug roadmaps put novahiz-implement / novahiz-converge.
          // Skipping them made the roadmap demand nothing for those tiers while
          // classify advertised nothing either — a silent fail-open.
          if (step.optional) continue;

          // Tier-based filtering
          if (tier === "trivial") {
            // Trivial: no skills from roadmap
            continue;
          }
          if (tier === "lite") {
            // Lite skips the skills that only structure the work (plan,
            // clarify, task, analyse) but keeps every domain skill the full
            // tier would enforce. Hardcoding implement/converge made a lite
            // design change drop wireframe, design craft and the impeccable
            // checks — the "lite erases the roadmap" defect.
            const allowed = (step.requireSkills ?? []).filter(liteKeeps).filter(designSkillApplies);
            if (allowed.length === 0) continue;
            for (const skill of allowed) {
              if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
            }
            continue;
          }

          for (const skill of step.requireSkills ?? []) {
            if (!designSkillApplies(skill)) continue;
            if (!requiredSkills.includes(skill)) requiredSkills.push(skill);
          }
        }
      }
    }

    const installed = input.installedSkills ?? null;
    const indexAvailable = input.installedIndexAvailable !== false;
    const effective: string[] = [];
    const unmatchedRequired: string[] = [];
    const presentButMissingOnDisk: string[] = [];
    for (const skill of requiredSkills) {
      // Compétence absente de l'index : non exigée, mais signalée pour un sync.
      // Quand l'index est lisible mais que le jeu installé est inconnu (null),
      // on enforce tout par défaut (comportement historique).
      if (indexAvailable && installed && !installed.has(skill)) {
        unmatchedRequired.push(skill);
        continue;
      }
      if (!indexAvailable) {
        // Index illisible : on ne peut pas vérifier l'installation, donc on ne
        // peut pas non plus déclarer la compétence absente. Fail closed : la
        // compétence reste exigée. Avant, elle sortait de `effective` et le
        // gate répondait allow:true en prétendant « all required skills are
        // enforced » — un gate qui s'ouvre quand son propre index est cassé.
        effective.push(skill);
        continue;
      }
      // Compétence dans l'index. On vérifie que son fichier source existe encore
      // sur disque sous l'un des skillRoots (détection "dans l'index mais absent du disque").
      if (installed) {
        let foundOnDisk = false;
        for (const root of input.spec.config.skillRoots) {
          const expanded = root.startsWith("~") ? join(homedir(), root.slice(2)) : root;
          const absRoot = isAbsolute(expanded) ? expanded : join(input.spec.root, expanded);
          const candidate = join(absRoot, skill, "SKILL.md");
          if (existsSync(candidate)) {
            foundOnDisk = true;
            break;
          }
        }
        if (!foundOnDisk) {
          presentButMissingOnDisk.push(skill);
          continue;
        }
      }
      effective.push(skill);
    }

    const loaded = new Set(input.loadedSkills ?? []);
    // P1.3: si une skill requise est manquante mais que son CLI est présent dans
    // node_modules/.bin, on n'en fait pas une compétence bloquante — on émet un
    // warning à la place. Ceci évite de paralyser l'agent quand impeccable (ou
    // une autre skill avec binaire) est référencée par le catalogue mais non
    // installée dans le projet.
    const cliBySkill: Record<string, string> = {
      impeccable: "impeccable"
    };
    const cliWarnings: string[] = [];
    const missingSkills: string[] = [];
    for (const skill of effective) {
      if (loaded.has(skill)) continue;
      const cliName = cliBySkill[skill] ?? skill;
      const cliPath = join(input.spec.root, "node_modules", ".bin", cliName);
      if (existsSync(cliPath)) {
        cliWarnings.push(`skill ${skill} manquante mais CLI présent dans node_modules/.bin — warning seulement`);
        continue;
      }
      missingSkills.push(skill);
    }

    const placeholderEligible = input.spec.config.gate.placeholders && (classification === "code" || classification === "design");
    const placeholder = placeholderEligible && hasPlaceholder(content);

    const reasons: string[] = [];
    reasons.push(...cliWarnings);
    // P8 (2026-10-14): `rule.description` was declared in spec.ts and read by
    // nobody — metadata that never reached the model, so a block only ever said
    // WHAT to load, never why. On a block the owning rule's text is now surfaced
    // as an instruction behind each missing skill. Two cost rules hold the line:
    // the block is built only when something is actually missing (an allow path
    // constructs none of it), and one rule owning several skills is spelled out
    // once — later skills carry its id alone.
    if (missingSkills.length > 0) {
      const spelledOut = new Set<string>();
      for (const skill of missingSkills) {
        const owners = input.spec.rules.filter((rule) => rule.require.includes(skill));
        const why =
          owners.length === 0
            ? "required by the active category roadmap"
            : owners
                .map((rule) => {
                  if (spelledOut.has(rule.id)) return rule.id;
                  spelledOut.add(rule.id);
                  return `${rule.id}: ${rule.description}`;
                })
                .join("; ");
        reasons.push(
          `missing skill: ${skill} — load it with skill({id: "${skill}"}). ${why}`
        );
      }
    }
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
      presentButMissingOnDisk,
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
      presentButMissingOnDisk: [],
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
/**
 * Fusionne les raisons par cible dans le message court.
 *
 * `evaluateGate` remplit `reasons` par cible, et le CLI ne publiait que les
 * raisons globales : le message de blocage disait quoi charger, jamais quel
 * fichier l'avait déclenché. Ici les raisons sont regroupées par texte, et le
 * chemin n'est ajouté que lorsqu'elles ne concernent pas toutes les cibles.
 *
 * Fonction pure : elle ne lit ni disque ni base, ce qui la rend testable.
 */
export function mergeTargetReasons(
  targets: readonly { path: string; reasons: readonly string[] }[],
  existing: readonly string[] = [],
): string[] {
  const result = [...existing];
  const seen = new Set(result);
  const pathBearing = targets.filter((target) => target.path.length > 0).length;
  const byReason = new Map<string, string[]>();

  for (const target of targets) {
    for (const reason of target.reasons) {
      if (seen.has(reason)) continue;
      const paths = byReason.get(reason) ?? [];
      if (target.path.length > 0 && !paths.includes(target.path)) paths.push(target.path);
      byReason.set(reason, paths);
    }
  }

  for (const [reason, paths] of byReason) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    const everywhere = pathBearing === 0 || paths.length >= pathBearing;
    result.push(everywhere || paths.length === 0 ? reason : `${reason} [${paths.join(", ")}]`);
  }

  return result;
}

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
    /** Texte de la commande pour un outil shell/bash (NX-42). */
    command?: string;
    /** Projet de la commande, quand l'appelant le connaît déjà. */
    projectRoot?: string | null;
  }
): { reasons: string[]; reviewWarning: string } {
  const { session, tool, paths, categories, results, spec, gateConfig, command, projectRoot } = input;
  const reasons: string[] = [];
  let reviewWarning = "";

  const traceConfig = gateConfig.trace;
  const traceRequired =
    traceConfig?.enabled === true &&
    session.length > 0 &&
    categories.some((category) => traceConfig.categories.includes(category));
  if (traceRequired) {
    for (const entry of results) {
      // MAJEUR l.135: a pathless entry (bash/shell/cron with no target) has
      // no file to trace — skip the per-path check, keep the log row below.
      if (entry.path.length === 0) continue;
      const trace = traceCheck(db, { sessionId: session, filePath: entry.path, required: true });
      if (!trace.ok) {
        entry.allow = false;
        reasons.push(trace.reason);
      }
    }
  }

  // Concurrence multi-session : un chemin réservé par une autre session vivante
  // est refusé. Sans cette vérification, deux sessions écrivent le même fichier
  // et personne ne le découvre avant le commit — vécu : 72 entrées sales
  // appartenant à une autre session dans le même worktree.
  // NX-43: the family is computed once. A parent and its delegated child are
  // one body of work: the child inherits the parent's claims, and neither is
  // treated as the other's competing session.
  const famille = session.length > 0 ? sessionFamily(db, session) : new Set<string>();
  if (session.length > 0) {
    for (const entry of results) {
      if (entry.path.length === 0) continue;
      const claim = conflictingClaim(db, { session, filePath: entry.path, family: famille });
      if (claim) {
        entry.allow = false;
        const detail = claim.reason ? ` (${claim.reason})` : "";
        const reason =
          `path claimed by session ${claim.session_id} until ${claim.expires_at}${detail}. ` +
          `Release it with novahiz_claim action=release, or work in a separate worktree.`;
        entry.reasons.push(reason);
        reasons.push(reason);
        continue;
      }
      /*
       * NX-41: opt-in claim requirement, off by default. When on, an edit on a
       * path this session has not claimed is refused as soon as another
       * session is live on the same project. The claim is what makes two
       * agents in one worktree visible to each other before the conflict
       * instead of after it.
       */
      if (gateConfig.claims?.required === true) {
        const projectRoot = projectRootForPath(entry.path);
        const autres = activeSessionsOnProject(db, { projectRoot, excludeSession: session }).filter(
          (autre) => !famille.has(autre.session),
        );
        if (autres.length > 0 && !claimedByAny(db, { sessions: famille, filePath: entry.path })) {
          entry.allow = false;
          const reason =
            `path not claimed while ${autres.length} other session(s) are live on this project ` +
            `(${autres.map((autre) => autre.session).join(", ")}). ` +
            `Claim it with novahiz_claim action=claim path=${entry.path}, or work in a separate worktree.`;
          entry.reasons.push(reason);
          reasons.push(reason);
        }
      }
    }
  }

  /*
   * NX-42 : la moitié destructive d'une migration est la commande, pas le
   * fichier. `supabase db push` ne porte aucun chemin, donc le contrôle de
   * claim ci-dessus ne le voit jamais. Quand les claims sont requis, une
   * commande de migration exige un claim vivant sur le dossier des migrations.
   */
  if (
    gateConfig.claims?.required === true &&
    session.length > 0 &&
    (tool === "shell" || tool === "bash") &&
    typeof command === "string" &&
    command.trim().length > 0 &&
    migrationCommand(command)
  ) {
    const racine = projectRoot ?? (isProjectRoot(process.cwd()) ? process.cwd() : null);
    if (racine) {
      const dossier = join(racine, "supabase", "migrations");
      const autres = activeSessionsOnProject(db, { projectRoot: racine, excludeSession: session }).filter(
        (autre) => !famille.has(autre.session),
      );
      // Une session seule ne paie pas l'étape : le verrou n'a de sens que si
      // une autre session peut appliquer la même migration.
      if (autres.length > 0 && !claimedByAny(db, { sessions: famille, filePath: dossier })) {
        const reason =
          `migration command not claimed (${command.trim().slice(0, 80)}). ` +
          `Claim the migrations directory first: novahiz_claim action=claim path=${dossier}.`;
        reasons.push(reason);
        for (const entry of results) {
          entry.allow = false;
          entry.reasons.push(reason);
        }
      }
    }
  }

  const ledgerConfig = spec.config.ledger;
  if (ledgerConfig?.enabled !== false) {
    const task = activeTask(db, session || undefined);
    if (task) {
      // F: a task bound to a project only ever owns paths inside that project —
      // another project's edits never advance or block it. Legacy tasks without
      // project_root keep the owner-only behaviour. Relative paths resolve
      // against the caller's cwd; absolute paths (plugin flow) stand as-is.
      const inProject = (filePath: string): boolean => {
        if (!task.project_root) return true;
        const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(process.cwd(), filePath);
        const rel = relative(task.project_root, abs);
        return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
      };
      // Cadence counts only edits an open todo actually owns (owner-scoped
      // review): a session or project touching unrelated paths must never
      // advance this plan toward its review block.
      const ownedTarget = results.some(
        (entry) => entry.path.length > 0 && inProject(entry.path) && ownedByOpenTodo(db, task.id, entry.path)
      );
      if (["edit", "write", "patch", "apply_patch"].includes(tool) && ownedTarget) recordEdit(db, task.id);
      // Targeted review: block only paths owned by an open todo with an owner
      // pattern. A due review no longer freezes every target.
      for (const entry of results) {
        // MAJEUR l.135: no path means no todo owner can claim it — a
        // pathless command must not be blocked by a file-ownership check.
        if (entry.path.length === 0) continue;
        // F: outside the task's project nothing in this ledger applies to it.
        if (!inProject(entry.path)) continue;
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
      capture(db, "enforcement", `${currentAllow ? "allow" : "block"} ${tool}`);
    } catch {
      // capture failures are non-critical; the enforcement is logged regardless
    }
  }

  return { reasons, reviewWarning };
}
