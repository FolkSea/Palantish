import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotifications } from "@/lib/notify/dispatch";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Drain the subscription queue into digest emails.
 *
 * The ingest run dispatches its own notifications, so this exists for what
 * happens between runs: a report relabelled or re-attributed by an analyst is
 * queued immediately but has nothing to carry it out until the next ingest,
 * which may be a day away. Guarded by the same shared secret as ingest.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = serverEnv.ingestCronSecret;
  const header = req.headers.get("x-ingest-secret");
  if (header && header === expected) return true;
  const auth = req.headers.get("authorization");
  return !!auth && auth === `Bearer ${expected}`;
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await dispatchNotifications(createAdminClient());
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dispatch failed." },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
