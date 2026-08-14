"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { announceFirstSignIn } from "@/lib/notifications/first-sign-in";
import { isEmailAllowed } from "@/lib/allowlist";
import { landingFor } from "@/lib/auth-fragment";

const NOT_ALLOWED =
  "That account is not approved for this application. Ask an administrator to add it.";

type ActionResult = { error?: string; message?: string };

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Send a magic link. Users are managed in Supabase Auth, so links are only
 * issued to accounts that already exist (shouldCreateUser: false); a request for
 * an unknown email is a no-op. The response is deliberately identical either way
 * so the form does not reveal which emails have accounts.
 */
export async function signInWithMagicLink(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter an email address." };

  // Checked before the link is sent, but answered identically either way: the
  // form must not become a way to test who is on the list.
  if (!(await isEmailAllowed(email))) {
    return { message: `If ${email} has an account, a magic link is on its way.` };
  }

  const supabase = await createClient();
  const origin = await originFromHeaders();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/confirm`,
      shouldCreateUser: false,
    },
  });

  if (error) return { error: error.message };
  return { message: `If ${email} has an account, a magic link is on its way.` };
}

/**
 * Finish a sign-in whose session arrived in the URL fragment.
 *
 * The browser has already called setSession, so the cookies are in place and
 * this runs as that user. What is left is what the browser cannot check: that
 * the account is allowed to use the application at all. An invitation sent from
 * the Supabase dashboard does not touch the allow-list - only the invite in
 * Settings does - so without this check the recipient signs in successfully and
 * finds an application with nothing in it and no explanation.
 */
export async function completeFragmentSignIn(
  type: string | null,
): Promise<{ ok: true; next: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: "That sign-in link has expired." };

  if (!(await isEmailAllowed(user.email))) {
    await supabase.auth.signOut();
    return { ok: false, error: NOT_ALLOWED };
  }

  // Only ever fires once per user - see announceFirstSignIn.
  await announceFirstSignIn(user.id, user.email);
  return { ok: true, next: landingFor(type) };
}

export async function signInWithPassword(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { error: error.message };

  // The database refuses this account's reads either way; signing it straight
  // back out means saying so, rather than handing over a session that renders
  // an empty application with no explanation.
  if (!(await isEmailAllowed(email))) {
    await supabase.auth.signOut();
    return { error: NOT_ALLOWED };
  }

  // Only ever fires once per user - see announceFirstSignIn.
  if (data.user) await announceFirstSignIn(data.user.id, data.user.email);

  redirect("/");
}
