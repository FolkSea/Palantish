import { NextResponse, after, type NextRequest } from "next/server";
import { runIngest } from "@/lib/ingest/pipeline";
import { serverEnv } from "@/lib/env";
import { triggerIngestRun } from "@/lib/ingest/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the pipeline up to 5 minutes

// A run stops on its time budget well before a day's backlog is drained, and the
// cron can only fire once a day, so a run that deferred candidates triggers the
// next one itself. Bounded so a bug (or a permanently stuck candidate) cannot
// loop forever - each hop costs LLM calls. Override with INGEST_MAX_CHAIN.
const MAX_CHAIN = Number(process.env.INGEST_MAX_CHAIN) || 10;

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

/** Run the pipeline, then chain another run if candidates were deferred. */
async function runAndMaybeChain(req: NextRequest, chain: number) {
  const result = await runIngest();
  const deferred = result.deferred ?? 0;
  if (result.status === "success" && deferred > 0) {
    if (chain + 1 > MAX_CHAIN) {
      // Not an error: the remainder simply waits for the next scheduled run.
      console.warn(
        `[ingest] chain limit ${MAX_CHAIN} reached with ${deferred} candidates ` +
          `still deferred; leaving them for the next scheduled run`,
      );
    } else {
      try {
        await triggerIngestRun(req.nextUrl.origin, chain + 1);
      } catch (err) {
        // A broken chain just means the backlog waits for the next cron.
        console.warn(
          `[ingest] could not chain the next run: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
  return result;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const chain = Number(req.headers.get("x-ingest-chain") ?? "0") || 0;

  // Background mode (used by the chain): acknowledge immediately and run after
  // the response, so the caller is not held open for this run's duration.
  if (req.headers.get("x-ingest-background") === "1") {
    after(() => runAndMaybeChain(req, chain));
    return NextResponse.json({ status: "started", chain }, { status: 202 });
  }

  const result = await runAndMaybeChain(req, chain);
  const status = result.status === "success" ? 200 : 500;
  return NextResponse.json({ ...result, chain }, { status });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// Vercel Cron issues GET requests; support both.
export async function GET(req: NextRequest) {
  return handle(req);
}
