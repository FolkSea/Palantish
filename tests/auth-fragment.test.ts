import { describe, it, expect } from "vitest";
import {
  parseAuthFragment,
  landingFor,
  authErrorMessage,
} from "@/lib/auth-fragment";

describe("parseAuthFragment", () => {
  // The case this exists for: an invitation sent from the Supabase dashboard
  // comes back with the session in the fragment, which the server never sees.
  it("reads the session an invitation link returns", () => {
    const f = parseAuthFragment(
      "#access_token=eyJhbG.abc&expires_in=3600&refresh_token=r-123&token_type=bearer&type=invite",
    );
    expect(f).toEqual({
      kind: "session",
      accessToken: "eyJhbG.abc",
      refreshToken: "r-123",
      type: "invite",
    });
  });

  it("copes with the fragment written without its hash", () => {
    expect(parseAuthFragment("access_token=a&refresh_token=b")).toMatchObject({
      kind: "session",
      type: null,
    });
  });

  it("says nothing about a fragment that is not a sign-in", () => {
    expect(parseAuthFragment("")).toBeNull();
    expect(parseAuthFragment("#section-3")).toBeNull();
    // Half a session is not a session: setSession needs both tokens.
    expect(parseAuthFragment("#access_token=a&type=invite")).toBeNull();
  });

  it("reports a link Supabase already rejected", () => {
    const f = parseAuthFragment(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(f).toEqual({
      kind: "error",
      message: "That sign-in link has expired. Request a new one below.",
    });
  });

  // The message arrives in a URL, so whoever writes the URL writes the message.
  it("never repeats the description it was handed", () => {
    const f = parseAuthFragment(
      "#error=access_denied&error_code=weird&error_description=Call+555+0100+to+reactivate",
    );
    expect(f?.kind).toBe("error");
    expect(f && "message" in f && f.message).not.toMatch(/555/);
  });
});

describe("authErrorMessage", () => {
  it("uses our own words for a code we know", () => {
    expect(authErrorMessage("otp_expired")).toMatch(/expired/i);
    expect(authErrorMessage("OTP_EXPIRED")).toMatch(/expired/i);
  });

  it("falls back rather than showing a code to a person", () => {
    expect(authErrorMessage("something_new")).toMatch(/did not work/i);
    expect(authErrorMessage(null)).toMatch(/did not work/i);
  });
});

describe("landingFor", () => {
  // An invited user has no password yet, and account settings is where one is
  // set - dropping them on the dashboard leaves them unable to sign in again
  // except by asking for another link.
  it("sends an invitation to account settings", () => {
    expect(landingFor("invite")).toBe("/settings?tab=account");
    expect(landingFor("recovery")).toBe("/settings?tab=account");
  });

  it("sends everyone else to the dashboard", () => {
    expect(landingFor("magiclink")).toBe("/");
    expect(landingFor(null)).toBe("/");
  });
});
