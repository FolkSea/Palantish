import Link from "next/link";
import type { Metadata } from "next";
import { loadFeed, FEED_SECTION_LIMIT } from "@/lib/feed";
import { FeedResults } from "@/components/FeedResults";

// Always current: the feed reflects what has been ingested and what the user
// subscribes to, both of which change under it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Personal Feed",
  description: "Reports matching your subscriptions.",
};

const KIND_CHIP: Record<string, string> = {
  label: "bg-violet-100 text-violet-700",
  adversary: "bg-red-100 text-red-700",
  country: "bg-emerald-100 text-emerald-700",
};

export default async function FeedPage() {
  const feed = await loadFeed();
  const total = feed.reports.length + feed.breaches.length + feed.vulns.length;
  const capped =
    feed.reports.length === FEED_SECTION_LIMIT ||
    feed.breaches.length === FEED_SECTION_LIMIT ||
    feed.vulns.length === FEED_SECTION_LIMIT;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-900">Personal Feed</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Reports matching your subscriptions, newest first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#1d4ed8] hover:bg-slate-50"
          >
            Manage subscriptions
          </Link>
          <Link
            href="/"
            className="rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      {feed.subscriptions.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            Following
          </span>
          {feed.subscriptions.map((s) => (
            <span
              key={`${s.kind}:${s.value}`}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                KIND_CHIP[s.kind] ?? "bg-slate-100 text-slate-700"
              }`}
            >
              {s.value}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
        {feed.subscriptions.length === 0 ? (
          <div className="text-[13px] text-slate-500">
            <p>You are not subscribed to anything yet.</p>
            <p className="mt-1">
              Pick the labels, adversaries and countries you care about in{" "}
              <Link href="/settings" className="text-[#1d4ed8] hover:underline">
                Settings
              </Link>
              . They drive this page and your email digests.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              {total} matching report{total === 1 ? "" : "s"}
            </p>
            {feed.truncated ? (
              <p className="mt-1 text-[11px] text-amber-700">
                Matched against the most recent reports only; older ones were not
                covered.
              </p>
            ) : null}
            {capped ? (
              <p className="mt-1 text-[11px] text-amber-700">
                Showing the newest {FEED_SECTION_LIMIT} per section.
              </p>
            ) : null}
            <FeedResults feed={feed} />
          </>
        )}
      </div>
    </div>
  );
}
