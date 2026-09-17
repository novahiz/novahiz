---
name: engineering-standards
description: |
  Engineering standards reference for Novahiz code-producing tasks. Load ON DEMAND for
  code, debugging, database, devops, and audit categories — never kept in context permanently.
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
license: MIT
compatibility: opencode
---

# ENGINEERING STANDARDS

> On-demand reference extracted from the Novahiz agent rules. The agent loads this skill
> for `code`, `debugging`, `database`, `devops`, and `audit` tasks only.
> Apply ONLY the sections relevant to the current task. These are defaults: explicit user
> instructions and existing project conventions override them (see agent/novahiz-engine.md §4).
> Numbering is preserved from the legacy layout — standards 20 (memory), 41 (token economy),
> and 42 (Obsidian protocol) live in `agent/novahiz-engine.md`, not here.

---

# CATEGORY 1: ARCHITECTURE & DESIGN PATTERNS

You MUST follow these architectural principles in ALL code you write:

- **SOLID Principles**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion — apply to every class, function, and module.
- **DRY (Don't Repeat Yourself)**: If you see duplication, extract it. One source of truth for every piece of logic.
- **KISS (Keep It Simple, Stupid)**: Prefer the simplest solution that works. Complexity is a cost, not a feature.
- **YAGNI (You Ain't Gonna Need It)**: Do NOT build for hypothetical future requirements. Build what is needed NOW.
- **Separation of Concerns**: Each module, class, and function has ONE responsibility. Business logic, data access, and presentation are ALWAYS separated.
- **Composition over Inheritance**: Prefer composing small, focused components/functions over deep inheritance hierarchies.
- **Dependency Injection**: Dependencies are passed in, not created internally. This enables testing and flexibility.
- **Strategy Pattern**: Use when behavior varies at runtime. Encapsulate algorithms behind interfaces.
- **Factory Pattern**: Use when object creation is complex. Centralize construction logic.
- **Observer Pattern**: Use for event-driven communication. Decouple publishers from subscribers.
- **Repository Pattern**: All data access goes through repositories. Never call ORM/database directly from business logic.
- **Service Layer Pattern**: Business logic lives in services. Controllers handle HTTP, services handle domain.

---

# CATEGORY 2: SECURITY (OWASP TOP 10)

Security is NON-NEGOTIABLE. Every line of code must be written with security in mind:

- **Input Validation**: Validate and sanitize ALL input on EVERY entry point (forms, API params, headers, cookies, file uploads). Use allowlists, not denylists.
- **Output Encoding**: Encode ALL output before rendering. Prevent XSS by encoding HTML, JavaScript, CSS, and URL contexts.
- **Parameterized Queries**: NEVER use string concatenation for SQL. ALWAYS use parameterized queries or ORM methods.
- **CSRF Protection**: Include CSRF tokens on ALL state-changing requests (POST, PUT, PATCH, DELETE).
- **Content Security Policy**: Implement strict CSP headers. No inline scripts, no eval(), no unsafe-inline.
- **Cookie Security**: ALL auth cookies MUST be HttpOnly, Secure, SameSite=Strict, with appropriate expiration.
- **Rate Limiting**: Apply rate limiting on authentication endpoints, password reset, and sensitive operations.
- **JWT Best Practices**: Short expiration (15min), refresh token rotation, secure storage (httpOnly cookie).
- **Secrets Management**: NEVER commit secrets to code. Use environment variables or secret managers (Vault, AWS SSM).
- **Dependency Scanning**: Check dependencies for known vulnerabilities. Use `npm audit`, `pip-audit`, or Snyk.
- **CORS Configuration**: NEVER use `*` origin. Whitelist specific trusted domains.
- **SQL Injection Prevention**: Use ORM query builders or parameterized queries. NEVER interpolate user input into queries.
- **Authentication**: Every protected route MUST verify authentication. No exceptions.
- **Authorization**: Implement RBAC or ABAC. Check permissions at service level, not just controller level.
- **Security Headers**: Always set: HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy.

---

# CATEGORY 3: PERFORMANCE OPTIMIZATION

Every application MUST meet these performance standards:

- **Lazy Loading**: Routes, heavy components, and images MUST be lazy loaded. Only load what is needed NOW.
- **Image Optimization**: Use WebP/AVIF formats, responsive srcset, and proper sizing. Never serve uncompressed images.
- **Bundle Analysis**: Regularly analyze bundle size. Remove unused dependencies. Split large bundles.
- **Tree Shaking**: Ensure tree shaking is enabled. Import only what you use (`import { specific } from 'lib'`).
- **Critical CSS**: Inline above-the-fold CSS. Defer non-critical CSS loading.
- **Core Web Vitals**: LCP < 2.5s, FID < 100ms, CLS < 0.1 — these are HARD targets.
- **Caching Strategy**: Implement Redis/memory caching for expensive operations. Cache with proper TTL and invalidation.
- **CDN**: Serve all static assets through a CDN. Set proper Cache-Control headers.
- **Database Optimization**: Prevent N+1 queries. Use eager loading. Analyze EXPLAIN plans for slow queries.
- **Pagination**: ALL list endpoints MUST be paginated. Use cursor-based pagination for large datasets.
- **Debounce/Throttle**: User inputs (search, resize, scroll) MUST be debounced or throttled.
- **Virtual Scrolling**: Lists with 100+ items MUST use virtual scrolling (react-window, react-virtuoso).
- **Prefetching**: Prefetch routes and data the user is likely to navigate to next.
- **Compression**: Enable gzip or brotli compression for all text-based responses.

---

# CATEGORY 4: TESTING STRATEGY

Testing is MANDATORY. Ship code with confidence:

- **Unit Tests**: ALL business logic functions MUST have unit tests. 80% minimum line coverage.
- **Integration Tests**: ALL API endpoints MUST have integration tests covering success and error paths.
- **E2E Tests**: Critical user flows (signup, checkout, core features) MUST have Playwright E2E tests.
- **Coverage Thresholds**: Minimum 80% line coverage, 75% branch coverage. Fail CI if below threshold.
- **TDD Approach**: For new features, write tests FIRST (red), implement (green), refactor.
- **Mock External Services**: NEVER call real external APIs in tests. Mock all external dependencies.
- **Test Data Factories**: Use factories for test data, not hardcoded fixtures. Each test creates its own data.
- **Snapshot Tests**: UI components MUST have snapshot tests to catch unintended visual changes.
- **Load Tests**: Performance-critical paths MUST have load tests (k6, Artillery).
- **Security Tests**: Authentication and authorization flows MUST have security-focused tests.
- **Regression Tests**: Every bug fix MUST include a test that reproduces the bug.

---

# CATEGORY 5: API DESIGN STANDARDS

Every API you build MUST follow these standards:

- **RESTful Naming**: Use nouns for resources (`/users`, `/orders`), NOT verbs (`/getUsers`).
- **HTTP Methods**: GET (read), POST (create), PUT (full update), PATCH (partial update), DELETE (remove).
- **Error Responses**: Consistent format: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`.
- **Cursor-Based Pagination**: Use `?cursor=xxx&limit=20` instead of offset pagination for large datasets.
- **Filtering**: Use query parameters for filtering: `?status=active&created_after=2024-01-01`.
- **Sorting**: Use `?sort=created_at:desc` or `?sort=-created_at` (minus for descending).
- **Rate Limit Headers**: Include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **API Versioning**: Version APIs via URL (`/v1/users`) or header (`Accept-Version: v1`).
- **HATEOAS Links**: Include related resource links in responses for discoverability.
- **Request Validation**: Validate ALL request bodies and parameters against a schema (Zod, Joi, Yup).
- **Idempotency Keys**: Mutation endpoints (POST, PUT) MUST accept idempotency keys for safe retries.
- **Health Check**: Every service MUST expose `GET /health` returning status, version, and dependencies.
- **OpenAPI Documentation**: Every API MUST have an OpenAPI/Swagger spec. Document all endpoints.

---

# CATEGORY 6: DATABASE BEST PRACTICES

Database design determines application reliability:

- **Indexes**: ALL foreign keys and frequently queried columns MUST be indexed. Use composite indexes for multi-column queries.
- **Migrations First**: NEVER modify database schema manually. ALWAYS use migrations. Test migrations before deploying.
- **Normalization**: Normalize to 3NF minimum. Denormalize ONLY when profiling shows a performance bottleneck.
- **Soft Deletes**: Use `deleted_at` timestamp instead of hard deletes for audit trails and data recovery.
- **UUIDs**: Use UUIDs (v4 or ULID) for public-facing IDs. Never expose sequential integers.
- **Timestamps**: ALL tables MUST have `created_at` and `updated_at` columns. Automate with triggers or ORM.
- **Connection Pooling**: Use connection pooling in production. Never open/close connections per request.
- **Query Analysis**: Run EXPLAIN ANALYZE on slow queries. Optimize based on actual execution plans.
- **Backup Strategy**: Automated daily backups with tested restore procedure. Backups are USELESS if untested.
- **Data Integrity**: Use database-level constraints (NOT NULL, UNIQUE, CHECK, FOREIGN KEY) as the last line of defense.

---

# CATEGORY 7: FRONTEND / REACT / NEXT.JS

React/Next.js applications MUST follow these rules:

- **Component Size**: Components MUST NOT exceed 200 lines. Split larger components into smaller ones.
- **Custom Hooks**: Extract reusable logic into custom hooks. Never duplicate stateful logic across components.
- **Server Components**: Next.js App Router — use Server Components by DEFAULT. Client Components ONLY when interactivity, browser APIs, or state is required.
- **Client Components**: Mark with `'use client'` ONLY at the top of the file that needs it. Minimize client component tree.
- **Proper Keys**: NEVER use array index as key. Use stable, unique identifiers.
- **Memoization**: Use `useMemo` for expensive computations. Use `useCallback` for stable callback references passed to children.
- **Suspense**: Wrap async components in Suspense boundaries with meaningful fallback UI.
- **Error Boundaries**: Wrap feature sections in Error Boundaries for graceful failure handling.
- **Form Validation**: Validate on BOTH client (instant feedback) and server (security). Never trust client validation alone.
- **Accessible Forms**: ALL form inputs MUST have associated `<label>` elements. Use `htmlFor` or wrap input in label.
- **Responsive Design**: Mobile-first approach. Use CSS Grid/Flexbox. Test on 320px to 2560px viewports.
- **Dark Mode**: Support via CSS custom properties or Tailwind dark mode. Respect `prefers-color-scheme`.
- **Skeleton Loading**: Show skeleton placeholders during data loading, NOT spinners (perceived performance).
- **Optimistic UI**: Update UI immediately on user action, then reconcile with server response.
- **Effect Cleanup**: ALL useEffect hooks with subscriptions/timers MUST return cleanup functions.
- **No Inline Styles**: Use Tailwind CSS classes, CSS Modules, or styled-components. NEVER use inline `style={{}}`.

---

# CATEGORY 8: MOBILE DEVELOPMENT

Mobile applications MUST meet these standards:

- **Touch Targets**: ALL interactive elements MUST be at least 44x44px. No exceptions.
- **Safe Areas**: Handle safe area insets (notch, status bar, home indicator). Use `safe-area-inset-*`.
- **Offline First**: Design for offline. Cache critical data. Sync when connection is available.
- **Pull to Refresh**: Implement pull-to-refresh for all list views. Show loading indicator during refresh.
- **Haptic Feedback**: Use haptic feedback for confirmations, errors, and important interactions.
- **Platform Conventions**: Follow iOS HIG and Material Design guidelines. Respect platform-specific patterns.
- **Device Testing**: Test on real devices, not just simulators. Memory, performance, and gestures differ.
- **Memory Management**: Properly handle images and large data. Release resources when screen unmounts.
- **Background Sync**: Sync critical data in background. Handle app-to-background transitions gracefully.
- **Push Notifications**: Request permission at the RIGHT moment (after value demonstration). Handle notification actions.

---

# CATEGORY 9: DEVOPS & DEPLOYMENT

Infrastructure must be reliable and reproducible:

- **Environment Variables**: ALL configuration via environment variables. NEVER hardcode URLs, keys, or settings.
- **Docker**: Use multi-stage builds for smaller images. Run as non-root user. Pin base image versions.
- **Health Checks**: Every service MUST expose health and readiness probes for orchestrators.
- **Graceful Shutdown**: Handle SIGTERM signals. Finish in-flight requests before shutting down.
- **Structured Logging**: Use JSON format for logs. Include request ID, timestamp, level, and context.
- **Log Levels**: ERROR (failures), WARN (degraded), INFO (significant events), DEBUG (development only).
- **APM Integration**: Integrate Application Performance Monitoring (Datadog, New Relic, or equivalent).
- **Deployment Strategy**: Use blue-green or canary deployments. NEVER deploy without rollback capability.
- **Database Migrations**: Run migrations as part of CI/CD pipeline. Test migrations in staging first.
- **Rollback Plan**: Every deployment MUST have a documented rollback procedure.
- **Secrets Management**: Use proper secret stores (Vault, AWS SSM, GCP Secret Manager). Rotate regularly.
- **Infrastructure as Code**: ALL infrastructure MUST be defined in code (Terraform, Pulumi). No manual cloud console changes.

---

# CATEGORY 10: ACCESSIBILITY (WCAG 2.1 AA)

Accessibility is a LEGAL REQUIREMENT, not optional:

- **Semantic HTML**: Use correct elements: `<nav>`, `<main>`, `<article>`, `<section>`, `<header>`, `<footer>`, `<button>`.
- **ARIA Labels**: ALL interactive elements MUST have accessible names via `aria-label`, `aria-labelledby`, or visible text.
- **Keyboard Navigation**: EVERY feature MUST be operable with keyboard alone. Test with Tab, Enter, Escape, Arrow keys.
- **Focus Management**: Modal open → focus moves inside. Modal close → focus returns to trigger. Never trap focus.
- **Color Contrast**: Text MUST have minimum 4.5:1 contrast ratio against background. Large text: 3:1.
- **Alt Text**: ALL meaningful images MUST have descriptive alt text. Decorative images use `alt=""`.
- **Skip Navigation**: Include "Skip to main content" link as first focusable element.
- **Error Announcements**: Form errors MUST be announced to screen readers via `aria-live="polite"` or `aria-live="assertive"`.
- **Reduced Motion**: Respect `prefers-reduced-motion: reduce`. Disable or reduce animations for sensitive users.
- **Screen Reader Testing**: Test with NVDA (Windows) or VoiceOver (Mac). Verify all content is announced.
- **Video Captions**: ALL video content MUST have captions. Provide transcripts for audio-only content.
- **Touch Targets**: Mobile interactive elements MUST be at least 44x44px for accessibility.

---

# CATEGORY 11: SEO & WEB STANDARD

Search visibility requires technical excellence:

- **Title Tags**: UNIQUE, descriptive title for EVERY page. 50-60 characters. Include primary keyword.
- **Meta Descriptions**: Compelling, unique meta description for EVERY page. 150-160 characters. Include CTA.
- **Open Graph**: Implement OG tags (og:title, og:description, og:image, og:url) for social sharing.
- **Twitter Cards**: Implement Twitter card meta tags (twitter:card, twitter:title, twitter:description, twitter:image).
- **Canonical URLs**: Set canonical URL on EVERY page to prevent duplicate content issues.
- **XML Sitemap**: Generate sitemap.xml automatically. Include all indexable pages. Submit to Search Console.
- **robots.txt**: Block non-public pages (admin, API, staging). Allow all public pages.
- **Structured Data**: Implement JSON-LD Schema.org markup for rich snippets (Product, Article, FAQ, Breadcrumb).
- **Heading Hierarchy**: NEVER skip heading levels. H1 → H2 → H3. Only ONE h1 per page.
- **Internal Linking**: Link related content. Use descriptive anchor text. Maintain shallow crawl depth.

---

# CATEGORY 12: GIT & VERSION CONTROL

Version control discipline prevents disasters:

- **Conventional Commits**: ALL commits follow format: `type(scope): description` (feat, fix, chore, docs, refactor, test).
- **Branch Naming**: `feat/description`, `fix/description`, `chore/description`, `docs/description`.
- **PR Descriptions**: EVERY PR includes: what changed, why, how to test, screenshots if UI change.
- **Code Review**: ALL code MUST be reviewed before merge. No self-merges on main.
- **Squash Commits**: Squash feature branches before merge for clean history.
- **No Secrets**: NEVER commit .env files, API keys, passwords, or tokens. Use .gitignore.
- **Gitignore**: ALWAYS include: node_modules, .env, dist, build, .DS_Store, IDE config, OS files.
- **Signed Commits**: Use GPG or SSH signed commits when possible for verified authorship.

---

# CATEGORY 13: DOCUMENTATION STANDARDS

Documentation prevents knowledge loss:

- **README.md**: EVERY project MUST have a README with: setup instructions, usage examples, contributing guide.
- **JSDoc/TSDoc**: ALL public functions/classes MUST have JSDoc/TSDoc comments with description, params, returns, examples.
- **API Documentation**: ALL APIs MUST have OpenAPI/Swagger documentation. Keep it in sync with code.
- **Changelog**: Maintain CHANGELOG.md following Keep a Changelog format. Document all notable changes.
- **Architecture Decision Records**: Record significant architectural decisions with context, options, and rationale.
- **WHY, Not WHAT**: Comments explain WHY decisions were made, not WHAT the code does (code is self-documenting).
- **Complex Algorithm Comments**: Add comments for non-obvious algorithms, mathematical formulas, or business rules.
- **Deprecation Notices**: Deprecated code MUST include: reason, migration path, removal timeline.
- **Contributing Guide**: Document coding standards, PR process, testing requirements, and review checklist.

---

# CATEGORY 14: ERROR HANDLING & LOGGING

Errors are expected. How you handle them defines quality:

- **Custom Error Classes**: Create domain-specific error classes (ValidationError, NotFoundError, AuthError) with proper HTTP status codes.
- **Service Boundaries**: Wrap service calls in try-catch. Catch at boundaries, not everywhere.
- **NEVER Swallow Errors**: Every catch block MUST either handle the error, re-throw it, or log it. Empty catch blocks are FORBIDDEN.
- **User-Friendly Messages**: Show humans helpful messages. Log technical details for developers.
- **Structured Logging**: Log in JSON format with: timestamp, level, requestId, userId, action, metadata.
- **Request ID Correlation**: Generate unique request ID at entry. Pass through all services. Include in logs and responses.
- **Error Tracking**: Integrate Sentry, LogRocket, or equivalent. Alert on new error types.
- **Circuit Breaker**: Implement circuit breaker for external service calls. Prevent cascade failures.
- **Retry with Backoff**: Retry failed external calls with exponential backoff. Max 3 retries. Never retry non-idempotent operations without confirmation.
- **Graceful Degradation**: When a non-critical service fails, degrade gracefully. Show partial content, not error pages.
- **Alert Thresholds**: Define alert rules: ERROR = immediate, WARN = hourly digest, INFO = dashboard only.

---

# CATEGORY 15: STATE MANAGEMENT

State must be predictable and maintainable:

- **Local State**: UI-only state (open/closed, hover, temporary input) stays local (useState/useReducer).
- **Global State**: Shared domain data (user, cart, settings) uses global store (Context, Zustand, Redux).
- **Immutable Updates**: NEVER mutate state directly. Always create new objects/arrays.
- **Normalized Shape**: Store entities in normalized format: `{ users: { byId: {}, allIds: [] } }`.
- **Persistence**: Persist user preferences and non-sensitive state to localStorage or cookies.
- **Time-Travel**: Structure state to support debugging (action history, state snapshots).
- **Derived State**: Compute derived values via selectors, useMemo, or computed properties. Never store redundant data.
- **State Machines**: For complex UI flows (multi-step forms, wizards), use state machines (XState) to prevent impossible states.

---

# CATEGORY 16: INTERNATIONALIZATION (i18n)

Applications MUST support internationalization:

- **Externalized Strings**: ALL user-facing strings MUST be in translation files, NOT hardcoded in components.
- **ICU Message Format**: Use ICU format for plurals (`{count, plural, one {# item} other {# items}}`) and variables.
- **RTL Support**: Design layouts that work in both LTR and RTL. Use logical properties (margin-inline-start, not margin-left).
- **Date/Number Formatting**: Use `Intl.DateTimeFormat` and `Intl.NumberFormat` for locale-appropriate formatting.
- **Key Naming Convention**: Use consistent key structure: `section.element.property` (e.g., `auth.login.title`).
- **Fallback Language**: Define a default/fallback language. Missing translations fall back gracefully.
- **Pseudo-Localization**: Test with pseudo-locale to catch hardcoded strings and layout issues early.

---

# CATEGORY 17: PROGRESSIVE WEB APP (PWA)

PWAs MUST provide native-like experience:

- **Service Worker**: Implement service worker with stale-while-revalidate strategy for optimal caching.
- **App Manifest**: Complete manifest with name, icons (multiple sizes), theme color, background color, display mode.
- **Offline Fallback**: Custom offline page when no cached content is available. Never show browser offline error.
- **Background Sync**: Queue form submissions and actions when offline. Sync when connection returns.
- **Install Prompt**: Handle `beforeinstallprompt` event. Show custom install UI at appropriate moment.
- **Cache Versioning**: Version all caches. Clean old versions on service worker activation.
- **Push Notifications**: Implement push notifications with proper permission flow and subscription management.
- **Periodic Sync**: Use Background Sync API for periodic data updates when possible.

---

# CATEGORY 18: TYPESCRIPT STRICTNESS

TypeScript is your safety net. Maximize its protection:

- **Strict Mode**: `tsconfig.json` MUST have `"strict": true`. No exceptions.
- **No `any`**: NEVER use `any` type. Use `unknown` and narrow with type guards. `any` is a type escape hatch — you don't need it.
- **Discriminated Unions**: Use discriminated unions for state: `type State = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'success'; data: T }`.
- **Branded Types**: Use branded types for domain IDs: `type UserId = string & { __brand: 'UserId' }`. Prevents ID confusion.
- **Template Literal Types**: Use for route strings and event names: `type EventName = \`${string}:created\``.
- **Conditional Types**: Use for API response types based on input: `type Response<T> = T extends 'user' ? User : Post`.
- **Mapped Types**: Generate DTOs with mapped types: `type CreateUserDTO = Omit<User, 'id' | 'createdAt'>`.
- **Satisfies Operator**: Use `satisfies` to validate object shapes without widening: `const config = { ... } satisfies Config`.
- **Const Assertions**: Use `as const` for literal values: `const ROLES = ['admin', 'user'] as const`.
- **Exhaustive Switch**: Always handle ALL cases. Use `never` to ensure exhaustiveness: `case _never: throw new Error()`.
- **Module Augmentation**: Extend third-party types when needed. Never override, always augment.
- **Type-Level Tests**: Write type tests for complex types to catch regressions.

---

# CATEGORY 19: UI/UX DESIGN STANDARDS

Design consistency builds trust and usability:

- **Design Tokens**: Define ALL colors, spacing, typography, shadows as design tokens. Use consistently everywhere.
- **Border Radius Scale**: Use consistent radius: 4px (sm), 8px (md), 12px (lg), 16px (xl). NEVER use random values.
- **Typography Scale**: Define scale: 12, 14, 16, 20, 24, 32, 48. Use ONLY these sizes.
- **Spacing Scale**: Define scale: 4, 8, 12, 16, 24, 32, 48, 64. Use ONLY these values.
- **Animation Duration**: Standard durations: 150ms (micro), 300ms (normal), 500ms (complex). NEVER use arbitrary values.
- **Easing Curves**: Standard curves: ease (default), ease-in-out (transitions), cubic-bezier(0.34, 1.56, 0.64, 1) (spring).
- **Shadow System**: Define shadow tokens: sm, md, lg, xl. Use consistently. Never use box-shadow with arbitrary values.
- **Border Colors**: Define subtle (gray-200), medium (gray-400), strong (gray-600). Use contextually.
- **Interactive States**: ALL interactive elements MUST have: default, hover, active, focus, disabled states.
- **Loading States**: EVERY async operation MUST have a loading indicator. Never leave users wondering.
- **Empty States**: EVERY list/view MUST have an empty state with helpful guidance (not just "No data").
- **Toast Notifications**: Use toasts for success/error feedback. Auto-dismiss after 5s. Stack properly.
- **Modal/Dialog Patterns**: Modals MUST: trap focus, close on Escape, close on backdrop click, animate in/out.
- **Form Feedback**: Inline validation with clear error messages. Success states for completed fields.

---

# CATEGORY 21: REAL-TIME & WEBSOCKET

Real-time features require careful architecture:

- **WebSocket Protocol**: Use WebSocket (ws:// or wss://) for bidirectional communication. NEVER poll repeatedly for updates.
- **Server-Sent Events (SSE)**: Use SSE for server-to-client streaming (notifications, live feeds). Simpler than WebSocket for unidirectional.
- **Connection Management**: Implement heartbeat/ping to detect stale connections. Auto-reconnect with exponential backoff on client.
- **Message Format**: Use JSON with consistent structure: `{ type: string, payload: object, timestamp: string }`. Define message types as enums.
- **Pub/Sub Pattern**: Decouple message producers from consumers. Use Redis Pub/Sub, NATS, or message queues.
- **Room/Channel Support**: Implement rooms for targeted broadcasts (chat rooms, live collaboration, notifications).
- **Authentication**: Authenticate WebSocket connections on handshake. NEVER skip auth for real-time endpoints.
- **Rate Limiting**: Limit messages per user per second. Prevent spam and abuse.
- **Graceful Degradation**: Fallback to long-polling when WebSocket is unavailable. Provide value even without real-time.
- **State Synchronization**: Use CRDTs or operational transforms for collaborative editing. Resolve conflicts deterministically.

---

# CATEGORY 22: OBSERVABILITY & MONITORING

You can't fix what you can't see:

- **Distributed Tracing**: Implement OpenTelemetry for request tracing across services. Every request gets a trace ID.
- **Metrics Collection**: Track RED metrics (Rate, Errors, Duration) for all services. Use Prometheus or equivalent.
- **Dashboards**: Create operational dashboards for key metrics (request rate, error rate, latency percentiles, saturation).
- **Alerting Rules**: Define actionable alerts: P1 (immediate page), P2 (Slack notification), P3 (dashboard only).
- **Log Aggregation**: Centralize logs from all services. Use ELK, Datadog, or equivalent for searchable logs.
- **Custom Metrics**: Instrument business-specific metrics (signups/hour, revenue/minute, cart abandonment rate).
- **Profiling**: Use continuous profiling (Pyroscope, pprof) to identify CPU and memory hotspots.
- **Synthetic Monitoring**: Run synthetic tests (Pingcheck, Checkly) to detect outages before users report them.
- **Real User Monitoring (RUM)**: Track actual user experience (Core Web Vitals, errors, performance) in production.
- **Incident Detection**: Set up anomaly detection for error rates, latency spikes, and unusual traffic patterns.

---

# CATEGORY 23: INCIDENT RESPONSE

When things break, response quality matters:

- **Runbooks**: Create runbooks for every critical alert. Include: symptoms, impact, investigation steps, resolution, prevention.
- **On-Call Rotation**: Define on-call schedule. Ensure every team member carries pager duty.
- **SLA/SLO Definition**: Define Service Level Agreements (customer-facing) and Service Level Objectives (internal targets).
- **Error Budgets**: Track error budget consumption. If budget is exhausted, freeze features and focus on reliability.
- **Post-Mortem Process**: Every incident gets a blameless post-mortem. Focus on systemic improvements, not individual blame.
- **Incident Severity Levels**: Define P0-P4 severity levels with clear criteria (users affected, revenue impact, data loss risk).
- **Communication Templates**: Pre-written templates for: internal status page, customer notification, social media updates.
- **Escalation Paths**: Clear escalation from on-call → team lead → engineering manager → CTO.
- **Recovery Time Objectives**: Define RTO (Recovery Time Objective) and RPO (Recovery Point Objective) for critical systems.
- **Chaos Game Days**: Regularly scheduled chaos engineering exercises to test incident response readiness.

---

# CATEGORY 24: ETHICAL DEVELOPMENT & PRIVACY

Privacy is a human right, not a feature checkbox:

- **Privacy by Design**: Collect ONLY data you need. Default to privacy-friendly options. Anonymize by default.
- **GDPR Compliance**: Implement: consent management, right to access, right to erasure, data portability, breach notification.
- **Consent Management**: Explicit, informed consent for ALL data collection. Granular opt-in (not bundled consent).
- **Data Minimization**: Ask yourself: "Do I REALLY need this data?" If no, don't collect it.
- **Purpose Limitation**: Use collected data ONLY for the stated purpose. Never repurpose without new consent.
- **Data Retention**: Define retention periods for ALL data types. Auto-delete after retention period expires.
- **Right to Erasure**: Implement "delete my account" that removes ALL user data within 30 days.
- **Data Export**: Allow users to export all their data in machine-readable format (JSON, CSV).
- **Cookie Consent**: Implement cookie consent banner with granular controls (necessary, analytics, marketing).
- **Privacy Policy**: Clear, readable privacy policy. Explain what data, why, how long, who has access.
- **Children's Privacy**: If targeting minors, implement COPPA compliance. Verifiable parental consent required.
- **Ethical AI**: If using AI/ML, document training data sources. Check for bias. Provide explainability.

---

# CATEGORY 25: AI/LLM INTEGRATION

AI features require careful implementation:

- **Prompt Engineering**: Use structured prompts with clear instructions, examples, and constraints. Never send vague prompts.
- **RAG Architecture**: For knowledge-based AI, implement Retrieval-Augmented Generation. Vector search + LLM for accurate answers.
- **Vector Search**: Use embeddings for semantic search (Pinecone, Weaviate, pgvector). Chunk documents intelligently.
- **Context Window Management**: Respect LLM context limits. Summarize long documents. Use sliding window for conversations.
- **Output Validation**: ALWAYS validate LLM outputs before using them. LLMs hallucinate — verify facts independently.
- **Token Cost Management**: Track token usage. Cache common queries. Use smaller models for simple tasks.
- **Streaming Responses**: Stream LLM responses for better UX. Show tokens as they generate.
- **Rate Limiting**: Implement rate limiting on AI endpoints. Prevent abuse and cost overruns.
- **Fallback Strategy**: When AI fails, provide graceful fallback (search results, FAQ, human support).
- **Guardrails**: Implement content filters, toxicity detection, and output sanitization for user-facing AI.
- **Model Selection**: Choose the right model for the task. GPT-4 for complex reasoning, GPT-3.5 for simple tasks, local models for privacy.
- **Agent Patterns**: For autonomous agents, implement tool use, planning, memory, and guardrails.

---

# CATEGORY 26: PAYMENT INTEGRATION

Payment errors are the costliest bugs:

- **Stripe Integration**: Follow Stripe's best practices. Use Stripe SDKs, NOT raw HTTP calls.
- **Idempotency Keys**: ALL payment operations MUST use idempotency keys. Network failures must not cause double charges.
- **Webhook Verification**: ALWAYS verify webhook signatures. Never trust unverified webhook payloads.
- **Payment States**: Model payment states explicitly: pending → processing → succeeded/failed/refunded. Handle all transitions.
- **PCI Compliance**: NEVER store raw card numbers. Use Stripe Elements or hosted payment fields. Tokenize everything.
- **Error Handling**: Handle ALL payment errors: card declined, insufficient funds, expired card, network timeout. Show user-friendly messages.
- **Currency Handling**: Use integer amounts (cents) for ALL monetary values. NEVER use floating-point for money.
- **Subscription Management**: Handle subscription lifecycle: creation, upgrade, downgrade, cancellation, renewal, grace period.
- **Refund Flow**: Implement refund flow with proper accounting. Partial refunds supported.
- **Receipt Generation**: Generate receipts/invoices automatically. Include all required legal information.
- **Fraud Detection**: Implement basic fraud checks (velocity, amount limits, suspicious patterns). Use Stripe Radar or equivalent.
- **Test Mode**: ALWAYS test with Stripe test cards first. Never test with real cards in development.

---

# CATEGORY 27: EMAIL & NOTIFICATION SYSTEM

Communication infrastructure must be reliable:

- **Transactional Email**: Use dedicated transactional email service (SendGrid, Resend, Postmark). NEVER use Gmail/Outlook for transactional.
- **Email Templates**: Design responsive email templates. Test across email clients (Gmail, Outlook, Apple Mail).
- **Delivery Tracking**: Track email delivery, opens, clicks, bounces, and complaints. Monitor sender reputation.
- **Bounce Handling**: Handle hard bounces (invalid address) by removing from list. Handle soft bounces with retry logic.
- **SPF/DKIM/DMARC**: Configure email authentication properly. Prevent email spoofing and improve deliverability.
- **Unsubscribe**: Include one-click unsubscribe in ALL marketing emails. Process unsubscribes within 24 hours.
- **Notification Preferences**: Allow users to control notification channels (email, push, in-app) and frequency.
- **Push Notifications**: Implement web push (VAPID) and mobile push (FCM/APNs). Handle permission flow gracefully.
- **In-App Notifications**: Build notification center with read/unread states, priorities, and batch operations.
- **Rate Limiting**: Limit notification frequency per user. Prevent notification fatigue.

---

# CATEGORY 28: SEARCH IMPLEMENTATION

Search is a feature, not an afterthought:

- **Full-Text Search**: Implement full-text search with proper tokenization, stemming, and stop word removal.
- **Search Engine Selection**: Use Elasticsearch for complex needs, Meilisearch for simplicity, Algolia for SaaS.
- **Index Design**: Design search indexes for your query patterns. Denormalize data for search performance.
- **Relevance Tuning**: Configure scoring/boosting for relevant results. Title matches > content matches > tag matches.
- **Autocomplete**: Implement prefix matching for autocomplete. Limit suggestions to top 10. Debounce user input.
- **Fuzzy Matching**: Handle typos and misspellings. Use edit distance (Levenshtein) for fuzzy matching.
- **Faceted Search**: Implement filters (facets) for narrowing results. Show facet counts for discoverability.
- **Pagination**: Cursor-based pagination for search results. Never offset-based for large datasets.
- **Highlighting**: Highlight matching terms in search results. Show context snippets.
- **Analytics**: Track search queries, zero-result searches, click-through rates. Use data to improve relevance.
- **Synonyms**: Define synonym mappings (laptop ↔ notebook, phone ↔ smartphone). Expand queries with synonyms.
- **Multi-Language**: Support multiple languages in search. Use language-specific analyzers and stemmers.

---

# CATEGORY 29: FILE UPLOAD & STORAGE

File handling requires security and performance:

- **Cloud Storage**: Use S3-compatible storage (AWS S3, Cloudflare R2, MinIO). NEVER store files on application server.
- **Presigned URLs**: Generate presigned URLs for direct client-to-storage uploads. Don't proxy through your server.
- **File Validation**: Validate file type (magic bytes, not just extension), size, and content. Scan for malware.
- **Image Processing**: Generate thumbnails, resize, compress. Use Sharp (Node.js) or equivalent for server-side processing.
- **CDN Delivery**: Serve all user-uploaded files through CDN. Set proper Cache-Control headers.
- **Upload Limits**: Set maximum file size (10MB default). Limit total storage per user. Show clear error on limit exceeded.
- **Chunked Upload**: For large files (>5MB), implement chunked upload with progress tracking and resume capability.
- **Virus Scanning**: Scan ALL uploaded files for malware before making them available. Quarantine infected files.
- **Access Control**: Implement file-level access control. Private files require signed URLs with expiration.
- **Cleanup**: Implement automatic cleanup of orphaned files, temporary uploads, and expired presigned URLs.
- **Metadata**: Store file metadata (size, type, dimensions, upload date) in database. Reference by ID, not path.
- **Batch Operations**: Support bulk upload, bulk delete, and bulk download for power users.

---

# CATEGORY 30: FEATURE FLAGS & EXPERIMENTATION

Control releases, measure impact:

- **Feature Flags**: Use feature flags for gradual rollouts, kill switches, and A/B testing.
- **Flag Types**: Boolean (on/off), percentage (10% rollout), user segment (beta users), environment-based.
- **Flag Lifecycle**: Define stages: created → active → permanent → deprecated. Clean up old flags regularly.
- **Default Values**: ALWAYS specify a safe default value when flag is undefined. Never assume flag exists.
- **Client-Side Flags**: Evaluate flags client-side for UI changes. Use server-side for feature access control.
- **Flag Evaluation**: Evaluate flags at page load. Cache in memory. Re-evaluate on navigation or interval.
- **A/B Testing**: Use feature flags for A/B tests. Define success metrics BEFORE starting experiment.
- **Statistical Significance**: Run experiments until statistical significance (p < 0.05) or minimum sample size reached.
- **Gradual Rollout**: Roll out to 1% → 5% → 25% → 50% → 100%. Monitor error rates at each stage.
- **Kill Switch**: Every feature flag MUST have a kill switch. If feature causes issues, disable immediately.
- **Audit Trail**: Log ALL flag changes with who, when, why. Prevent accidental or unauthorized changes.
- **Flag Management UI**: Use LaunchDarkly, Flagsmith, or Unleash for flag management with audit trails.

---

# CATEGORY 31: DATA VALIDATION (RUNTIME)

Validate at every boundary:

- **Schema Validation**: Use Zod, Yup, or io-ts for runtime schema validation. NEVER trust unvalidated data.
- **API Input Validation**: Validate ALL API request bodies against a schema before processing. Reject invalid requests early.
- **Form Validation**: Validate on BOTH client (instant feedback) and server (security). Client validation is UX, server validation is security.
- **Type Narrowing**: Use TypeScript type guards to narrow `unknown` to specific types at runtime boundaries.
- **Error Messages**: Return specific, actionable error messages. Never expose internal implementation details.
- **Sanitization**: Sanitize user input to prevent injection attacks. Strip HTML, trim whitespace, normalize Unicode.
- **Date Validation**: Validate dates are valid, within expected range, and in correct timezone. Handle DST transitions.
- **Email Validation**: Use RFC-compliant email validation. Don't over-validate (allow international emails).
- **Phone Validation**: Use libphonenumber or equivalent for international phone number validation.
- **File Validation**: Validate file type (magic bytes), size, dimensions, and content. Don't trust file extensions.
- **Nested Validation**: Validate nested objects and arrays. Don't assume shape of nested data.
- **Partial Updates**: For PATCH requests, validate only provided fields. Allow partial updates safely.

---

# CATEGORY 32: CHAOS ENGINEERING

Break things before they break you:

- **Chaos Principles**: Start small, automate, build confidence. Never chaos without monitoring.
- **Fault Injection**: Inject failures: kill processes, add latency, corrupt data, exhaust resources.
- **Game Days**: Schedule regular chaos experiments. Test incident response and system resilience.
- **Blast Radius**: Contain chaos to small scope. Start with non-production, then expand to production.
- **Steady State Hypothesis**: Define what "healthy" looks like before chaos. Measure deviation from steady state.
- **Monitoring During Chaos**: Observe system behavior during chaos. Verify alerts fire correctly.
- **Automated Chaos**: Automate chaos experiments. Run them regularly without manual intervention.
- **AWS/Cloud Fault Injection**: Use AWS Fault Injection Simulator, Chaos Monkey, or Litmus for cloud-native chaos.
- **Network Chaos**: Simulate network partitions, DNS failures, and latency spikes.
- **Recovery Testing**: Verify system recovers gracefully after chaos stops. Measure recovery time.

---

# CATEGORY 33: COST OPTIMIZATION

Cloud costs are software costs:

- **Resource Right-Sizing**: Monitor resource utilization. Downsize over-provisioned instances. Use auto-scaling.
- **Spot/Preemptible Instances**: Use spot instances for fault-tolerant workloads. Save 60-90% vs on-demand.
- **Reserved Capacity**: Commit to 1-3 year reservations for predictable workloads. Save 30-50% vs on-demand.
- **Storage Tiers**: Move infrequently accessed data to cheaper storage tiers (S3 Glacier, Coldline).
- **Data Transfer Costs**: Minimize cross-region and cross-AZ data transfer. Cache at edge.
- **CDN Optimization**: Serve as much as possible through CDN. CDN bandwidth is cheaper than origin bandwidth.
- **Database Cost**: Choose right database type for workload. Don't use dedicated instances for small projects.
- **Monitoring**: Set up cost monitoring and alerts. Review AWS/GCP bill monthly.
- **FinOps Practices**: Tag ALL resources for cost allocation. Review unused resources quarterly.
- **Serverless Where Appropriate**: Use serverless for sporadic workloads. Pay only for actual usage.

---

# CATEGORY 34: VENDOR LOCK-IN PREVENTION

Maintain architectural flexibility:

- **Abstraction Layers**: Wrap vendor-specific APIs behind your own interfaces. Swapping vendors should be one-file change.
- **Standard Interfaces**: Use industry standards (S3 API, OpenTelemetry, OAuth 2.0) over proprietary APIs.
- **Multi-Cloud Ready**: Design for portability. Use Terraform/Pulumi for infrastructure abstraction.
- **Data Export**: Ensure you can export ALL your data in standard formats at any time.
- **Contract Testing**: Test against vendor API contracts. Detect breaking changes early.
- **Vendor Evaluation**: Before adopting a service, evaluate: data portability, API stability, pricing predictability, exit costs.
- **Avoid Proprietary Formats**: Use standard formats (JSON, CSV, Parquet) over vendor-proprietary formats.
- **Database Portability**: Use ORMs and standard SQL. Avoid vendor-specific SQL extensions.
- **Container Strategy**: Package applications as containers for easy migration between cloud providers.
- **Documentation**: Document all vendor dependencies and integration points for easy reference during migration.

---

# CATEGORY 35: LEGACY CODE MANAGEMENT

Maintain and modernize without breaking:

- **Strangler Fig Pattern**: Gradually replace legacy code by wrapping new code around old. Never big-bang rewrites.
- **Characterization Tests**: Write tests for existing behavior BEFORE refactoring. Capture current behavior as tests.
- **Boy Scout Rule**: Leave code cleaner than you found it. Small, incremental improvements every PR.
- **Dependency Upgrades**: Update dependencies regularly. Don't let versions drift too far behind.
- **API Compatibility**: When refactoring, maintain backward compatibility. Version your APIs.
- **Dead Code Removal**: Remove dead code aggressively. Dead code is confusing and increases attack surface.
- **Technical Debt Tracking**: Maintain a technical debt register. Prioritize by impact and effort.
- **Refactoring Patterns**: Use Martin Fowler's refactoring catalog. Apply proven patterns, not ad-hoc changes.
- **Migration Scripts**: Write automated migration scripts for database schema changes and data transformations.
- **Documentation**: Document legacy code WHYs. Future maintainers need context, not just code.

---

# CATEGORY 36: WEB COMPONENTS & DESIGN SYSTEMS

Build reusable, consistent interfaces:

- **Design System First**: Build design system BEFORE building features. Components are the foundation.
- **Storybook**: Document ALL components in Storybook. Include: variants, states, accessibility, examples.
- **Component API Design**: Consistent prop naming, composition patterns, and slot/fallback patterns.
- **Design Tokens**: Define tokens in code (CSS variables, JS constants). Single source of truth for visual design.
- **Component Testing**: Test components: rendering, interactions, accessibility, visual regression.
- **Documentation**: Every component MUST have: description, props table, usage examples, do's and don'ts.
- **Versioning**: Semantic versioning for design system packages. Breaking changes require major version bump.
- **Custom Elements**: Use Web Components (custom elements, shadow DOM) for framework-agnostic components.
- **Theming**: Support multiple themes via CSS custom properties or design tokens. Light/dark minimum.
- **Accessibility**: ALL components MUST be accessible. Test with screen readers. Follow WAI-ARIA patterns.
- **Performance**: Tree-shakeable components. Import only what you use. Lazy-load heavy components.
- **Mobile Components**: Design responsive components that work on all screen sizes. Touch-friendly interactions.

---

# CATEGORY 37: MICROSERVICES PATTERNS

Distributed systems require proven patterns:

- **Service Decomposition**: Split by business capability, NOT by technical layer. Each service owns its data.
- **API Gateway**: Single entry point for all clients. Handle routing, authentication, rate limiting, load balancing.
- **Saga Pattern**: For distributed transactions, use saga pattern (choreography or orchestration). Never distributed locks.
- **CQRS**: Separate read and write models when read/write patterns differ significantly. Use for high-read workloads.
- **Event Sourcing**: Store state as event log, not current state. Enables audit trail, replay, and time travel.
- **Circuit Breaker**: Implement circuit breaker for all inter-service calls. Prevent cascade failures.
- **Service Mesh**: Use service mesh (Istio, Linkerd) for: mTLS, traffic management, observability, resilience.
- **Message Queues**: Use queues (RabbitMQ, SQS, Kafka) for async communication. Decouple services temporally.
- **Idempotency**: ALL service operations MUST be idempotent. Network failures cause retries. Retries must be safe.
- **Observability**: Distributed tracing across all services. Correlation IDs for request tracking.
- **Deployment**: Independent deployment for each service. Feature flags for safe rollouts.
- **Data Consistency**: Eventual consistency is acceptable for most use cases. Design for it explicitly.

---

# CATEGORY 38: EDGE COMPUTING

Push logic closer to users:

- **Edge Functions**: Use Cloudflare Workers, Vercel Edge, or Deno Deploy for latency-sensitive logic.
- **Edge Middleware**: Run middleware at edge: authentication checks, A/B testing, geo-routing, bot detection.
- **ISR (Incremental Static Regeneration)**: Use ISR for pages that change frequently but benefit from CDN caching.
- **Edge Caching**: Cache API responses at edge. Use stale-while-revalidate for optimal freshness.
- **Geo Routing**: Route users to nearest region based on IP. Reduce latency for global users.
- **Edge-side Rendering**: SSR at edge for faster TTFB. Use React Server Components or equivalent.
- **Edge Database**: Use edge-compatible databases (Turso, PlanetScale, Neon) for low-latency reads.
- **Cold Start Optimization**: Minimize edge function size. Reduce dependencies. Use import maps.
- **Edge Security**: Run security checks at edge: rate limiting, bot detection, WAF rules.
- **Fallback Strategy**: Graceful fallback to origin when edge is unavailable. Never break the experience.

---

# CATEGORY 39: DATA PIPELINE & ETL

Data flows require reliability:

- **Schema Evolution**: Design schemas for backward compatibility. Use schema registries (Avro, Protobuf).
- **Stream Processing**: Use Apache Kafka, Pulsar, or Kinesis for real-time data streaming.
- **Batch Processing**: Use Apache Spark, dbt, or equivalent for scheduled batch transformations.
- **Data Quality**: Validate data at every stage. Schema validation, null checks, deduplication.
- **Idempotent Processing**: Design pipelines to be idempotent. Reprocessing must produce same results.
- **Dead Letter Queue**: Capture failed messages in DLQ. Monitor and alert on DLQ growth.
- **Data Lineage**: Track data flow from source to destination. Document transformations at each step.
- **Backfill Support**: Design pipelines to support backfilling historical data without breaking current processing.
- **Monitoring**: Track pipeline health: throughput, latency, error rates, lag. Alert on anomalies.
- **Data Catalog**: Maintain data catalog with: schema, owner, freshness, sensitivity level, usage patterns.

---

# CATEGORY 40: COMPLIANCE & AUDITING

Regulatory compliance is non-negotiable:

- **SOC 2 Compliance**: Implement controls for: security, availability, processing integrity, confidentiality, privacy.
- **HIPAA Compliance**: If handling health data: encryption at rest and in transit, access controls, audit logs, BAA with vendors.
- **Audit Trails**: Log ALL data access and modifications. Include: who, what, when, from where, result.
- **Data Classification**: Classify data: public, internal, confidential, restricted. Apply controls per classification.
- **Access Reviews**: Conduct quarterly access reviews. Remove access for departed employees immediately.
- **Encryption**: Encrypt data at rest (AES-256) and in transit (TLS 1.3). Use managed KMS for key management.
- **Key Rotation**: Rotate encryption keys regularly. Automate rotation. Support zero-downtime rotation.
- **Data Retention**: Define retention periods per data type. Implement automated deletion after retention.
- **Incident Response Plan**: Document incident response: detection, containment, eradication, recovery, lessons learned.
- **Third-Party Risk**: Assess vendor security. Review SOC 2 reports. Sign DPAs with data processors.
- **Penetration Testing**: Conduct annual penetration testing. Remediate findings within SLA.
- **Security Training**: All team members complete security training. Phishing awareness. Secure coding practices.

---
