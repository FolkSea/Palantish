// Centralised, validated access to environment variables.
// Public vars are inlined at build time by Next.js. Server-only vars must never
// be imported into client components.

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Public Supabase config (safe for the browser). Lazy getters so that reading
 * one value never requires the other - e.g. the service-role admin client only
 * needs the URL and must not fail when the anon key is absent (as when a CLI
 * script targets a remote project with just the URL + service-role key).
 */
export const publicEnv = {
  get supabaseUrl(): string {
    return required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get supabaseAnonKey(): string {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
};

// Access control is managed entirely in Supabase Auth: any user that exists in
// the project (created/invited via the Supabase dashboard) may sign in. There
// is no application-level email allow-list.

/** Server-only secrets. Throws if accessed where they are undefined. */
export const serverEnv = {
  get serviceRoleKey(): string {
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get ingestCronSecret(): string {
    return required("INGEST_CRON_SECRET", process.env.INGEST_CRON_SECRET);
  },
  get anthropicApiKey(): string | undefined {
    return process.env.ANTHROPIC_API_KEY || undefined;
  },
  get searchApiKey(): string | undefined {
    return process.env.SEARCH_API_KEY || undefined;
  },
};
