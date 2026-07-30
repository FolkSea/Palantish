import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) return redirectTo("/login", "invalid_link");

  // Any user Supabase issued a valid link to is allowed in; access is managed
  // entirely in Supabase Auth.
  return redirectTo(next);
}
