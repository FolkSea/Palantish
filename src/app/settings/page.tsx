import {
  listSubscriptions,
  subscriptionOptions,
} from "@/app/settings/subscription-actions";
import { redirect } from "next/navigation";
import { getAuthenticatedClient, isAdministrator } from "@/lib/auth";
import {
  SettingsView,
  type SettingsSource,
} from "@/components/settings/SettingsView";
import type { HiddenPost } from "@/components/settings/HiddenPanel";
import type { Focus } from "@/components/settings/AccountPanel";
import type { ActorRecord } from "@/lib/actor-catalogue";
import { listManagedUsers } from "@/lib/user-management";
import { SiteHeader } from "@/components/SiteHeader";
import { readingPrefsFrom } from "@/lib/reading-prefs";

export const dynamic = "force-dynamic";
// A single-feed update can run inline, so allow the same budget as the cron.
export const maxDuration = 300;

export default async function SettingsPage() {
  const auth = await getAuthenticatedClient();
  if (!auth) redirect("/login");
  const { supabase, user, role } = auth;
  const administrator = isAdministrator(role);
  const users = administrator ? await listManagedUsers() : [];

  const { data: sources } = administrator
    ? await supabase
        .from("sources")
        .select(
          "id, name, url, category, feed_type, feed_url, active, posts_kept, posts_dropped",
        )
        .order("name")
    : { data: [] };

  const { data: actors } = await supabase
    .from("adversaries")
    .select("id, name, motivation, country, community_identifiers, description")
    .order("name");

  const droppedCutoff = new Date(
    // eslint-disable-next-line react-hooks/purity
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: droppedRows } = administrator
    ? await supabase
        .from("dropped_items")
        .select("raw_hash, title, url, source_name, reason, created_at")
        .gte("created_at", droppedCutoff)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] };
  const dropped = (droppedRows ?? []).map((d) => ({
    rawHash: d.raw_hash,
    title: d.title,
    url: d.url,
    sourceName: d.source_name,
    reason: d.reason,
    droppedAt: d.created_at,
  }));

  const { data: memoryRows } = administrator
    ? await supabase
        .from("analyst_memory")
        .select("kind, subject, content, mentions, last_seen")
        .order("last_seen", { ascending: false })
        .limit(500)
    : { data: [] };
  // Subscriptions are per-user and always available, whatever the role.
  const [subscriptions, subOptions] = await Promise.all([
    listSubscriptions(),
    subscriptionOptions(),
  ]);

  const memory = (memoryRows ?? []).map((m) => ({
    kind: m.kind as "adversary" | "trend",
    subject: m.subject,
    content: m.content,
    mentions: m.mentions,
    lastSeen: m.last_seen,
  }));

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ?? "";
  const focus = ((user?.user_metadata?.focus as string | undefined) ??
    "all") as Focus;

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
    const { data: intelRows } = await supabase
      .from("intel_items")
      .select("raw_hash, title, url, source_name, published_at")
      .in("raw_hash", hashes);
    for (const r of intelRows ?? [])
      byHash.set(r.raw_hash, {
        title: r.title,
        url: r.url,
        sourceName: r.source_name,
        publishedAt: r.published_at,
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
      <SiteHeader />

      <div className="mb-4">
        <h1 className="text-[18px] font-semibold text-slate-900">Settings</h1>
        <p className="mt-0.5 text-[12px] text-slate-500">
          Manage your account, users, and intelligence sources.
        </p>
      </div>

      <SettingsView
        email={user?.email ?? ""}
        role={role}
        displayName={displayName}
        focus={focus}
        sources={(sources ?? []) as SettingsSource[]}
        users={users}
        actors={(actors ?? []) as ActorRecord[]}
        hidden={hidden}
        dropped={dropped}
        memory={memory}
        reading={readingPrefsFrom(user?.user_metadata)}
        subscriptions={subscriptions}
        subscriptionOptions={subOptions}
      />
    </div>
  );
}
