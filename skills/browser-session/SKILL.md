---
name: "browser-session"
description: "Drive a persistent Microsoft Edge browser session for research and verification: navigate, snapshot, click, fill, console and network inspection, keep login state across runs. Use when automating a web page, checking a UI in the real browser, or reusing an authenticated session."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# browser-session

All browser work goes through the Playwright MCP tools (`playwright_browser_*`). The profile is persistent at `C:\Users\hiz\.opencode\playwright-profile` so cookies and logins survive restarts.

## Hard rules

1. **Never launch Chrome, Chromium, or any manual browser process.** Use only the MCP tools, which run Microsoft Edge (`--browser=msedge`). If Edge is missing, fall back to another non-Chromium engine via the same MCP server.
2. Never disable or redirect `--user-data-dir`. Never purge the profile folder without the user's explicit consent.
3. Never open an ephemeral context when the task needs saved login state.
4. If the profile looks corrupted, stop and propose a backup before any reset.

## Session loop

1. **Snapshot first.** Prefer `playwright_browser_snapshot` over screenshots when you need to act. The accessibility tree gives stable element refs for clicks and fills.
2. **Navigate** with a full URL (`playwright_browser_navigate`). Wait for the content you care about with `playwright_browser_wait_for` (text visible or gone) rather than fixed sleeps.
3. **Act** via ref from the snapshot: `click`, `type`, `fill_form`, `select_option`, `press_key`. One logical action, then re-snapshot before the next if the DOM may have changed.
4. **Read** with `find` (search the snapshot for text/regex) before capturing a whole new tree when you only need one node.
5. **Inspect when debugging:** `console_messages` (level `error` first), `network_requests` / `network_request` for failed calls and payloads.
6. **Screenshot** only to show the user something visual (`take_screenshot`, save under a clear filename). Screenshots are not for finding elements.

## Authenticated flows

The persistent profile keeps sessions. On login pages:

- Check whether you are already signed in (snapshot the account menu or user name) before typing credentials.
- Never hard-code passwords in prompts or scripts. Ask the user to complete credential entry in the open browser when possible.
- After login, re-navigate to the deep link you actually need; do not assume the redirect landed where you wanted.

## Rate limits and failures

- Repeated identical navigations can hit HTTP 429. Back off (seconds, then minutes), vary the path only if the target allows it, and tell the user rather than hammering.
- On navigation error, capture console + last network response once, then stop and report. Do not retry in a tight loop.
- Dialogs: `handle_dialog` explicitly (accept or dismiss with prompt text). Ignored dialogs block the page.

## When the task needs a dev server

Start the app server in an **external terminal** before any browser interaction. Point the browser at the real origin. Do not claim a UI works from code reading alone; load it, snapshot it, act on it.

## Checklist

- [ ] MCP tools only; Edge; persistent profile untouched.
- [ ] Snapshot taken before each interaction sequence.
- [ ] Waits are content-based, not fixed sleeps.
- [ ] Console and network checked if anything failed.
- [ ] Credentials never written into the repo or chat.
- [ ] Result reported from observed browser state, not assumed.

## Sources

Novahiz global Playwright rules (`instructions.md`, persistent profile + Edge-only policy). Playwright MCP tool set (snapshot, navigate, click, type, console, network, dialogs). Original synthesis for this skill body.
