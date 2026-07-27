import { NextResponse, type NextRequest } from "next/server";
import { runIngest } from "@/lib/ingest/pipeline";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the pipeline up to 5 minutes

/**
 * Cron-triggered ingestion. Guarded by a shared secret in the
 * `x-ingest-secret` header (Vercel Cron sends it). Vercel Cron also sends an
 * `authorization: Bearer <CRON_SECRET>` header, which we accept as well.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = serverEnv.ingestCronSecret;
  const header = req.headers.get("x-ingest-secret");
  if (header && header === expected) return true;
  const auth = req.headers.get("authorization");
  if (auth && auth === `Bearer ${expected}`) return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runIngest();
  const status = result.status === "success" ? 200 : 500;
  return NextResponse.json(result, { status });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// Vercel Cron issues GET requests; support both.
export async function GET(req: NextRequest) {
  return handle(req);
}
