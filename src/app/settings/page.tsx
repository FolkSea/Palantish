import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  SettingsView,
  type SettingsSource,
} from "@/components/settings/SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: sources } = await supabase
    .from("sources")
    .select("id, name, url, category, feed_url, active")
    .order("category")
    .order("name");

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ?? "";

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
      />
    </div>
  );
}
