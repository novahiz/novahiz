---
name: engineering-code-standards
description: |
  Engineering standards reference for Novahiz code-producing tasks. Load ON DEMAND for
  code, debugging, database, devops, and audit categories; never kept in context permanently.
  Covers: architecture & design patterns (SOLID, DRY, KISS, YAGNI), OWASP security,
  performance optimization, testing strategy, API design, database best practices,
  React/Next.js frontend, mobile development, DevOps & deployment, WCAG accessibility,
  SEO, git discipline, documentation, error handling & logging, state management,
  internationalization, PWA, TypeScript strictness, UI/UX design standards,
  real-time & WebSocket, observability & monitoring, incident response,
  ethical development & privacy (GDPR), AI/LLM integration, payment integration (Stripe),
  email & notifications, search implementation, file upload & storage, feature flags,
  runtime data validation, chaos engineering, cost optimization, vendor lock-in prevention,
  legacy code management, web components & design systems, microservices patterns,
  edge computing, data pipeline & ETL, compliance & auditing (SOC 2, HIPAA).
  Triggers on: writing code, fixing bugs, schema design, infrastructure work, code review.
license: Apache-2.0
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
compatibility: |
  Load on demand for code, debugging, database, devops, and audit categories.
  Defaults only; explicit user instructions and existing project conventions override them.
  Standards 20 (memory), 41 (token economy), and 42 (Obsidian protocol) live in
  agent/novahiz.md, not here.
---

# Engineering standards

Defaults for code that has to survive contact with production. Load this skill when the task is writing code, fixing a bug, designing a schema, wiring infrastructure, or reviewing a change. Apply only the sections the current task touches. When the user's instructions or the project's existing conventions conflict with something here, the project wins; note the divergence instead of fighting it.

Memory, token economy, and Obsidian protocol standards (20, 41, 42) are not in this file. They live in `agent/novahiz.md`.

## Structure before syntax

Design pressure shows up as change pressure. The rules below exist to keep the cost of the next change proportional to the size of the change.

- SOLID, translated to daily work. One reason to change per module (a billing rule does not parse HTML). Depend on abstractions where swapping the implementation is a real scenario, not a hypothetical one. Keep subclass contracts substitutable: an override that throws "unsupported" breaks callers. Segregate fat interfaces so a queue consumer does not implement HTTP methods it never uses. Invert dependencies so domain logic does not import the web framework.
- DRY applies to knowledge, not to keystrokes. Two five-line functions that encode the same pricing rule should collapse into one. Two similar-looking handlers that will diverge next sprint should stay apart.
- KISS and YAGNI gate every abstraction. Copy-paste three times before extracting. No strategy pattern for a single strategy. No configuration option for behavior nobody requested.
- Boundaries: modules expose a small public surface and keep helpers private. Cycles between modules get broken at the layer where the shared concept belongs.
- Legacy code: append, wrap, then shrink. Characterization tests around the behavior you touch, a seam (interface or function boundary) between old and new, migration behind a flag. Big-bang rewrites of a system that still ships features are how freezes start.
- Vendor lock-in: talk to cloud services through a thin adapter owned by your codebase (object storage interface, queue interface, secrets provider interface). Swapping AWS for something else should mean editing one package, not forty call sites. Multi-cloud abstraction layers for their own sake are a different trap; write the adapter only when exit is a stated requirement.

## Types and data at the boundary

