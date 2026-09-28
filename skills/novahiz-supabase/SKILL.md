---
name: novahiz-supabase
description: |
  novahiz-supabase for ANY task involving Supabase. Triggers: Database, Auth, Edge
  Functions, Realtime, Storage, Vectors, Cron, Queues; client libraries and SSR integrations
  (supabase-js, @supabase/ssr) in Next.js, React, SvelteKit, Astro, Remix; auth issues
  (login, logout, sessions, JWT, cookies, getSession, getUser, getClaims, RLS); Supabase CLI
  or MCP server; schema changes, migrations, declarative schemas, security audits, Postgres
  extensions (pg_graphql, pg_cron, pg_vector); debugging on Supabase projects.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-supabase

Production Supabase work: Auth, RLS, Edge Functions, Storage, and the operations around them.

## Core principles

### Verify against the changelog before you implement

Supabase moves quickly. Signatures, `config.toml` keys, and API conventions change between releases. Fetch `https://supabase.com/changelog.md`, scan for `breaking-change` tags that touch your task, follow the linked pages that apply, then look up the topic in the docs below. Training data is not a substitute.

### Prove the fix

After any change, run a query that shows it works. An unverified fix is unfinished work.

### Stop after two or three failures

If an approach keeps failing, change method instead of looping. Re-read the error, check the docs, look at logs when they exist.

### Authorization lives in the database

Supabase is raw Postgres underneath. Put the rules in RLS rather than scattering them across clients.

## Security checklist

### Auth and sessions

1. Never authorize from `user_metadata`. In Supabase, `raw_user_meta_data` is user-editable and surfaces in `auth.jwt()`, so it is unsafe for RLS or any other decision. Put authorization data in `app_metadata` / `raw_app_meta_data`.
2. Deleting a user does not kill live access tokens. Sign out or revoke sessions first, keep access token expiry short on sensitive apps, and on critical paths check `session_id` against `auth.sessions`.
3. Claims from `app_metadata` or `auth.jwt()` stay stale until the token refreshes. Plan for that lag.
4. Require MFA (AAL2) for high-risk work with a restrictive policy:

```sql
create policy "mfa_required"
on public.sensitive_table
as restrictive
to authenticated
using ((select auth.jwt()->>'aal') = 'aal2');
```

### Keys and clients

Never ship the `service_role` key or any secret to a public client. Prefer publishable keys on the frontend. In Next.js, every `NEXT_PUBLIC_` variable reaches the browser.

### RLS, views, and privileged functions

1. Views bypass RLS by default. On Postgres 15 and up, use `CREATE VIEW ... WITH (security_invoker = true)`. On older versions, revoke from `anon` and `authenticated`, or park the view in an unexposed schema.
2. UPDATE needs a SELECT policy. Without it, updates silently match zero rows: no error, no change.
3. `auth.role()` is deprecated. Name the target role with `TO authenticated` or `TO anon` instead.
4. `TO authenticated` alone is authentication without authorization (BOLA / IDOR). Pair it with an ownership predicate in `USING`:

```sql
create policy "example" on table_name for select
to authenticated
using ( (select auth.uid()) = user_id );
```

5. UPDATE policies need both `USING` and `WITH CHECK`. Without the check, a user can hand a row to someone else:

```sql
create policy "example" on table_name for update
to authenticated
using ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );
```

6. `SECURITY DEFINER` runs with the creator's privileges, usually a `bypassrls` role such as `postgres`. Adding it to silence a permission error removes access control without fixing the cause. Prefer `SECURITY INVOKER`.
7. `SECURITY DEFINER` functions in `public` are callable by everyone. Postgres grants `EXECUTE` to `PUBLIC` by default, so any such function in `public` is a public endpoint for `anon` and `authenticated`. When you truly need it, keep the function in a non-exposed schema, check `auth.uid()` in the body, and run `supabase db advisors` afterward.

### Storage

An upsert needs INSERT, SELECT, and UPDATE. Granting only INSERT lets new uploads land while replacements fail in silence.

### Dependencies

Pin versions and commit lockfiles for `supabase-js`, `@supabase/ssr`, `supabase-py`, and friends.

## Authentication

### JWT signing keys

Move off the shared HS256 secret onto an asymmetric key such as ES256. The public key is published through JWKS, so `getClaims()` verifies locally and the round trip disappears.

Migration with zero downtime:

1. Create a standby key.
2. Rotate so the asymmetric key becomes current.
3. Wait for access tokens to expire, plus a buffer.
4. Revoke the legacy secret.

### Sessions

| Item | Default | Notes |
|------|---------|-------|
| Access token expiry | 1 hour | Keep the default for most apps |
| Refresh token | Never expires, single use | Each use issues a new pair |
| Refresh reuse interval | 10 seconds | Do not change this value |

### Server-side authorization

| Method | What it does | When to use |
|--------|--------------|-------------|
| `getClaims()` | Verifies locally via JWKS with asymmetric keys | First choice on the server |
| `getUser()` | Asks the Auth server | When you need the freshest user record |
| `getSession()` | Reads client storage without revalidation | Never for server-side authorization |

## RLS performance

| Optimization | How | Typical gain |
|--------------|-----|--------------|
| Index the policy columns | plain index | up to ~99.94% |
| Wrap auth functions | `auth.uid()` becomes `(select auth.uid())` | ~94.97 to 99.99% |
| Explicit client filter | `.eq('user_id', userId)` | ~94.74% |
| Target role with `TO` | skip irrelevant roles early | ~99.78% |
| `security definer` function | move the authorization join inside | ~99.78% |

Wrapping auth functions in `(select ...)` caches them in the initPlan, so they evaluate once per statement instead of per row. That is the cheapest single win when writing RLS.

## Edge Functions

### Auth modes

| Mode | Accepts |
|------|---------|
| `'user'` | Valid user JWT on `Authorization` |
| `'secret'` | Secret key on `apikey` |
| `'publishable'` | Publishable key on `apikey` |
| `'none'` | Any caller, for signed webhooks |

### Practices

1. Forward the caller's JWT and let RLS do the work. Reserve `service_role` for private workers and trusted webhooks.
2. Keep functions light. The budget is 2 seconds of CPU and 256 MB of memory. Heavy computation does not belong here.
3. Use strict CORS. Wildcards and reflected origins are out.
4. Rate limit. Unchecked requests burn resources.

## CLI

Discover commands with `--help`. Never guess; the layout shifts between versions.

```bash
supabase --help
supabase <group> --help
supabase <group> <command> --help
```

Gotchas: `supabase db query` needs CLI v2.79.0 or newer, `supabase db advisors` needs v2.81.3 or newer, and hand-authored migrations in imperative projects start with `supabase migration new <name>`.

## Documentation access

Priority order before implementing anything Supabase:

1. MCP `search_docs` for snippets.
2. Fetch a docs page as markdown by appending `.md` to the URL path.
3. Web search when you do not know which page to open.

## References

- https://supabase.com/docs
- https://supabase.com/changelog.md
- https://supabase.com/docs/guides/security/product-security.md
