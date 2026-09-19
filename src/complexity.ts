/**
 * Task complexity scorer — multi-dimension analysis.
 *
 * Uses 6 weighted dimensions inspired by NVIDIA's Prompt Task & Complexity
 * Classifier and MICE (Multiple Independent Classifiers Ensemble):
 *
 *   1. Technical Depth (0.25) — code/domain terms, API references
 *   2. Reasoning Depth (0.25) — analysis, comparison, evaluation, proof
 *   3. Scope & Scale (0.20) — multi-file, codebase-wide, cross-cutting
 *   4. Constraints (0.15) — requirements, dependencies, constraints count
 *   5. Domain Specificity (0.10) — security, payments, database, design
 *   6. Action Verb Intensity (0.05) — implement vs fix vs rename
 *
 * Three tiers:
 *   - trivial: typo fixes, comments, config changes → no pipeline
 *   - lite: bug fixes, minor additions → implement + converge only
 *   - full: features, refactors, audits → complete 6-step pipeline
 */

export type ComplexityTier = "trivial" | "lite" | "full";

export type DimensionScores = {
  technicalDepth: number;
  reasoningDepth: number;
  scopeScale: number;
  constraints: number;
  domainSpecificity: number;
  actionIntensity: { lite: number; full: number };
};

type DimensionSignals = {
  technicalDepth: RegExp[];
  reasoningDepth: RegExp[];
  scopeScale: RegExp[];
  constraints: RegExp[];
  domainSpecificity: RegExp[];
  actionIntensity: { pattern: RegExp; lite: number; full: number }[];
};

// ── Signal banks by dimension ──────────────────────────────────────────────

