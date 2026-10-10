# Frontmatter, templates and log

## Frontmatter convention

Every note starts with YAML frontmatter:

```yaml
---
type: project | course | resource | wiki | area
title: Note title
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active | archived | draft
tags: [tag1, tag2]
project: my-project          # optional: picks the sub-folder (memory/docs/journal/decisions)
novahiz_slot_id: slot-XXX    # legacy mirror marker: sync --apply archives such notes
novahiz_synced_at: ISO-8601  # legacy mirror timestamp (informational)
novahiz_slot_sync: true      # opt-in: import this vault note into local memory as a slot
---
```

`type` also drives which template fits; `tags` participate in routing (they are part of the
text matched against the domain keywords).

## Templates

`init` writes these four into `Templates/`. They are the only files exempt from link lint
(their `[[Category/_MOC|Category MOC]]` placeholder is resolved by the author).

### Project note

```markdown
---
type: project
title: Project Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [project]
---

# Project Name

## Goal
What is this project trying to achieve?

## Progress
- [ ] Task 1

## Notes
- [[Related Note]]

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

### Course note

```markdown
---
type: course
title: Course Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [course]
---

# Course Name

## Key concepts
- Concept 1

## Resources
- [[Related Resource]]

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

### Resource note

```markdown
---
type: resource
title: Resource Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [resource]
---

# Resource Name

## Summary
Brief description.

## Key takeaways
- Takeaway 1

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

### Wiki note

```markdown
---
type: wiki
title: Wiki Article Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [wiki]
---

# Wiki Article Name

## Overview
Brief overview.

## Details
Detailed content.

## See also
- [[Related Note]]

## Related MOCs
- [[Category/_MOC|Category MOC]]
```

## log.md format

Append-only — never delete an entry, only add:

```markdown
# Second Memory Log

Append-only. Never delete entries.

## 2026-10-07
- 15:30 — vault initialized
- 15:35 — activated domain: Code (full arborescence)
- 15:40 — created note: Code/Mobile/memory/general/react-hooks.md
- 15:44 — doctor --apply: relocated Inbox/loose-note.md → Security/Audits/docs/general/audit-owasp.md
```

## Backups

Before any rename, move or link rewrite, the original is copied to `Archive/.backup/` with
the relative path flattened (`Security/Audits/docs/general/x.md` →
`Security__Audits__docs__general__x.md.bak`). `doctor`, `fix` and `sync` all report the files
they backed up.
