"use client";

import { useState } from "react";
import { AccountPanel, type Focus } from "./AccountPanel";
import { SourcesPanel } from "./SourcesPanel";
import { HiddenPanel, type HiddenPost } from "./HiddenPanel";
import { ActorsPanel } from "./ActorsPanel";
import { DroppedPanel, type DroppedItem } from "./DroppedPanel";
import type { SourceCategory, FeedType } from "@/app/settings/actions";
import type { ActorRecord } from "@/lib/actor-catalogue";

export type SettingsSource = {
  id: string;
  name: string;
  url: string | null;
  category: SourceCategory;
  feed_type: FeedType;
  feed_url: string | null;
  active: boolean;
};

type Tab = "account" | "sources" | "actors" | "hidden" | "dropped";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "account", label: "Account", hint: "Display name and password" },
  { id: "sources", label: "Sources", hint: "Add, edit, or delete feeds" },
  { id: "actors", label: "Actors", hint: "Threat actor catalogue" },
  { id: "hidden", label: "Hidden posts", hint: "Unhide posts you hid" },
  { id: "dropped", label: "Dropped", hint: "Review filtered-out candidates" },
];

export function SettingsView({
  email,
  displayName,
  focus,
  sources,
  actors,
  hidden,
  dropped,
}: {
  email: string;
  displayName: string;
  focus: Focus;
  sources: SettingsSource[];
  actors: ActorRecord[];
  hidden: HiddenPost[];
  dropped: DroppedItem[];
}) {
  const [tab, setTab] = useState<Tab>("account");

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
      <nav className="rounded-[10px] border border-[#e5e7eb] bg-white p-2">
        <ul className="space-y-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setTab(t.id)}
                className={`w-full rounded-md px-3 py-2 text-left transition ${
                  tab === t.id ? "bg-slate-900 text-white" : "hover:bg-slate-50"
                }`}
              >
                <span className="block text-[13px] font-medium">{t.label}</span>
                <span
                  className={`block text-[11px] ${
                    tab === t.id ? "text-slate-300" : "text-slate-400"
                  }`}
                >
                  {t.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        {tab === "account" ? (
          <AccountPanel
            email={email}
            displayName={displayName}
            focus={focus}
          />
        ) : tab === "sources" ? (
          <SourcesPanel initialSources={sources} />
        ) : tab === "actors" ? (
          <ActorsPanel initialActors={actors} />
        ) : tab === "hidden" ? (
          <HiddenPanel initialHidden={hidden} />
        ) : (
          <DroppedPanel initial={dropped} />
        )}
      </div>
    </div>
  );
}