const SIGNALS: DimensionSignals = {
  technicalDepth: [
    // Architecture & patterns
    /\b(refactor|architecture|design\s*system|restructure|migrate|migration)\b/i,
    /\b(microservice|monolith|scaling|horizontal|vertical\s*scal)\b/i,
    /\b(ci\/cd|pipeline|deployment|infrastructure|terraform|kubernetes|docker)\b/i,
    // API & protocols
    /\b(api\s*design|rest\s*api|graphql|grpc|openapi|swagger|webhook|endpoint)\b/i,
    /\b(websocket|socket\.io|server[\s-]?sent|event[\s-]?source|long[\s-]?polling)\b/i,
    // Real-time & streaming
    /\b(real[\s-]?time|streaming|live[\s-]?data|push[\s-]?notif|event[\s-]?driven)\b/i,
    // Data structures & algorithms
    /\b(algorithm|data\s*structure|tree|graph|hash|queue|stack|linked\s*list)\b/i,
    // State management & patterns
    /\b(state\s*management|redux|vuex|zustand|recoil|signal|observable|stream)\b/i,
    // Build & tooling
    /\b(webpack|vite|rollup|esbuild|babel|typescript\s*config|tsconfig)\b/i,
    /\b(package[\s-]?json|dependency|dependency[\s-]?tree|transitive)\b/i,
    // Memory & performance
    /\b(memory\s*leak|performance|optimization|profiling|latency|throughput|bottleneck)\b/i,
    // Concurrency
    /\b(concurrent|parallel|race[\s-]?condition|deadlock|thread|async|await|mutex|semaphore)\b/i,
    // Caching
    /\b(cache|caching|redis|memcached|invalidation|ttl|eviction)\b/i,
  ],

  reasoningDepth: [
    // Analysis verbs
    /\b(analyze|analyse|investigate|explore|audit|review|inspect|examine|diagnose)\b/i,
    // Comparison & evaluation
    /\b(compare|evaluate|assess|benchmark|trade[\s-]?offs?|pros?\s*(and|&)\s*cons?)\b/i,
    // Proof & verification
    /\b(prove|verify|validate|confirm|demonstrate|show\s*that|argue)\b/i,
    // Logical reasoning
    /\b(deduce|infer|conclude|reason|logic|therefore|thus|hence)\b/i,
    // Synthesis
    /\b(synthesize|integrate|combine|merge|consolidate|unify)\b/i,
    // Design thinking
    /\b(design|architect|plan|strategize|prioritize|decompose|break\s*down)\b/i,
    // Optimization reasoning
    /\b(optimize|simplify|streamline|refactor|improve|enhance|elevate)\b/i,
    // Multi-step reasoning
    /\b(step[\s-]?by[\s-]?step|progressive|iterative|incremental|gradual)\b/i,
  ],

  scopeScale: [
    // Cross-file scope
    /\b(across|entire|all\s*files|multiple\s*files|codebase|project[\s-]?wide)\b/i,
    /\b(full[\s-]?stack|end[\s-]?to[\s-]?end|e2e|top[\s-]?to[\s-]?bottom)\b/i,
    // Setup & scaffolding
    /\b(setup|scaffold|initialize|bootstrap|new\s*project|from\s*scratch)\b/i,
    // Multi-component
    /\b(components?|modules?|services?|layers?|tiers?|packages?)\s*(and|&|\+)\s*(components?|modules?|services?|layers?|tiers?|packages?)/i,
    // Migration scope
    /\b(migrate|upgrade|transition|convert|transform)\s+(all|every|entire|the\s*whole|from\s*\w+\s*to)\b/i,
    // System-wide
    /\b(system[\s-]?wide|globally|throughout|everywhere|universally)\b/i,
    // Multi-step tasks
    /\b(implement\s+a\s+(full|complete|comprehensive|new)|build\s+a\s+(full|complete|new))\b/i,
  ],

  constraints: [
    // Explicit requirements
    /\b(must|shall|required|mandatory|obligatory|necessary|essential)\b/i,
    // Compatibility
    /\b(compatible|backward|forward|cross[\s-]?browser|cross[\s-]?platform|support\s+(for|all|both|multiple))\b/i,
    // Dependencies
    /\b(depend|prerequisite|require|depends?\s*on|rely\s*on|reliance)\b/i,
    // Security constraints
    /\b(secure|security|encrypt|decrypt|auth|permission|access[\s-]?control|role[\s-]?based)\b/i,
    // Performance constraints
    /\b(performance|fast|slow|latency|timeout|throttle|rate[\s-]?limit|budget)\b/i,
    // Compliance
    /\b(compliant|compliance|regulate|gdpr|hipaa|soc\s*2|pci[\s-]?dss|owasp)\b/i,
    // Time constraints
    /\b(deadline|urgent|asap|quickly|immediate|soon|today|now)\b/i,
    // Quality constraints
    /\b(test|coverage|lint|clean|robust|resilient|fault[\s-]?tolerant|graceful)\b/i,
  ],

  domainSpecificity: [
    // Security domain
    /\b(security|vulnerability|owasp|cwe|xss|csrf|injection|sqli|penetration)\b/i,
    // Payments domain
    /\b(payment|stripe|checkout|subscription|billing|invoice|payment[\s-]?gateway)\b/i,
    // Database domain
    /\b(schema|table|column|index|foreign[\s-]?key|constraint|trigger|migration|supabase|postgres)\b/i,
    // Auth domain
    /\b(auth|authentication|authorization|oauth|jwt|session|token|login|signup)\b/i,
    // Real-time domain
    /\b(real[\s-]?time|streaming|queue|worker|cron|scheduled|pub[\s-]?sub)\b/i,
    // Design domain
    /\b(ui|ux|interface|landing[\s-]?page|mockup|wireframe|layout|responsive|a11y|animation)\b/i,
    // Infrastructure domain
    /\b(ci\/cd|pipeline|deployment|infrastructure|terraform|kubernetes|docker|cloud)\b/i,
    // AI/ML domain
    /\b(machine[\s-]?learning|ml|ai|neural|model|training|inference|embedding|vector)\b/i,
    // Testing domain
    /\b(test[\s-]?suite|integration[\s-]?test|e2e|end[\s-]?to[\s-]?end|coverage|mock|stub)\b/i,
  ],

  actionIntensity: [
    // Full-tier actions (complex verbs)
    { pattern: /\b(implement|build|create|design|architect|scaffold|bootstrap)\b/i, lite: 0, full: 3 },
    { pattern: /\b(refactor|rewrite|restructure|reorganize|migrate|convert)\b/i, lite: 0, full: 3 },
    { pattern: /\b(audit|security\s*review|pentest|penetration\s*test)\b/i, lite: 0, full: 3 },
    { pattern: /\b(deploy|release|ship|launch|publish)\b/i, lite: 1, full: 1 },
    // Lite-tier actions (repair verbs)
    { pattern: /\b(fix|repair|patch|resolve|debug|diagnose)\b/i, lite: 2, full: 0 },
    { pattern: /\b(update|upgrade|bump|change|modify|edit|adjust)\b/i, lite: 2, full: 0 },
    { pattern: /\b(add|remove|delete|write|rename|relabel|reword|rephrase|optimize|simplify)\b/i, lite: 2, full: 0 },
    // Trivial-tier actions (simple verbs)
    { pattern: /\b(comment|document|annotate|explain)\b/i, lite: 0, full: 0 },
    { pattern: /\b(typo|spelling|misspell|correct\s*the)\b/i, lite: 0, full: 0 },
  ],
};

// ── Trivial signals (override to trivial) ──────────────────────────────────

const TRIVIAL_OVERRIDE: RegExp[] = [
  // Explicit typo/fix commands
  /\b(fix\s+the\s+typo|correct\s+the\s+spelling|change\s+\w+\s+to\s+\w+)\b/i,
  // Single-word commands
  /^(rename|set|update|add|remove|delete|toggle|enable|disable)\s+\w+$/i,
  // Config-only changes — NOT trivial: changing config is a real action
  // /\b(update\s+the\s+config|change\s+the\s+setting|bump\s+the\s+version)\b/i,
  // Comment-only — NOT trivial: "add a comment" is a real action
  // /\b(add\s+a\s+comment|document\s+the|add\s+docstring)\b/i,
];

