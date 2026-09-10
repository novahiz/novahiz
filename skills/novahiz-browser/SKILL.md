---
name: novahiz-browser
description: |
  Browser automation skill for Novahiz agent. Uses chrome-devtools-mcp with --browserUrl.
  Edge must be running with CDP port 9222. Plugin novahiz-edge.ts auto-launches Edge.
  Use when: interacting with web pages, taking screenshots, filling forms, clicking elements,
  navigating URLs, testing UI behavior, automating browser workflows, E2E testing,
  visual validation, scraping dynamic content, performance analysis, memory debugging.
license: MIT
compatibility: opencode
allowed-tools:
  - chrome-devtools_navigate_page
  - chrome-devtools_click
  - chrome-devtools_type_text
  - chrome-devtools_fill_form
  - chrome-devtools_press_key
  - chrome-devtools_hover
  - chrome-devtools_drag
  - chrome-devtools_upload_file
  - chrome-devtools_handle_dialog
  - chrome-devtools_take_snapshot
  - chrome-devtools_take_screenshot
  - chrome-devtools_wait_for
  - chrome-devtools_list_pages
  - chrome-devtools_new_page
  - chrome-devtools_select_page
  - chrome-devtools_close_page
  - chrome-devtools_resize_page
  - chrome-devtools_evaluate_script
  - chrome-devtools_click_at
  - chrome-devtools_emulate
  - chrome-devtools_list_console_messages
  - chrome-devtools_get_console_message
  - chrome-devtools_list_network_requests
  - chrome-devtools_get_network_request
  - chrome-devtools_lighthouse_audit
  - chrome-devtools_performance_start_trace
  - chrome-devtools_performance_stop_trace
  - chrome-devtools_performance_analyze_insight
  - chrome-devtools_take_heapsnapshot
  - chrome-devtools_close_heapsnapshot
  - chrome-devtools_compare_heapsnapshots
  - chrome-devtools_screencast_start
  - chrome-devtools_screencast_stop
  - chrome-devtools_install_extension
  - chrome-devtools_list_extensions
---

# Novahiz Browser — Edge DevTools Browser Automation

You are a browser automation specialist using `chrome-devtools-mcp` with `--browserUrl=http://127.0.0.1:9222`. The MCP connects to Edge Profile 1 in a separate user-data-dir (edge-cdp). Main Edge profile stays open and untouched.

## Architecture

```
Edge (headed, Profile 1 — separate from main)
  ↕ CDP (http://127.0.0.1:9222)
chrome-devtools-mcp (official, Puppeteer-based)
  ↕ MCP tools
Agent
```

**Key features:**
- Plugin `novahiz-edge.ts` auto-launches Edge with CDP on first browser tool call
- Edge starts automatically — no manual intervention needed
- MCP connects to Edge Profile 1 in edge-cdp (not the main profile — main Edge stays open)
- 50+ tools including performance, memory, Lighthouse, extensions
- No confirmation dialog — CDP connection is direct

## CRITICAL RULES

### 1. Headed, Never Headless
```
headless = false  ← ALWAYS (default, no flag needed)
```

### 2. Separate Profile (--browserUrl)
chrome-devtools-mcp connects to Edge Profile 1 via `--browserUrl=http://127.0.0.1:9222`.
Uses a separate user-data-dir (edge-cdp) to avoid Chromium singleton lock with main Edge.
Configurable via `NOVAHIZ_EDGE_PROFILE` env var.
Edge must be running with `--remote-debugging-port=9222`.

### 3. Multi-Page Isolation
Use `new_page` / `select_page` / `close_page` for multi-context workflows. Each page is isolated.

## Tool Reference

### Navigation
| Tool | Purpose |
|------|---------|
| `navigate_page(url)` | Navigate to URL |
| `list_pages()` | List all open pages |
| `new_page(url)` | Open new page |
| `select_page(pageId)` | Switch to page |
| `close_page(pageId)` | Close page |

### Inspection
| Tool | Purpose |
|------|---------|
| `take_snapshot()` | Capture page accessibility tree (PRIMARY inspection tool) |
| `take_screenshot(format, maxDimensions)` | Visual screenshot |
| `list_console_messages(level)` | Get console logs |
| `get_console_message(index)` | Get specific console message |
| `list_network_requests()` | Get network requests |
| `get_network_request(index)` | Get specific network request |

### Interaction
| Tool | Purpose |
|------|---------|
| `click(ref)` | Click element by accessibility ref |
| `click_at(x, y)` | Click at coordinates (requires vision model) |
| `type_text(ref, text, slowly)` | Type into element |
| `fill_form(fields[])` | Fill multiple form fields at once |
| `hover(ref)` | Hover over element |
| `press_key(key)` | Press keyboard key |
| `drag(startRef, endRef)` | Drag and drop |
| `upload_file(ref, paths)` | Upload files |
| `handle_dialog(accept, promptText)` | Handle dialog/popup |

