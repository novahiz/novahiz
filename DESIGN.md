# Design record — Novahiz visual system

Recorded for `impeccable document`.
Source: `src/render.ts` (single styling module) and the renderings that consume
it — `novahiz doctor`, `novahiz deps`, and the installer.

## Surface

The terminal, and nothing else. This repository ships no web interface: a scan
for `*.html`, `*.tsx`, `*.jsx`, `*.css`, `*.vue`, `*.svelte` returns no files,
and `package.json.files` carries no asset directory. Everything below describes
CLI output, not a UI theme — there is no palette file, no design tokens file and
no component library in this project.

## Palette

Defined once in `src/render.ts` (`CODES`), reset with `ESC[0m` after every
styled span:

| Token | Sequence | Role |
|---|---|---|
| `bold` | `ESC[1m` | headings (`heading()`), emphasised labels |
| `dim` | `ESC[2m` | rules (`rule()`), key labels in `kv()`, table chrome |
| `red` | `ESC[31m` | `fail` status |
| `green` | `ESC[32m` | `ok` status |
| `yellow` | `ESC[33m` | warnings |
| `blue` | `ESC[34m` | available, used sparingly |
| `magenta` | `ESC[35m` | available, used sparingly |
| `cyan` | `ESC[36m` | available, used sparingly |
| `gray` | `ESC[90m` | secondary text |

`style(token, text)` returns `text` unchanged when color is off or the token is
unknown — it never emits an empty escape.

## Color policy

Ordered, as implemented:

1. `NO_COLOR` set to a non-empty value → color off.
2. `FORCE_COLOR` set to anything other than `0` → color on.
3. Otherwise → color only when `stdout` is a TTY (`isTty()`).

So piped output and CI logs stay plain; a real terminal gets color.

## Measurement and alignment

`width()` strips ANSI (`/\u001b\[[0-9;]*m/g`) before measuring, so a colored
cell occupies exactly the same column as a plain one. `table()` takes a
per-column `align` of `left` or `right` and paints cells through a per-column
`paint` function. Alignment is therefore independent of color state.

## Components

- `heading(text)` — bold.
- `rule(length = 52)` — a dim run of dashes, the default section separator.
- `kv(rows)` — dim key padded to the widest key, two spaces, then the value.
- `table(...)` — column-aligned, painted per column, measured after stripping.
- `bytes(value)` — `B` / `KB` / `MB` / `GB`, whole units below `KB`, one
  decimal above.

## Status semantics

`doctor` renders a `check / status / detail` table where `ok` reads green and
`fail` reads red. **Blocking is not colour**: a row with `blocking: false`
signals a command to run, not an anomaly — `doctor` still exits `0` with "No
blocking anomaly" while such rows exist. Do not read a red `fail` as a crash.

## Not covered here

- No web theme, no HTML design tokens, no icon set: nothing in this repository
  renders pixels outside a terminal.
- `docs/TOKENS.md` documents **context-token economy** (budgets, bytes per
  token, output dumps), not design tokens. It is not a visual system.
