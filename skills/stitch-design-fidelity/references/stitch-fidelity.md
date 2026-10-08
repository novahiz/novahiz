# Stitch Fidelity Protocol

Per-screen PASS or DIVERGE verdict against a Stitch reference, with measured evidence.

## When to use

- A screen was generated from a Stitch maquette and must be verified before shipping.
- A build must be checked against its Stitch reference (mobile, native, any adb-driven screen).
- A fidelity todo must be closed with real proof, not an assertion.

This is a **verification** protocol, not a generation protocol. Use `stitch-design-fidelity` (the generation skill) to build the screen; use this skill to prove it matches.

## The verdict

Every verification produces exactly one of:

- **PASS** — screen matches the Stitch reference within measured tolerance.
- **DIVERGE** — measured differences exceed tolerance; list the divergences with numbers.

There is no partial verdict. A screen either passes or it diverges. The divergence list is the evidence; the fix is applied, and the screen is re-verified.

## The grid

Judgment is made on a fixed grid — not on feel, not on taste. The grid covers:

1. **Layout** — spacing measurements, alignment, component positions.
2. **Colors** — token matches against the design system's semantic layer.
3. **Typography** — font family, weight, size, line-height per role.
4. **Components** — presence, state, interaction behavior.
5. **Content** — real content matches the brief (no lorem ipsum, no placeholder metrics).
6. **Motion** — animations match the design system; reduced-motion path exists.
7. **States** — all 8 states present (default, hover, focus, active, disabled, loading, empty, error).

Each cell is measured. A divergence is reported with its measured number (e.g., "header padding: expected 16px, measured 12px").

## The loop

```
Generate (stitch-design-fidelity) → Capture → Composite with reference
    → Judge on grid → PASS or DIVERGE (with measurements)
    → If DIVERGE: fix → Re-capture → Re-judge → PASS
```

The loop stops at PASS. At most one fix round — the finish is clean, not endlessly polished.

## Evidence

Every verification produces:

- The captured screen (image file path, local to the workspace).
- The Stitch reference (image file path or fetched design).
- The composite comparison (side-by-side or overlaid).
- The grid verdict (PASS or DIVERGE) with per-cell measurements.
- The divergence list (if any) with the specific element reference and the measured difference.

This evidence is saved to the snapshot store. It is never invented — it is produced by the capture tool (`novahiz-stitch-fidelity`) against the running screen.

## Difference from related skills

- `stitch-design-fidelity` — drives the prompt, calls Stitch MCP, generates the screen.
- `novahiz-stitch-fidelity` (this skill) — verifies the result, produces PASS/DIVERGE with measurements.
- `novahiz-wcag-audit` — checks accessibility compliance; does not compare to a design reference.
- `impeccable` — design quality judgment; does not measure against a specific reference image.

These four skills are complementary. A shipped screen should pass `novahiz-stitch-fidelity` (matches reference) and `novahiz-wcag-audit` (accessible) before it is complete.
