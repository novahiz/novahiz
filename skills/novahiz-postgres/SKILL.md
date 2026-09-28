---
name: novahiz-postgres
description: |
  novahiz-postgres covers Postgres schema design, performance, and production operations.
  Load BEFORE writing or changing anything that lives in a Postgres database: tables, columns,
  migrations, RLS policies, indexes, triggers, database functions, and query plans.
  Rules are grouped into 8 categories ordered by impact.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-postgres

Postgres practices ordered by impact. Eight rule categories run from critical (query shape, connections) down to advanced features.

## When to apply

Consult this skill when writing SQL, designing schemas, adding indexes, tuning queries, sizing pools, writing RLS policies, or planning migrations.

## Categories by priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Query performance | CRITICAL | `query-` |
| 2 | Connection management | CRITICAL | `conn-` |
| 3 | Security and RLS | CRITICAL | `security-` |
| 4 | Schema design | HIGH | `schema-` |
| 5 | Concurrency and locking | MEDIUM-HIGH | `lock-` |
| 6 | Data access patterns | MEDIUM | `data-` |
| 7 | Monitoring and diagnostics | LOW-MEDIUM | `monitor-` |
| 8 | Advanced features | LOW | `advanced-` |

## Core principles

### Design around real query patterns

Start from how the application reads and writes. Keep hot tables narrow. Pick primary keys on purpose (bigint for internal keys, uuid for public ones). Shape indexes early so the access path stays obvious.

### Use the smallest correct type

`int` is 4 bytes, `bigint` is 8. `text` costs nothing against `varchar` for most strings. Event times use `timestamptz`, never naive `timestamp`. Reach for `jsonb` only when the document shape truly needs to flex.

### Normalize first, denormalize on evidence

Begin in 3NF for clarity and integrity. Flatten a relation only when measured reads justify it, and document the denormalization plus any sync job that keeps it honest.

### Index for the access you measured

B-tree for equality and ranges, GIN for JSONB containment and full text, BRIN for append-only giants, partial indexes for skewed predicates.

### Keep transactions short

Acquire locks in a stable order to avoid deadlocks. Use `CREATE INDEX CONCURRENTLY` on hot tables. Batch writes with multi-row `INSERT` or `COPY`.

### Monitor before you tune

Run `EXPLAIN ANALYZE` first. Watch autovacuum on churny tables, bloat in `pg_stat_user_tables`, and slow statements in `pg_stat_statements`.

## Performance checklist

1. Start with `EXPLAIN ANALYZE`, not config changes.
2. Compare estimated rows against actual rows.
3. Fix query shape before raising memory settings.
4. Index the real filter together with the real sort.
5. Drop indexes that no workload uses.
6. Prefer partial indexes for predictable hot subsets.
7. Check for sort spills before touching `work_mem`.

## Schema checklist

1. What are the 3 to 5 real queries this table must serve?
2. Are the hottest filters and sorts plain columns?
3. Are types narrow and semantically correct?
4. Is each row lean enough for high-frequency access?
5. Are key choices deliberate?
6. Would the next index be obvious from this shape?

## Common mistakes

- `SELECT *`, which defeats index-only scans.
- Deep `OFFSET` pagination; keyset pagination scales better.
- Over-indexing tables that take heavy writes.
- Ignoring autovacuum on high-churn tables.
- `float` for money; use `numeric`.
- Timestamps stored without a timezone.

## Note on files

Earlier versions of this skill pointed at `references/query-missing-indexes.md` and friends. Those files do not exist in this package. The rules live inline here. Do not link to paths that are not on disk.

## References

- https://www.postgresql.org/docs/current/
- https://supabase.com/docs
- https://wiki.postgresql.org/wiki/Performance_Optimization
- https://pganalyze.com/
