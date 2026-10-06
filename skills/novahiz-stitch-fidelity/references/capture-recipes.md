# Capture recipes

Per-framework launch, device commands, and the anti-staleness protocol. Everything else lives in
`SKILL.md` and `stitch/verify.config.json`.

## Device basics

```sh
adb devices                                   # serial goes in config.adb.serial
adb -s <serial> shell wm size                 # e.g. 1080x2424
adb -s <serial> shell wm density              # e.g. 420 -> 2.625 px per dp
adb -s <serial> shell input keyevent 82        # wake
adb -s <serial> exec-out screencap -p > out.png   # never plain `screencap` (truncates)
adb -s <serial> shell uiautomator dump /sdcard/d.xml && adb -s <serial> pull /sdcard/d.xml
adb -s <serial> shell input tap <x> <y>
```

`uiautomator dump` fails with *"unable to get idle state"* while an animation runs. Wait, retry once,
then tap an empty area of the screen to settle it before the second attempt.

**Batch at most 3 screens per shell invocation.** Past that adb drops the connection and the batch
dies midway; the capture script enforces `launch.batch`.

## Expo (React Native / Expo Go)

- Metro runs in an **external terminal** (`npx expo start`), never as a background shell of the agent.
- Emulator reaches the host at `10.0.2.2`: `exp://10.0.2.2:8081/--/<route>`.
- Cold start a guarded route: `adb shell am force-stop <package>` first, then
  `adb shell am start -a android.intent.action.VIEW -d "<deeplink>"`.
- Route `/foo` maps to `.../--/foo`; the app root is `--/` (with a trailing slash).
- If a route renders blank, the file may be misnamed (`index.tsx` serves `/`, not `/index`): verify
  with `uiautomator dump` before blaming the capture.

## Flutter

- `flutter run` in an external terminal; keep the same hot-reload session while fixing.
- Deep link through the registered scheme: `adb shell am start -a android.intent.action.VIEW -d "<scheme>://<path>"`.
- Widgets that are not routable (dialogs, bottom sheets) are reached by tap: dump, read bounds,
  `input tap`.
- Take screenshots from the device, never from the IDE preview or a widget test — neither renders
  the real theme, real fonts, or real insets.

## Reaching a screen (the ladder)

1. Deep link from `launch.deepLink`.
2. Initial route (cold start, screen appears first).
3. Taps driven by `uiautomator dump` bounds.
4. **Not evaluable** — record `unreachable` with the reason (auth wall, backend state, animation
   that cannot settle). A recorded `unreachable` is an honest result; a fabricated PASS is not.

## Anti-staleness protocol (mandatory before any verdict)

A rendered file read back by an agent can be stale — the viewer, the cache, or the tool may hand you
the previous image. Never compare what you did not just prove is fresh.

1. Build the composite (`stitch_composite.mjs`) — it emits `STITCH_FRESH_<nonce>` in the page and
   appends `?v=<nonce>` to **every** `<img>`.
2. Serve `serve.root` on `serve.port` (`npx http-server stitch -p 8123`, or
   `python -m http.server 8123 -d stitch`, in an external terminal).
3. Open `http://localhost:<port>/_cmp/verify_<nonce>.html?v=<nonce>` in a **new browser tab**.
4. Screenshot that tab.
5. Confirm the marker string is present in the screenshot / DOM you just captured. Missing → the
   render is stale: reload with a new `?v=` and repeat from step 3.
6. Only then form a verdict.

## Fix loop

Change the screen code → hot reload → `stitch_capture.mjs --only <ids>` → `stitch_composite.mjs` →
steps 3-5 of the protocol → re-judge **only those screens**. Cap iterations; after the cap, record
the remaining divergences with their measurements instead of looping silently.

## Out of scope for commits

`stitch/_cmp/` holds captures, bounds JSON and composites — all git-ignored. Commit app code only.
