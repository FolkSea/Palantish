import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

export async function ensureAuthenticated(): Promise<string | null> {
  return (await getAuthenticatedClient()) ? null : "Not authorized.";
}
