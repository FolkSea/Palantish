// Lightweight timestamped logging for the ingest pipeline so a run shows which
// feeds and items are processed, and which items go to the LLM vs the local
// rules. On by default; set INGEST_LOG=0 to silence (e.g. to keep cron quiet).
const ENABLED = process.env.INGEST_LOG !== "0";

export function ilog(message: string): void {
  if (ENABLED) console.log(`[${new Date().toISOString()}] ${message}`);
}