// ── Scoring functions ──────────────────────────────────────────────────────

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    // Reset lastIndex to avoid stateful test() issues with global flag
    p.lastIndex = 0;
    if (p.test(text)) count++;
  }
  return count;
}

function scoreActionIntensity(text: string): { lite: number; full: number } {
  let lite = 0;
  let full = 0;
  for (const { pattern, lite: l, full: f } of SIGNALS.actionIntensity) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      lite += l;
      full += f;
    }
  }
  return { lite, full };
}

function countConstraints(text: string): number {
  let count = 0;
  for (const p of SIGNALS.constraints) {
    // Reset lastIndex before test
    p.lastIndex = 0;
    if (p.test(text)) count++;
  }
  return count;
}

// ── Main scoring ───────────────────────────────────────────────────────────

export function scoreDimensions(prompt: string): DimensionScores {
  const text = prompt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const technicalDepth = countMatches(text, SIGNALS.technicalDepth);
  const reasoningDepth = countMatches(text, SIGNALS.reasoningDepth);
  const scopeScale = countMatches(text, SIGNALS.scopeScale);
  const constraints = countConstraints(text);
  const domainSpecificity = countMatches(text, SIGNALS.domainSpecificity);
  const action = scoreActionIntensity(text);

  // Normalize constraint count (cap at 5 for scoring purposes)
  const normalizedConstraints = Math.min(constraints, 5);

  return {
    technicalDepth,
    reasoningDepth,
    scopeScale,
    constraints: normalizedConstraints,
    domainSpecificity,
    actionIntensity: { lite: action.lite, full: action.full },
  };
}

/**
 * Compute complexity scores using additive model.
 * Each dimension match adds points. Higher total = more complex.
 */
function computeScores(dims: DimensionScores, wordCount: number): {
  full: number;
  lite: number;
  trivial: number;
} {
  // Full-tier score: sum of all dimension matches (each match = 1 point)
  // Plus action intensity bonus for creation/implementation verbs
  const full =
    dims.technicalDepth +
    dims.reasoningDepth +
    dims.scopeScale +
    dims.constraints +
    dims.domainSpecificity +
    dims.actionIntensity.full;

  // Lite-tier score: repair actions + low-complexity signals
  const lite =
    dims.actionIntensity.lite +
    dims.technicalDepth +
    dims.reasoningDepth +
    dims.domainSpecificity;

  // Trivial bonus: short prompts with no complexity signals
  const trivial = wordCount <= 5 ? 3 : wordCount <= 8 ? 1 : 0;

  return { full, lite, trivial };
}

/**
 * Score a prompt and determine its complexity tier.
 */
export function scoreComplexity(prompt: string): ComplexityTier {
  // Check trivial override first
  const normalized = prompt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const pattern of TRIVIAL_OVERRIDE) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) return "trivial";
  }

  const dims = scoreDimensions(prompt);
  const wordCount = prompt.trim().split(/\s+/).length;
  const { full, lite, trivial } = computeScores(dims, wordCount);

  // Decision logic:
  //   full >= 3 → definitely full
  //   full >= 2 → full (2+ dimension matches is substantial)
  //   dims.actionIntensity.full >= 2 && wordCount >= 5 → full (creation verb in a non-trivial prompt)
  //   full >= 1 && wordCount >= 12 → full (long prompt with at least 1 signal)
  //   dims.actionIntensity.lite >= 2 && wordCount >= 3 → lite (repair verb in a non-trivial prompt)
  //   trivial >= 3 && full < 2 → trivial (short, no complexity, no repair verb)
  //   lite >= 2 && full < 2 → lite
  //   default: use length heuristic
  if (full >= 3) return "full";
  if (full >= 2) return "full";
  if (dims.actionIntensity.full >= 2 && wordCount >= 5) return "full";
  if (full >= 1 && wordCount >= 12) return "full";
  if (dims.actionIntensity.lite >= 2 && wordCount >= 3) return "lite";
  if (trivial >= 3 && full < 2) return "trivial";
  if (lite >= 2 && full < 2) return "lite";

  // Default by length — high threshold prevents false full-tier on long prose
  if (wordCount <= 8) return "trivial";
  if (wordCount <= 40) return "lite";
  return "full";
}

/**
 * Determine the complexity tier based on prompt analysis.
 * Main entry point for the complexity system.
 */
export function determineTier(prompt: string): ComplexityTier {
  // C2: guard against null/undefined — treat as trivial instead of crashing
  if (!prompt || typeof prompt !== "string") return "trivial";
  return scoreComplexity(prompt);
}
