---
name: novahiz-stitch-fidelity
description: Prove a screen matches its Stitch reference instead of asserting it — capture the running app, composite reference vs render with a fresh marker, judge on a fixed grid, then fix and re-verify until the verdict is clean. Use when a screen originates from a Stitch maquette, when the user asks whether the build is identical to the mockup, before shipping screens in a project that carries stitch/ exports, or when a fidelity todo must be closed with evidence. Different from novahiz-wcag-audit (accessibility) and impeccable (design quality judgement): this one returns a per-screen PASS or DIVERGE verdict against one specific reference image, with measured numbers. Works for Expo, Flutter and any adb-driven mobile app; needs stitch/verify.config.json in the project.
license: Apache-2.0
metadata:
  author: novahiz
---

# novahiz-stitch-fidelity

A fidelity claim is only true once a screenshot of the running app has been compared with the Stitch
reference **in the same session, with a marker that proves the image is current**. This skill is the
loop that produces that proof: reach the screen, capture it, build the comparison, judge it, fix it,
capture again.

The gate (rule `R16-stitch-fidelity`) blocks edits to screens in a project that carries Stitch
references until this skill is loaded. Load it before touching those files, ahead of the refusal.

## When this applies

- The screen was built from a Stitch maquette (a `stitchId` in the screen registry, or a reference
  file in `stitch/`).
- The user asks "identique à la maquette ?", "does it match the mockup?", "vérifie la fidélité".
- A verification todo of kind `verify` targets screens of a Stitch project.

Not this skill: judging whether a design is *good* (use `impeccable`), whether it is *accessible*
(use `novahiz-wcag-audit`), whether the *code* is correct (use `novahiz-converge`).

## Contract: `stitch/verify.config.json`

Everything project-specific lives there, so both scripts stay framework-agnostic. Create it next to
the references if it does not exist.

```jsonc
{
  "adb": { "serial": "emulator-5554", "density": 2.625 },  // density = dp -> px factor
  "launch": {
    // {route} is replaced by the route of the screen. Leave null to use the ladder below.
    "deepLink": "exp://10.0.2.2:8081/--/{route}",   // Expo Go example; Flutter: "myapp://"
    "waitForIdleMs": 4500,
    "batch": 3                                        // screens per shell command, max 3
  },
  "screens": [
    { "id": "otp",  "route": "/otp",          "ref": "stitch/10-otp-hi.png",       "stitchId": "0e0fad..." },
    { "id": "home", "route": "/",             "ref": "stitch/01-home-hi.png" }
  ],
  "out": "stitch/_cmp",        // git-ignored: captures, bounds, composites
  "serve": { "root": "stitch", "port": 8123 },
  "project": { "stitchProjectId": "14523755384223316097" }  // optional, for MCP fetch
}
```

## The loop

Scripts live in this skill's `scripts/` directory (base directory shown with the skill). Run them
from the project root so relative paths in the config resolve.

1. **References first.** Confirm every screen you are about to judge has a local reference PNG.
   Missing one: fetch it from the Stitch MCP (`stitch.get_screen`, project id above, `htmlCode`
   plus a screenshot) or from the exported `*-hi.png`, and write it to the path in `config.screens`.
   No reference, no verdict — record the screen as *not evaluable*.
2. **Server up.** The app must be running (Metro / `flutter run`) in an **external terminal**, and
   the device awake and unlocked.
3. **Capture:** `node <scripts>/stitch_capture.mjs --config stitch/verify.config.json [--only otp,home]`
   Writes `<out>/<id>.png` and `<out>/<id>.bounds.json` (uiautomator bounds, for measured numbers)
   and prints a per-screen status table (`ok` / `unreachable`). Non-zero exit if any selected screen
   failed. Never run more than `launch.batch` screens in one command: adb drops past ~3.
4. **Composite:** `node <scripts>/stitch_composite.mjs --config stitch/verify.config.json`
   Writes `<out>/verify_<nonce>.html`: reference and capture side by side, `<img>` cache-busted with
   `?v=<nonce>`, a unique marker `STITCH_FRESH_<nonce>`, and a legend per screen with the deltas
   computed from the bounds files (bottom inset px, tap target sizes, text bounds).
5. **Look at the composite, fresh.** Serve `serve.root` on `serve.port` and open
   `http://localhost:<port>/_cmp/verify_<nonce>.html?v=<nonce>` in a **new browser tab**, then take a
   screenshot of that tab. Before any verdict, confirm the marker `STITCH_FRESH_<nonce>` is visible
   in what you just captured. Not visible → you are looking at a stale render: restart at step 5.
6. **Judge** every screen on the grid in `references/judgment-grid.md`. Each line gets PASS or
   DIVERGE **with a number** (px, dp, hex, token name). A DIVERGE without a measurement is a guess.
7. **Fix** the divergences in the app code, then re-run steps 3 → 5 for those screens only.
8. **Close** with the table: screen, verdict, measurement, commit. Screens that stayed unreachable
   are reported as *not evaluable* with the reason. Never report a screen as matching because the
   code "looks like" the reference.

Repeat 3 → 7 until every reachable screen is PASS, or until the remaining divergences are recorded
as known and accepted.

## Reaching a screen

Not every screen is one deep link away. Use the ladder in order and stop when one works:

1. **Deep link** — `config.launch.deepLink`, cold start when the route is guarded.
2. **Initial route** — start the app and the screen appears first (useful for `/`).
3. **Taps** — drive the real UI: `uiautomator dump`, read `bounds`, `adb shell input tap x y`.
   Prefer this over hacks; a screen only reachable through taps must be reached through taps.
4. **Not evaluable** — auth wall, backend state, or an animation that cannot be settled. Record the
   screen with the reason and move on. **This is a valid outcome; a fabricated verdict is not.**

Details per framework (Expo vs Flutter, launch, wait, gesture insets) in
`references/capture-recipes.md`.

## Failure notes

- `uiautomator dump` fails with "idle state" while an animation runs: wait, retry once, then tap a
  neutral point to settle the UI.
- adb silently truncates `screencap`: always use `adb exec-out screencap -p`.
- dp → px: multiply by `adb.density`. Never compare raw dp to raw px.
- Composites are git-ignored artifacts. Commit app code only — never `stitch/_cmp/`.
- The reference PNG must be the *hi* export, not a thumbnail; a scaled reference makes every
  spacing comparison wrong.

## Sources

Loop, anti-staleness protocol and access ladder synthesised from the Novahiz Stitch integration
sessions (Expo + adb). Reference: Stitch exports and the project's own `stitch/` folder.
