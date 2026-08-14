// Reading the session a sign-in link hands back in the URL fragment.
//
// Supabase can return a session two ways. A link the application itself sent
// comes back as a query parameter the server can read (?token_hash= or ?code=).
// A link that goes through the project's own verify endpoint - an invitation
// sent from the Supabase dashboard, a password recovery, anything using the
// default email template - comes back as a URL *fragment*:
//
//   https://app.example/#access_token=...&refresh_token=...&type=invite
//
// A fragment is never sent to the server. So the request arrives with no
// session and no parameters, the middleware sees an anonymous visitor, and
// redirects to the sign-in page - which is exactly what an invited user saw:
// the link "worked", and put them back where they started. Only the browser can
// read a fragment, so only the browser can finish that sign-in.
//
// Pure, so the parsing is tested without a browser.

export type AuthFragment =
  | {
      kind: "session";
      accessToken: string;
      refreshToken: string;
      /** invite | recovery | magiclink | signup - decides where they land. */
      type: string | null;
    }
  | { kind: "error"; message: string };

/**
 * Our words for a failure, chosen by Supabase's code.
 *
 * Deliberately not Supabase's own error_description, which is friendlier: it
 * arrives in a URL, so whoever writes the URL writes the message. A link is a
 * thing people are sent, and a sign-in page that will print any sentence handed
 * to it is a page that can be made to say "call this number to reactivate your
 * account". An unknown code gets the generic line instead.
 */
const AUTH_ERROR_COPY: Record<string, string> = {
  otp_expired: "That sign-in link has expired. Request a new one below.",
  access_denied: "That sign-in link has already been used, or has expired.",
  invalid_link: "That sign-in link was invalid or has expired.",
  server_error: "The sign-in service could not be reached. Try again.",
  unauthorized_client: "That sign-in link was not issued for this application.",
};

export function authErrorMessage(code: string | null | undefined): string {
  return (
    AUTH_ERROR_COPY[(code ?? "").trim().toLowerCase()] ??
    "That sign-in link did not work. Request a new one below."
  );
}

/**
 * What a URL fragment says about a sign-in, or null when it says nothing about
 * one - in which case whatever the fragment is for, it is not this.
 */
export function parseAuthFragment(hash: string): AuthFragment | null {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);

  if (params.has("error") || params.has("error_description")) {
    return {
      kind: "error",
      message: authErrorMessage(params.get("error_code") ?? params.get("error")),
    };
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;

  return {
    kind: "session",
    accessToken,
    refreshToken,
    type: params.get("type"),
  };
}

/**
 * Where to send someone once the session is established.
 *
 * An invitation is somebody's first time in, and they have no password yet -
 * account settings is where they can set one. Everyone else wants the
 * dashboard.
 */
export function landingFor(type: string | null): string {
  return type === "invite" || type === "recovery"
    ? "/settings?tab=account"
    : "/";
}
