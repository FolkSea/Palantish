import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { announceFirstSignIn } from "@/lib/notifications/first-sign-in";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  const redirectTo = (path: string, error?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = error ? `?error=${encodeURIComponent(error)}` : "";
    return NextResponse.redirect(url);
  };

  // Supabase said no before we got here - an expired or already-used link. Its
  // code is passed on, never its message: the message would be arriving in a
  // URL, and the sign-in page must not print sentences it was handed.
  if (searchParams.has("error") || searchParams.has("error_description")) {
    return redirectTo(
      "/login",
      searchParams.get("error_code") ?? searchParams.get("error") ?? "invalid_link",
    );
  }

  const supabase = await createClient();

  // Three shapes of link reach this route, and only two are visible from the
  // server. A link the application sent carries token_hash; a PKCE exchange
  // carries code; a link that went through the project's own verify endpoint
  // carries the session in the URL fragment, which no server ever receives.
  // The third is sent on to /login, where the browser can read it - saying
  // "invalid link" to somebody holding a perfectly good one is how an
  // invitation appeared to fail.
  const verified = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : token_hash && type
      ? await supabase.auth.verifyOtp({ token_hash, type })
      : null;

  if (!verified) return redirectTo("/login");
  const { data, error } = verified;
  if (error) return redirectTo("/login", "invalid_link");

  // Only ever fires once per user - see announceFirstSignIn.
  if (data.user) await announceFirstSignIn(data.user.id, data.user.email);

  // Supabase controls sign-in eligibility; application roles are enforced after
  // the session is established.
  return redirectTo(next);
}
