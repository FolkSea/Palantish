import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/env";

/** Magic-link callback: verifies the OTP token and establishes a session. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const redirectTo = (path: string, error?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = error ? `?error=${encodeURIComponent(error)}` : "";
    return NextResponse.redirect(url);
  };

  if (!token_hash || !type) {
    return redirectTo("/login", "invalid_link");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) return redirectTo("/login", "invalid_link");

  // Enforce the allow-list even if a link was somehow issued to another email.
  if (!isEmailAllowed(data.user?.email)) {
    await supabase.auth.signOut();
    return redirectTo("/login", "not_allowed");
  }

  return redirectTo(next);
}
