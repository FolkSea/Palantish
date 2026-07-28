# Nation-State Cyber Intelligence Dashboard

A production web app that tracks nation-state cyber activity, actively exploited
vulnerabilities, reported breaches, and new vendor/government reporting. It
replaces a static single-file HTML artifact with a real application: intelligence
is stored in Supabase (Postgres + RLS), refreshed on a schedule by an ingestion
pipeline, and served behind Supabase Auth.

Plain-text only: no emoji or non-ASCII decorative glyphs anywhere (enforced by
`pnpm ascii-check` in CI).

## Stack

- **Next.js 16** (App Router, TypeScript, React Server Components) + **Tailwind CSS 4**
- **Supabase** (Postgres, Row Level Security, Auth)
- **Chart.js v4** via `react-chartjs-2` (timeline scatter)
- **pnpm** package manager
- Deploys to **Vercel** with a daily **Vercel Cron** ingestion trigger

## Architecture

```
RSS/Atom feeds --> ingest pipeline --> enrich (rules | LLM) --> dedup --> Supabase
                   (service role)                                          |
                                                                           v
Browser <-- Next.js (RSC) <-- RLS-gated SELECT <---------------- intel tables
   ^
   +-- Supabase Auth (magic link / password), email allow-list
```

- **Reads**: Server Components query Supabase with the anon key; RLS limits access
  to authenticated, allow-listed users.
- **Writes**: only the ingest pipeline, using the service-role key (server-only).
  There are no client-side write policies.

### Data model (`supabase/migrations`)

`sources`, `actors`, `intel_items`, `vulnerabilities`, `breaches`,
`refresh_runs`, `allowed_users`, and a `timeline_events` view (the four
nation-states, last 30 days, `security_invoker` so RLS applies). Full schema and
RLS in `supabase/migrations/20260727212210_init_schema.sql`.

## Local setup

Prerequisites: Node 20+, pnpm (via `corepack enable`), Docker (running).

```bash
pnpm install
```

### 1. Start Supabase (Docker)

The local stack is pinned to the `553xx` port range (see `supabase/config.toml`)
so it can coexist with other Supabase projects.

```bash
pnpm supabase start
```

Copy `.env.example` to `.env.local` and fill in the values printed by
`supabase start` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`). `ALLOWED_EMAILS`
gates who may sign in.

### 2. Apply schema + seed

`supabase start` runs migrations and `supabase/seed.sql` automatically. To
re-apply from scratch:

```bash
pnpm db:reset
pnpm db:types
```

The seed loads infrastructure only (the access allow-list, the RSS source
catalogue, and the five actor "nexus" cards). Intelligence rows are populated by
the pipeline from real feeds, never fabricated.

### 3. Create a local sign-in user

Magic-link emails are captured by Mailpit at http://127.0.0.1:55324. For a
password login during development, create a user via the auth admin API:

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"localdevpass123","email_confirm":true}'
```

The email must also be in `ALLOWED_EMAILS` (and the `allowed_users` table).

### 4. Run the app

```bash
pnpm dev
```

Visit http://localhost:3000 (redirects to `/login` until signed in).

### 5. Run the ingestion pipeline locally

```bash
pnpm ingest
```

Without `ANTHROPIC_API_KEY`, ingestion uses the deterministic rules enricher.
Set `ANTHROPIC_API_KEY` to enable the LLM enricher (`ANTHROPIC_MODEL` overrides
the default `claude-haiku-4-5`).

## Ingestion pipeline

Located in `src/lib/ingest/`:

1. **Pull** configured RSS/Atom feeds (`feeds.ts`).
2. **Search augmentation** (`search/`) - pluggable; a no-op until `SEARCH_API_KEY`
   is configured.
3. **Dedup** by `sha256(title + url)` against existing rows (`dedup.ts`).
4. **Enrich** (`enrich/`) - a rules-based default classifier plus an optional
   Anthropic LLM enricher behind `ANTHROPIC_API_KEY`. Drops marketing/product
   news; includes eCrime only when large-scale.
5. **Keep-most-recent**: actors with no items in the 30-day window are marked
   `quiet`; existing rows are never deleted.
6. **Write** to Supabase and record a `refresh_runs` row.

Trigger in production: `POST /api/ingest`, guarded by the `INGEST_CRON_SECRET`
shared secret. Vercel Cron calls it every 3 hours at 17 past the hour
(`17 */3 * * *` in `vercel.json`). The executive summary is cached in the
`executive_summaries` table and only regenerated when a run actually adds new
items, so the dashboard reads it without regenerating on page load.

## Tests and checks

```bash
pnpm test           # vitest: dedup + enricher classification + ASCII guard
pnpm ascii-check    # fail on any non-ASCII character under src/
pnpm lint
pnpm build
```

## Deploy to Vercel

1. Import the repo into Vercel (framework auto-detected as Next.js).
2. Create a Supabase project; run the migration (`supabase db push` or paste the
   SQL) and `seed.sql`. Add allow-listed emails to `allowed_users`.
3. Set environment variables (see `.env.example`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_CRON_SECRET`, `ALLOWED_EMAILS`, and
   optionally `ANTHROPIC_API_KEY` / `SEARCH_API_KEY`.
4. Also set `CRON_SECRET` equal to `INGEST_CRON_SECRET` - Vercel Cron sends it as
   `Authorization: Bearer <CRON_SECRET>`, which `/api/ingest` accepts.
5. `vercel.json` schedules the ingest cron every 3 hours at :17
   (`17 */3 * * *`). Deploy.

## Environment variables

See `.env.example` for the full documented list.
