---
name: novahiz-browser
description: novahiz-browser is the global Playwright MCP skill for OpenCode. Forces the dev server to start in an external terminal before any browser interaction. Triggers on playwright, browser, localhost, server, dev server, screenshot, web page.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-browser

Global skill for using Playwright MCP in OpenCode. It forces the development server to start in an external terminal before any browser interaction, and carries the connection protocol, common commands, and security rules.

## Hard rules

1. **NEVER use Chrome or Chromium.** Use only Microsoft Edge via the Playwright MCP server (`--browser=msedge`). Never launch `chrome.exe`, `chromium`, or any Chromium-based process manually or programmatically. All browser automation goes through the MCP tools (`playwright_browser_*`). If Edge is not installed, fall back to another non-Chromium browser (Firefox, WebKit) via the Playwright MCP server.
2. **Persistent profile only.** Profile folder: `C:\Users\hiz\.opencode\playwright-profile`. Never disable `--user-data-dir`. Never launch an ephemeral context for tasks requiring persistence. Never purge the folder without explicit user consent.
3. **Dev server first.** Start the application server in an external terminal before navigating to `localhost`. Do not assume it is already running. Confirm it responds before the first navigation.
4. **MCP tools only.** Navigation, clicks, typing, screenshots, and snapshots go through `playwright_browser_*`. No manual browser launch, no direct CDP attach outside the MCP server.

## Workflow

1. Start the dev server in an external terminal (or confirm it is already up).
2. Navigate with `playwright_browser_navigate`.
3. Capture state with `playwright_browser_snapshot` (accessibility tree). Prefer snapshot over screenshot for locating elements.
4. Interact only with element references returned by snapshot/find.
5. Verify with a fresh snapshot or screenshot after each significant action.

## Common commands

| Goal | Tool |
|------|------|
| Open a page | `playwright_browser_navigate` |
| Locate an element | `playwright_browser_find` or `playwright_browser_snapshot` |
| Click / type / fill | `playwright_browser_click`, `playwright_browser_type`, `playwright_browser_fill_form` |
| Screenshot | `playwright_browser_take_screenshot` |
| Console errors | `playwright_browser_console_messages` |
| Network activity | `playwright_browser_network_requests` |
| Wait for text | `playwright_browser_wait_for` |

## Connection protocol

The MCP server owns the browser process. Tools are stateless calls against the current page. If the page context is lost, re-navigate rather than guessing state. Tabs are managed with `playwright_browser_tabs`.

## Security

- Never paste secrets into pages you do not control.
- Never accept unexpected dialogs without checking what they carry.
- The persistent profile holds real sessions. Do not clear cookies or storage without asking.
- If the profile causes startup failures, propose a backup before any reset.

## When the profile fails

Inform the user, propose a backup of `playwright-profile`, and only reset after explicit consent. A corrupted profile is never an excuse to switch to Chrome or to an ephemeral context.
