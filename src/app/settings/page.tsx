import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  SettingsView,
  type SettingsSource,
} from "@/components/settings/SettingsView";
import type { HiddenPost } from "@/components/settings/HiddenPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: sources } = await supabase
    .from("sources")
    .select("id, name, url, category, feed_type, feed_url, active")
    .order("category")
    .order("name");

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ?? "";

  // Current user's hidden posts (RLS-scoped), joined with the item details.
  const { data: hiddenRows } = await supabase
    .from("hidden_items")
    .select("raw_hash, created_at")
    .order("created_at", { ascending: false });
  const hashes = (hiddenRows ?? []).map((h) => h.raw_hash);
  // A hidden hash may point at an intel item, a breach, or a vulnerability;
  // resolve display fields from whichever table holds it.
  const byHash = new Map<
    string,
    {
      title: string | null;
      url: string | null;
      sourceName: string | null;
      publishedAt: string | null;
    }
  >();
  if (hashes.length) {
    const [intelRows, breachRows, vulnRows] = await Promise.all([
      supabase
        .from("intel_items")
        .select("raw_hash, title, url, source_name, published_at")
        .in("raw_hash", hashes),
      supabase
        .from("breaches")
        .select("raw_hash, org_name, url, source_name, event_date")
        .in("raw_hash", hashes),
      supabase
        .from("vulnerabilities")
        .select("raw_hash, cve_id, url, source_name, added_at")
        .in("raw_hash", hashes),
    ]);
    for (const r of intelRows.data ?? [])
      byHash.set(r.raw_hash, {
        title: r.title,
        url: r.url,
        sourceName: r.source_name,
        publishedAt: r.published_at,
      });
    for (const r of breachRows.data ?? [])
      if (!byHash.has(r.raw_hash))
        byHash.set(r.raw_hash, {
          title: r.org_name,
          url: r.url,
          sourceName: r.source_name,
          publishedAt: r.event_date,
        });
    for (const r of vulnRows.data ?? [])
      if (!byHash.has(r.raw_hash))
        byHash.set(r.raw_hash, {
          title: r.cve_id,
          url: r.url,
          sourceName: r.source_name,
          publishedAt: r.added_at,
        });
  }
  const hidden: HiddenPost[] = (hiddenRows ?? []).map((h) => {
    const it = byHash.get(h.raw_hash);
    return {
      rawHash: h.raw_hash,
      hiddenAt: h.created_at,
      title: it?.title ?? null,
      url: it?.url ?? null,
      sourceName: it?.sourceName ?? null,
      publishedAt: it?.publishedAt ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Settings</h1>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Manage your account and the intelligence sources.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
        >
          Back to dashboard
        </Link>
      </header>

      <SettingsView
        email={user?.email ?? ""}
        displayName={displayName}
        sources={(sources ?? []) as SettingsSource[]}
        hidden={hidden}
      />
    </div>
  );
}
