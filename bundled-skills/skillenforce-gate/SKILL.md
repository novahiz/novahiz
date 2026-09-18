---
name: skillenforce-gate
description: |
  The skillenforce enforcement gate, seen from the agent side. Explains why an edit is
  refused, which skills unblock it, and how to read the block message. The gate is
  implemented in src/gate.ts and combines two sources: the rules (catalog/rules.json)
  and the non-optional skill-type roadmap steps (catalog/categories.json).
  Use when an edit is refused, before a significant action, or to know which skill to load.
  Triggers on: "gate blocks", "missing skill", requiredSkills, enforcement, skillenforce_GATE,
  "why is my edit blocked".
license: MIT
compatibility: opencode
---

# skillenforce-gate: read and satisfy the gate

The gate checks a single thing: are the skills required by the context loaded? If not, it refuses the edit.

## The two sources of requirements

**The rules** (`catalog/rules.json`), evaluated on path, file class, active category, and content:

| Rule | Triggers on | Requires |
|---|---|---|
| R1-docs | text, data, config | `humanizer` |
| R1-code-prose | code or design whose content carries prose | `humanizer` |
| R2-style | css, scss, sass, less, styl, html, vue, svelte, astro | `impeccable` |
| R2-styled-component | jsx, tsx whose content touches style | `impeccable` |
| R2-design-target | `design-ui` category on a design file | `impeccable` |
| R3-supabase | path `**/supabase/**` or `**/migrations/**`, category `database-supabase` | `supabase`, `supabase-postgres-best-practices` |

**Roadmap steps**: only those of `kind: "skill"` and non-optional block. Steps of `edit`, `verify`, and `advisory` appear in `requiredSkills` but refuse nothing.

## Exact semantics (gate.ts:229-236)

```
if index is available AND the skill is not in it
  -> unmatchedRequired: not enforced, and not reported anywhere
else
  -> effective: enforced
```

Three consequences to know:

1. **Skill missing from the index** (`build/installed-skills.json`, written at the last `sync`): it stops being required, silently. No message says so.
2. **Skill present in the index but missing from disk**: it stays required and nothing can load it. Blocked permanently until the next `sync`.
3. **Unreadable index**: everything is required. The gate becomes stricter, never more lenient.

## Read a block

```
{
  "allow": false,
  "missingSkills": ["humanizer"],
  "indexMissing": false,
  "targets": [{
    "path": "...", "fileClass": "text", "roadmap": "feature",
    "matchedRules": ["R1-docs"], "reasons": ["missing skill: humanizer"]
  }]
}
```

`missingSkills` is the list to load. `matchedRules` says why. `roadmap` says which category imposed the rest.

## Unblock

Load each missing skill with `skill({name})`. The load is recorded in the session, and the gate passes.

A required skill that becomes unavailable is not an obstacle to bypass: it is the signal that the index and disk have diverged. A `sync` brings them back into agreement.

## Bypass

The only one provided by the code: `skillenforce_GATE=off` (or `0`, `false`, `no`, `disabled`) in the environment, read via `gate.envEscape`. The user can also explicitly ask to override. In both cases, the override is stated aloud and fixed afterward. The agent's judgment is not a valid bypass.

## Anti-patterns

- Loading an unrelated skill to silence the message.
- Editing by bypassing, then regularizing later.
- Assuming the edit went through without checking `allow`.
- Forgetting `sync` after adding or renaming a skill.
- Believing that an `edit` or `verify` step blocks: only `kind: "skill"` blocks.
