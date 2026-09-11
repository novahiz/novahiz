# Execution ledger

A long task fails in a predictable way: the plan lives in the conversation, the conversation gets compacted, and the agent starts improvising. The ledger moves the plan into SQLite. It survives compaction, it carries a proof per step, and it forces the plan to be revised as the work changes.

## Model

Two tables in the same database as the catalog.

A task holds `id`, `title`, `status` (`active`, `done`, `abandoned`), `session_id`, `created_at`, `updated_at`, and four fields for the living plan: `revision`, `reviewed_at`, `edits_since_review`, `todos_since_review`.

A todo holds `id`, `task_id`, `seq`, `label`, `kind` (`read`, `edit`, `verify`, `delegate`), `status` (`pending`, `in_progress`, `done`, `blocked`, `dropped`), `acceptance`, `proof`, `owner`, `depends_on`, `iterations`, `max_iterations`, `updated_at`.

## Rules that keep it honest

A todo enters `in_progress` only through `start`. Its dependencies must be `done` or `dropped` first. Each start increments `iterations`. The todo allows exactly `max_iterations` starts (12 by default) and the attempt after that fails. This is the loop guard.

A `verify` todo cannot be completed without a proof. The proof is the command you ran and its result, so a test step needs a real test line, not an assertion that it passed.

The task closes itself when every todo is `done` or `dropped`.

## Work packets

`dispatch` turns the pending and in-progress todos into work packets. Each packet carries an objective (the acceptance criterion, or the label), the kind, the owned files, the budget, and the dependencies.

File ownership is a glob on the `owner` field. When two packets own the same file, `dispatch` reports it as a conflict. Parallel sub-agents only help when the lots are independent, so the conflict list is the check to run before splitting the work.

## The living plan

The plan is not frozen. `amend`, `insert`, `drop`, and `reorder` adjust it while it runs.

`review` applies a diff in one transaction: additions, amendments, removals, and a new order. It increments `revision`, records `reviewed_at`, and resets the cadence counters to zero.

The cadence is the forcing function. Every 3 edits or 2 finished todos, a review is due. While a task is active and a review is due, the gate blocks edits and blocks `task start`, so the plan is reconciled before the work continues.

Signals are the reasons to revise, computed from the ledger and not from a model:

- `missing_acceptance`: an edit todo that has no acceptance criterion.
- `unowned`: an edit todo that owns no file.
- `parallel`: more than one todo in progress at once.
- `budget`: an in-progress todo that reached its iteration budget.
- `blocked`: a todo that is blocked and needs a decision.
- `ready`: a pending todo whose dependencies are all done, so it can start now.

## Configuration

In `novahiz.config.json`:

```json
"ledger": { "enabled": true, "review": { "edits": 3, "todos": 2 } }
```

When no task is active, the ledger does not change gate behavior. The review enforcement only applies to an active task.

## CLI

```
node src/cli.ts task new --title "Add the CSV export"
node src/cli.ts task plan --task <id> --json '[{"label":"read the parser","kind":"read"},{"label":"write the exporter","kind":"edit","acceptance":"csv round-trips","owner":"src/export.ts"}]'
node src/cli.ts task start --id <todo>
node src/cli.ts task done --id <todo> --proof "node --test tests/export.test.ts -> 4 pass"
node src/cli.ts task block --id <todo> --reason "missing fixtures"
node src/cli.ts task status --session <id>
node src/cli.ts task review --task <id> --json '{"amendments":[{"id":"<todo>","acceptance":"..."}],"additions":[...]}'
node src/cli.ts task insert --label "handle the BOM" --position start
node src/cli.ts task drop --id <todo> --reason "out of scope"
node src/cli.ts task reorder --task <id> --order <id,id,...>
node src/cli.ts task signals --task <id>
node src/cli.ts dispatch --task <id>
```

`task status`, `task resume`, and `task current` print the summary plus a review line and any signal. The adapter injects that summary into the enforcement block on every turn, so the plan stays in front of the model after compaction.

## MCP

`novahiz_task` exposes the same actions over stdio, and `novahiz_dispatch` returns the work packets and conflicts. Both open the same database.

## What it does not do

The gate forces the act of review, not its quality. The signals come from the ledger, so they point at real gaps, but the gate cannot judge whether an amendment is wise. That part stays with you.