### Performance
| Tool | Purpose |
|------|---------|
| `performance_start_trace()` | Start performance trace recording |
| `performance_stop_trace()` | Stop trace and get URL |
| `performance_analyze_insight(traceUrl)` | Analyze trace for insights |
| `lighthouse_audit(url, categories)` | Run Lighthouse audit |

### Memory
| Tool | Purpose |
|------|---------|
| `take_heapsnapshot()` | Capture heap snapshot |
| `close_heapsnapshot(snapshotId)` | Close heap snapshot |
| `compare_heapsnapshots(before, after)` | Compare two snapshots |

### Emulation
| Tool | Purpose |
|------|---------|
| `emulate(device)` | Emulate device (viewport, user-agent, etc.) |
| `resize_page(width, height)` | Resize viewport |

### Script
| Tool | Purpose |
|------|---------|
| `evaluate_script(function, args)` | Run JavaScript on page |

### Extensions
| Tool | Purpose |
|------|---------|
| `install_extension(path)` | Install Edge extension |
| `list_extensions()` | List installed extensions |
| `reload_extension(extensionId)` | Reload extension |
| `trigger_extension_action(extensionId)` | Trigger extension action |

## Workflow

### Step 1: Navigate
Always start with `navigate_page` to the target URL. Wait for the page to load before proceeding.

### Step 2: Inspect
Use `take_snapshot` to capture the page structure. This is your PRIMARY tool for understanding what's on screen — use it before ANY interaction.

### Step 3: Interact
Based on the snapshot, use the appropriate action:
- **Click**: `click` with element ref
- **Type**: `type_text` for input fields
- **Fill form**: `fill_form` for multiple fields at once
- **Navigate**: `press_key` for keyboard shortcuts (Enter, Tab, etc.)

### Step 4: Verify
After each significant action:
1. Take a `take_snapshot` to confirm the state changed
2. Use `take_screenshot` if visual confirmation is needed
3. Check for errors with `list_console_messages`

### Step 5: Screenshot for Documentation
When the task requires visual proof or review:
- Use `take_screenshot` with `format: "png"` for high quality
- Use `maxDimensions` to control size

## Interaction Patterns

### Form Filling
```
1. Navigate to form URL
2. take_snapshot to identify fields
3. fill_form with all fields (ref + value)
4. take_snapshot to verify filled state
5. click submit button
6. take_snapshot to verify success/error
```

### Multi-Page Automation
```
1. new_page(url: "admin.example.com") → page A
2. new_page(url: "user.example.com") → page B
3. In page A: fill_form → click submit
4. select_page(pageA) → verify
5. select_page(pageB) → refresh → verify entry appears
6. close_page(pageA) → cleanup
```

### Performance Analysis
```
1. performance_start_trace()
2. navigate_page(url) → interact with page
3. performance_stop_trace() → get trace URL
4. performance_analyze_insight(traceUrl) → get insights
```

### Memory Debugging
```
1. take_heapsnapshot() → snapshotBefore
2. Perform actions that may leak memory
3. take_heapsnapshot() → snapshotAfter
4. compare_heapsnapshots(snapshotBefore, snapshotAfter)
```

### Lighthouse Audit
```
1. lighthouse_audit(url: "https://example.com", categories: ["performance", "accessibility"])
2. Review results
```

### Dynamic Content
```
1. Navigate
2. wait_for(text: "Expected content") or wait_for(time: 2)
3. take_snapshot to confirm content loaded
```

### Error Recovery
```
1. If action fails → take_snapshot to see current state
2. If page changed unexpectedly → navigate_page to reload
3. If element not found → take_snapshot and look for alternative ref
4. Take screenshot of error state for debugging
```

## Best Practices

- **Always take_snapshot before clicking** — know what you're targeting
- **One action at a time** — don't batch clicks; verify between each
- **Use descriptive element refs** — "Submit button" not "button"
- **Wait for content** — use `wait_for` before interacting with dynamic pages
- **Capture errors** — screenshot + console messages on failure
- **Clean up pages** — close pages you opened when done
- **Resize when needed** — use `resize_page` for responsive testing
- **Multi-page: always list first** — call `list_pages()` before any multi-page work
- **Multi-page: snapshot after switch** — verify page state after every `select_page`
- **Multi-page: close in reverse order** — LIFO cleanup prevents index shifting

## Screenshot Naming Convention

Use descriptive names for saved screenshots:
- `<page>-<state>.png` — `"login-success.png"`, `"checkout-empty.png"`
- `<action>-<result>.png` — `"form-submit-error.png"`, `"search-results.png"`

## Anti-Patterns

- Never use headless mode — the user must see the browser
- Never click without snapshotting first — you're flying blind
- Never assume an element exists — snapshot and verify
- Never skip error handling — always check console messages after actions
- Never leave pages open — clean up after workflows
- Never assume page IDs are stable — re-list pages after any close/open
- Never interact on wrong page — always snapshot after `select_page` to confirm
- Never open 20+ pages — browsers degrade, use sequential workflows instead
- Never forget page cleanup on error — close opened pages even when failing
- Never run performance traces without purpose — they're expensive
- Never ignore console errors — they indicate real issues

