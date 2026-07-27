import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client. Bypasses RLS and can write to every table.
 * SERVER-ONLY: the `server-only` import makes bundling this into client code a
 * build error. Used exclusively by the ingest pipeline.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    serverEnv.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
