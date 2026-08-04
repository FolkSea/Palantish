import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeAllowlistEmail } from "@/lib/allowlist-email";

export { normalizeAllowlistEmail };

/**
 * Whether an email may use the application.
 *
 * The real gate is is_allowed_user() in the database, which every read policy
 * calls - this is only so a rejected sign-in says so, instead of handing
 * someone a session that renders an empty application and no explanation.
 *
 * Uses the service role because allowed_users is deliberately unreadable by
 * users: it is the list of who may read, and it should not itself be readable
 * by whoever asks.
 *
 * Fails open on a database error, and deliberately: the database refuses the
 * data regardless, so a transient failure here should not lock out the whole
 * team over what is a courtesy message.
 */
export async function isEmailAllowed(email: string): Promise<boolean> {
  const normalized = normalizeAllowlistEmail(email);
  if (!normalized) return false;
  try {
    const { data, error } = await createAdminClient()
      .from("allowed_users")
      .select("email")
      .eq("email", normalized)
      .maybeSingle();
    if (error) return true;
    return !!data;
  } catch {
    return true;
  }
}