- TypeScript: `strict` and `noUncheckedIndexedAccess` on. Prefer `unknown` plus a parser over `any` at every inbound edge (HTTP body, webhook, queue message, file upload, third-party API). Discriminated unions over boolean soup. No non-null assertions on data that came from outside the process.
- Runtime validation: schema at the trust boundary (Zod, Pydantic, JSON Schema, or the project's equivalent), types derived from the schema so the two cannot drift. Validate once, pass typed values inward. Revalidating every internal hop is noise.
- Domain errors: distinct error types or codes, not string matching on messages. Messages are for humans; codes are for branches.
- Serialization: explicit date formats (ISO 8601 with timezone), explicit decimal handling for money (integer minor units or fixed-precision types, never binary floats).

## Errors, logs, and the pager

- Handle errors where you can act on them; otherwise propagate with context. An empty `catch` is a defect. Catching broadly to "keep the service up" trades a loud failure for a silent one.
- Layered response: the edge maps internal errors to a generic body plus a correlation ID; the log keeps the detail. Stack traces never reach a user.
- Logging: structured (JSON in production), leveled with intent (debug for local digging, info for business milestones, warn for degraded but serving, error for requests lost), and never carrying secrets, tokens, passwords, full card numbers, or government IDs. Every request-scoped log line carries the request or trace ID.
- Observability: RED metrics for request paths (rate, errors, duration) per endpoint, USE for infrastructure (utilization, saturation, errors) per resource, distributed traces across service boundaries, dashboards that answer "is it broken, where, since when" in one screen, alerts bound to user impact rather than to raw CPU.
- Incident response: severity ladder agreed before the first incident; one incident commander, someone watching the timeline, written updates on a fixed cadence; postmortem without blame inside a week, with action items that carry owners and dates. Feature flags and config kill switches are part of the response kit.
- Chaos engineering: inject failures in staging on a schedule (kill a dependency, expire a cert, partition a node) only after the baseline alerting works; the goal is discovering missing handling while the customer is not watching.

## Performance

- Measure before optimizing. A flamegraph or a query plan beats a hunch.
- Hot paths: remove N+1 queries, batch remote calls, cache with explicit invalidation keys and TTLs, stream large payloads instead of buffering them.
- Frontend: budget for LCP under 2.5s on mid-tier mobile; ship less JavaScript, code-split at route boundaries, preload only what the first screen needs, compress images (modern formats, sized variants), avoid layout thrash from synchronous measurement loops.
- Backend: connection pooling over connection-per-request, pagination over unbounded lists, timeouts on every outbound call, concurrency limits so one tenant cannot starve the pool.
- Cost follows the same profile as performance: idle replicas, oversized instances, unbounded log retention, and chatty cross-region calls are the usual line items.

## Testing

- Pyramid by intent: many unit tests on pure logic, fewer integration tests on real boundaries (database, queue, HTTP client), a thin layer of end-to-end tests on critical journeys (sign up, pay, export). Contract tests keep service edges honest without full-system runs.
- Test behavior, not implementation: assert outcomes and observable side effects. Renaming a private method must not break a test.
- Fixtures: factories over copies of production dumps; no secrets in fixtures. Deterministic time and randomness with injected clocks.
- Every bug fix ships with a regression test that fails before the fix. Flaky tests get fixed or quarantined with an owner; a permanently skipped test is deleted.
- Coverage measures what nobody looked at; use it as a floor for new modules, not as a score.

## Databases and schemas

- Design for the queries you have. Add an index when a query plan says so; every index is a write tax.
- Migrations: forward-compatible (old code runs against new schema during deploy), reversible where the data allows, reviewed like code, never edited after they run in a shared environment. Expand-contract pattern for renames and type changes.
- Transactions around invariants: money moves, inventory decrements, and state machines either commit together or not at all. Set isolation deliberately; do not inherit it.
- Types: `TIMESTAMPTZ` (or equivalent) for instants, `NUMERIC`/integer cents for money, `TEXT` + check constraint over free-form enums when values evolve. Soft delete only when the product asks for undelete; hard delete with a retention job otherwise.
- Multi-tenant rows carry the tenant ID, and row-level security or mandatory filters keep one tenant out of another's data.
- Connection management: pool sizes sized to the database, not to the number of pods; statement timeouts on; slow-query log watched like an error rate.

## APIs

- Resource-oriented HTTP: plural nouns, status codes that mean what they say (201 created, 204 no content, 409 conflict, 422 validation failure), versioning strategy chosen once (URI version or media type) and applied consistently.
- Every collection endpoint paginates. Cursor pagination when data shifts under offset. Defaults for sort and filter that keep latency bounded.
- Idempotency keys on anything money-shaped or retry-prone. Rate limits with `Retry-After`. Errors return a machine-readable code, a human message, and the correlation ID.
- Webhooks: signed (HMAC over the raw body), retried with backoff, documented event payloads, and a receiving endpoint that is idempotent.
- Real-time and WebSocket: authenticate at upgrade time, heartbeat and idle timeouts, explicit reconnection with backoff and resume semantics on the client, backpressure limits so a slow client cannot balloon server memory, and a clear story for what happens to in-flight messages during a disconnect.
- GraphQL (when used): depth and cost limits, persisted queries in production, N+1 squashing through loaders.

## Web frontend

- React and Next.js: server components by default, client components only where interaction demands it; data fetched in loaders or server code when the data is not user-private-per-pixel; route-level code splitting; avoid putting authoritative state in the URL only, and avoid putting server data in global client state without a cache policy (use the project's data library with its staleness rules).
- State management: server state and UI state are different problems. Server data lives in the data layer with keys and invalidation. Ephemeral UI state (modals, form drafts) lives locally. Global client stores are for genuinely global, genuinely client-owned state; a store that mirrors the server invites drift.
- Forms: client validation improves speed, server validation is the authority, error messages point at the field that failed.
- UI and UX: consistent spacing scale, one type scale, interactive elements look interactive (affordance), disabled states explain themselves on focus or hover, optimistic updates roll back visibly on failure, skeletons over spinners for content that arrives late, empty states teach the next action.
- Design systems and web components: tokens (color, space, type, radius, motion) in one place; components expose variants by intent (primary, destructive, quiet), not by raw style knobs; a component's public API changes only with a migration note. Framework-neutral web components fit best at the leaf level (date picker, color swatch); app-level composition stays in the framework.
- Accessibility is not a phase. Semantic HTML first, ARIA only to fill real gaps, every action keyboard-reachable with a visible focus ring, contrast at WCAG 2.2 AA (4.5:1 body text, 3:1 large text and UI boundaries), form fields labeled in the DOM (not only visually), errors associated with fields and announced, images carry alt text when they inform and empty alt when they decorate, dialogs trap focus and restore it on close, heading levels form an outline, no keyboard traps, touch targets at least 24x24 CSS pixels with comfortable spacing (WCAG 2.2 AA). Automated scanners catch a minority of issues; keyboard and screen-reader passes are the real test.
- Internationalization: extract strings from day one, ICU-style plurals, locale-aware dates/numbers/currency through the platform APIs, layout tolerant of 30-40% text expansion, no concatenated sentences, language selection honored from user profile with a sane fallback. Do not ship pseudo-localization after launch; it pays for itself in week one.
- PWA: service worker only for strategies you can name (offline shell, stale-while-revalidate for immutable assets), update flow that tells the user when a new version waits, never cache authenticated personal data without an expiry story, and an install prompt that appears after value, not at first paint.
- SEO for content surfaces: server-rendered HTML for anything meant to be indexed, one canonical URL per document, descriptive titles and meta descriptions, sane heading hierarchy, structured data matching the visible content, sitemap and robots rules reviewed at deploy, redirects that preserve signals. Trick pages that exist only for crawlers violate both the guidelines and the trust model.
- File uploads: validate type by content sniffing and extension, cap size at the edge, scan where the risk warrants it, store outside the web root or in object storage with signed URLs, process asynchronously for anything slow, and clean up orphans on failure.
- Search: pick the engine by need (database full-text for modest corpora, dedicated engine when you need typo tolerance, facets, and relevance tuning), index asynchronously with an explicit lag story, keep the index rebuildable from source of truth, and treat relevance as a product surface with example queries and expected hits.

## Mobile

- Native feel over web habits: platform navigation patterns (tabs where tabs belong), platform-specific gestures and back behavior, safe areas respected, list virtualization for long feeds, images resized before decode.
- Offline and flaky networks: local cache with clear freshness rules, mutations queued with idempotent replay, conflict resolution strategy stated in the product (last-write, user prompt, server wins).
- Permissions asked in context with a rationale screen before the system dialog; deep links tested on cold and warm starts; release trains short enough that users get fixes without waiting a quarter.

## Payments (Stripe as the default)

- Amounts in integer minor units with explicit currency; never floats. Totals recomputed server-side; the client price is a display, not a contract.
- Fulfillment runs off webhooks verified by signature (and replay-protected with timestamp tolerance), not off the browser redirect. Every webhook handler is idempotent; Stripe retries.
- Test cards and test mode keys only in non-production; live secret keys only in the secret manager. SCA/3DS flows respected where the payment method requires them; dunning for renewals planned before launch, not after the first card failures.
- PCI scope kept narrow: use Elements or hosted checkout so card numbers never touch your servers; SAQ level documented.

## Email and notifications

- Transactional first: templates versioned in the repo, triggers from the domain events (receipt, password reset, invite), delivery pipeline with retries and bounce handling, unsubscribe honored on anything promotional, suppression list respected.
- Authentication messages: short-lived links, single-use, constant-time comparison where practical, no secrets in URL fragments that leak through history.
- Rate and relevance: quiet hours for non-urgent pushes, batching for digests, and one opt-out that works across channels the user did not ask for.

## Feature flags

- Flag when the risk profile justifies it: incomplete work shipped dark, staged rollouts, kill switches for risky paths. Not for every `if`.
- Names describe intent and expire: `billing-v2-rollout` beats `newFeature`. Owner and removal date in the flag inventory; a quarterly purge of dead flags is part of the definition of done.
- Evaluation: defaults safe (flag off means the old path), percentage rollouts keyed by stable user ID for consistency, and no flag logic so deep that removing it requires a archaeology dig.
- Config and flags are separate concerns: operational tuning (timeouts, batch sizes) in config, product decisions in flags.

## Pipelines and edge

- ETL and data movement: schema on the way in, contracts between stages, idempotent loads (re-running a day must not duplicate), late-arriving data handled explicitly, and lineage documented well enough to answer "which step corrupted this column".
- Microservices: split along domain seams with clear ownership, not along technical layers; synchronous calls kept shallow with timeouts and bulkheads; asynchronous events for workflows that tolerate latency; distributed transactions avoided in favor of sagas or outbox patterns; every service has its own runbook, dashboard, and on-call mapping. A monolith with module boundaries you enforce beats microservices you cannot operate.
- Edge computing: run at the edge what benefits from proximity (routing, caching, personalization, light transformation) and keep authoritative writes, secrets, and heavy compute away from it; cold starts and region limits understood before the design depends on them; observability at the edge does not disappear just because the process is close to the user.

## Delivery

- Git: small commits with messages that say why; branches short-lived; rebase or merge per team convention applied consistently; no force-push to shared branches; reviews look at correctness, tests, and risk surface before style (the formatter owns style).
- CI runs the same commands a developer runs locally (lint, typecheck, unit, build), protected branch requires green, dependency and secret scans as required checks where available.
- Deployment: repeatable artifacts (build once, promote the same artifact through environments), migrations ordered before code that needs them and backward compatible with the previous release, health checks that reflect real readiness, canary or blue-green where rollback speed matters, rollback rehearsed at least once before you need it.
- Environment parity: configuration differences expressed as config, never as forks of the codebase.

## Privacy, ethics, and compliance

- GDPR-shaped defaults: collect the minimum data the feature needs, publish retention periods and enforce them with jobs (erasure, export, and access-request flows built with the product, not bolted on later), legal basis recorded per processing activity, subprocessors inventoried, consent captured with the same rigor as a payment (auditable, revocable). Pseudonymize analytics identifiers; do not treat "anonymized" as a label you can stick on raw logs.
- Fairness and consent in AI features: training or improvement use of user content disclosed, opt-out honored, model outputs on consequential decisions reviewed for bias and kept contestable by a human path.
- SOC 2 and HIPAA-shaped controls, framed as engineering habits: least-privilege access with review on role change, encryption in transit and at rest, access and change logs retained and monitored, secrets out of code and rotated, backups tested by restore (an untested backup is a hypothesis), change management with review trails, workforce training recorded. HIPAA adds an explicit business-associate agreement with any processor touching PHI, minimum-necessary access to records, and audit logs on record access. Controls that only exist in a policy document will fail the evidence request.
- Supply chain: lockfiles committed, CI pinned to action versions by hash or tag, provenance (SBOM or signed builds) where the platform provides it.

## AI and LLM features

- Treat the model as an untrusted, eloquent participant: output is data, not instruction. Schema-validate structured outputs; never `eval` or execute model text directly.
- Prompt injection surfaces: user content and retrieved documents carry instructions by nature; isolate them from system instructions, sanitize or drop instruction-shaped lines from retrieval, and gate tool calls behind allowlists and confirmation for side-effecting actions.
- Cost and latency budgets set before launch: cap tokens per request, cache what is deterministic, stream when time-to-first-token matters, and meter usage per feature so a runaway loop shows up as a graph, not an invoice.
- Evaluation: golden set of inputs with expected properties, regression runs before prompt changes ship, logging of prompt version with each production response for debugging.
- Data handling: no secrets or raw personal data in prompts unless the contract allows it; redact or tokenize first; retention of conversation logs explicit.

## Documentation

- README answers: what this is, how to run it in one command, how to test, where the architecture notes live. Updated in the same PR as the behavior change it describes.
- Architecture decision records for choices with lasting cost (one file, context, options considered, decision, consequences). Comments explain why a constraint exists, never narrate what the next line does.
- API docs generated from the source of truth (types, OpenAPI, or the framework's annotations) so they cannot silently rot.

## Review checklist for this skill

When reviewing under these standards, in order: correctness under failure (what happens when the dependency is down, the input is hostile, the list is empty), security boundary (what crossed trust, was it validated), data integrity (transactions, idempotency, money types), observability (will we see this at 3 a.m.), then performance and maintainability. Style nits last, and only if the formatter does not already own them.
