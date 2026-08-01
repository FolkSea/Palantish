/**
 * Local-only passwordless sign-in helper.
 *
 *   pnpm dev:login                 # prints an /auth/confirm URL for localhost
 *   pnpm dev:login http://host:port
 *
 * Uses the local Supabase service-role key to ensure a throwaway dev user exists
 * and mint a magic-link token, then prints the app's /auth/confirm URL. Opening
 * that URL establishes an authenticated session (the confirm route verifies the
 * token and sets the cookie) - no password is entered anywhere. Refuses to run
 * against a non-local Supabase project.
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const APP_URL = process.argv[2] ?? process.env.APP_URL ?? "http://localhost:3000";
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.DEV_LOGIN_EMAIL ?? "ccdev@local.test";

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(SUPABASE_URL)) {
    console.error(
      `dev:login is local-only; refusing non-local Supabase URL: ${SUPABASE_URL}`,
    );
    process.exit(1);
  }
  if (!SERVICE_KEY) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY (check .env.local).");
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await db.auth.admin
    .createUser({ email: EMAIL, email_confirm: true, password: randomUUID() })
    .catch(() => {});

  const { data, error } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (error || !data) {
    console.error("generateLink failed:", error?.message ?? "unknown error");
    process.exit(1);
  }
  const { hashed_token, verification_type } = data.properties;
  const url = `${APP_URL}/auth/confirm?token_hash=${hashed_token}&type=${verification_type}`;
  console.log(url);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
