"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

/** Email + password sign-in. Accounts are managed in Supabase Auth. */
export async function signInWithPassword(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect("/");
}
