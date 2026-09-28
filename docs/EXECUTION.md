# Execution Ledger

For work that spans more than a few steps, the ledger keeps the plan in SQLite instead of in the conversation. This survives context compaction and keeps the agent accountable.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                    TASK CREATION                            │
│                                                             │
│  Novahiz task new "Add CSV export"                     │
│                                                             │
│  Creates:                                                   │
│  • Task row in `tasks` table                                │
│  • Todos from the roadmap steps                             │
│  • Each todo has: kind, status, acceptance, proof, budget   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    TODO LIFECYCLE                            │
│                                                             │
│  pending → in_progress → done                               │
│                   ↓                                         │
│                blocked                                      │
│                   ↓                                         │
│                dropped                                      │
│                                                             │
│  Each transition is tracked with timestamps                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    DISPATCH                                 │
│                                                             │
│  Novahiz dispatch --task <id>                          │
│                                                             │
│  Generates work packets:                                    │
│  • Each packet = one todo                                   │
│  • Exclusive file ownership (no conflicts)                  │
│  • Dependencies resolved                                    │
│  • Budget attached                                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    REVIEW CADENCE                           │
│                                                             │
│  Every N edits or M completed todos:                        │
│  → Force a review step                                      │
│  → Inject review signal into system prompt                  │
│  → Agent must reconcile plan before continuing              │
│                                                             │
│  Defaults: review after 3 edits or 2 todos                  │
└─────────────────────────────────────────────────────────────┘
```

## Todo kinds

| Kind | Purpose |
|------|---------|
| `read` | Read and understand code |
| `edit` | Make code changes |
| `verify` | Check that the work is correct |
| `delegate` | Hand off to another agent |

## Todo statuses

| Status | Meaning |
|--------|---------|
| `pending` | Not started |
| `in_progress` | Currently being worked on |
| `done` | Completed successfully |
| `blocked` | Waiting on dependency |
| `dropped` | Removed from plan |

## Acceptance criteria

Each todo can have an `acceptance` string — a testable condition that must be true before the todo can be marked done.

## Proofs

For `verify` steps, a `proof` must be provided when completing the todo. This ensures verification is not skipped.

## Iteration budget

Each todo has a `max_iterations` (default: 12). If the budget is exhausted, the todo is flagged and the agent must escalate or replan.

## Work packets

`Novahiz dispatch` turns open todos into work packets for parallel sub-agents:

```json
{
  "todo": "t3",
  "label": "Write the migration",
  "objective": "Create a Supabase migration for the users table",
  "kind": "edit",
  "files": ["supabase/migrations/001_users.sql"],
  "acceptance": "Migration runs without errors",
  "budget": 12,
  "dependsOn": ["t1", "t2"]
}
```

Each packet has **exclusive file ownership** — no two packets can edit the same file.

## System prompt injection

The current plan summary is injected into the system prompt on every turn:

```
[Novahiz task] Add CSV export
  t1 ✓ Read the data model
  t2 ✓ Design the CSV format
  t3 → Write the export function (in_progress)
  t4   Add tests (pending)
  t5   Verify output (pending)
Review forced: 2/3 edits since last review
```

This keeps the plan visible even after context compaction.

## Trace check

When the gate runs, it also checks that the edit targets a file owned by an in-progress todo. If not, the edit is blocked with a message to start or claim the relevant todo first.
