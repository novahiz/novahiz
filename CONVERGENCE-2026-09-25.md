# Audit convergence — 2026-09-25

## Résolu + prouvé (6)
1. LOW plugin (b3ccf5d): TOCTOU clone, dead counter sessions, traversal resolve+startsWith.
2. GATE_TOOLS (a3edbe0): cron_update_command_task.
3. Règles/tests (64d266b): R4 sans spec, R9 +vue/svelte/astro, R13/R14 prompt-scoped, tests réels, contentMatches.
4. Orca (49d3ce3): désinstallation complète.
5. Audit sub-agents (b3): 3 agents (sécurité, plugins/MCP, structure/code) — 131 findings.
6. Convergence (b9): inventaire P0-P2 + deferred acceptés.

## P0 — Résolu / Vérifié (6/6)
1. gate tier (gate.ts:280): code préfère prompt; plugin passe prompt — VÉRIFIÉ.
2. kill-switch (commands/gate.ts:48): fail-closed (warning stderr, enforcement reste) — RÉSOLU.
3. skills index (spec.ts:137): index sous build/ protégé (PROTECTED_INDEX_SUFFIXES); unmatchedRequired + warning — RÉSOLU.
4. plugin session (novahiz.ts:401/486/494): classifieur fail-closed, sessionID validé, skills validés — RÉSOLU (b3ccf5d).
5. capture-cli (capture-cli.mjs:69): resolve + startsWith + SAFE_NAME — RÉSOLU (existant).
6. postinstall (package.json:52): changé en --dry-run (opt-in) — RÉSOLU (m9927).

## P1 — Déféré / Non résolu (5/5)
7. bootstrap exec.ts:53 (SAFE_BOOTSTRAP_BINS): NON APPLIQUÉ.
8. cron executor.py:119 (whitelist + SSRF): NON APPLIQUÉ.
9. narsil opencode.jsonc:17 (exclure logs/DB): NON APPLIQUÉ.
10. auth opencode.jsonc:30 (SECURITY_MCP_SHARED_SECRET): NON APPLIQUÉ.
11. env opencode.jsonc:24 (env→environment): NON APPLIQUÉ.

## P2 — Déféré / Non résolu (5/5)
12. index rebuild 84→95 + docs sync: PARTIEL (README 95, docs partiellement alignées) — NON COMPLET.
13. R8 abs paths: NON APPLIQUÉ.
14. test cat + .tsx R9/R13/R14: PARTIEL (tests réels ajoutés, .tsx dans R9) — NON COMPLET.
15. dedup plugin (reco #15): NON APPLIQUÉ.
16. purge shims/auth (mcp-auth.json, npm shims): NON APPLIQUÉ.

## Non évalué
- Runtime Edge/Orca sessions, contenu conversations, CVE dépendances.

## Action requise
- Redémarrer opencode (plugin/config changés).
- Optionnel : traiter 16 P0-P2 déférés (demande utilisateur requise pour chaque lot).
