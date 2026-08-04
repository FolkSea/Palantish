import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdministrators } from "./create";

/**
 * Tell the administrators that someone signed in for the first time.
 *
 * "First time only" is the dedupe key doing the work, not a flag anyone has to
 * remember to set: the unique index on (user_id, dedupe_key) means the second
 * and every later sign-in insert nothing. Called from both sign-in paths, so
 * there is no state to keep in step.
 *
 * Uses the service role because the subject is not an administrator and cannot
 * write to anyone else's notifications - which is exactly as the policy should
 * have it.
 */
export async function announceFirstSignIn(
  userId: string,
  email: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    const db = createAdminClient();
    await notifyAdministrators(db, {
      kind: "new_user",
      title: "New user signed in",
      body: email ? `${email} signed in for the first time.` : undefined,
      href: "/settings",
      // The subject, not the moment: this is what makes it fire once ever.
      dedupeKey: `new_user:${userId}`,
    });
  } catch {
    // A sign-in must never fail because an administrator could not be told
    // about it.
  }
}
