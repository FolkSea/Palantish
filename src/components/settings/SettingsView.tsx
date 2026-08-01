"use client";

import { useState } from "react";
import { AccountPanel, type Focus } from "./AccountPanel";
import { SourcesPanel } from "./SourcesPanel";
import { HiddenPanel, type HiddenPost } from "./HiddenPanel";
import { ActorsPanel } from "./ActorsPanel";
import { DroppedPanel, type DroppedItem } from "./DroppedPanel";
import { AgentMemoryPanel, type AgentMemoryNote } from "./AgentMemoryPanel";
import { UsersPanel } from "./UsersPanel";
import type { SourceCategory, FeedType } from "@/app/settings/actions";
import type { ActorRecord } from "@/lib/actor-catalogue";
import type { AccountRole } from "@/lib/account-role";
import type { ManagedUser } from "@/lib/user-management-types";

export type SettingsSource = {
  id: string;
  name: string;
  url: string | null;
  category: SourceCategory;
  feed_type: FeedType;
  feed_url: string | null;
  active: boolean;
  posts_kept: number;
  posts_dropped: number;
};

type Tab =
  | "account"
  | "users"
  | "sources"
  | "actors"
  | "hidden"
  | "dropped"
  | "memory";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "account", label: "Account", hint: "Display name and password" },
  { id: "users", label: "Users", hint: "Accounts and access levels" },
  { id: "sources", label: "Feeds", hint: "Add, edit, or delete feeds" },
  { id: "actors", label: "Actors", hint: "Threat actor catalogue" },
  { id: "hidden", label: "Hidden posts", hint: "Unhide posts you hid" },
  { id: "dropped", label: "Dropped", hint: "Review filtered-out candidates" },
  { id: "memory", label: "Agent memory", hint: "What the analyst agent knows" },
];

export function SettingsView({
  email,
  role,
  displayName,
  focus,
  sources,
  users,
  actors,
  hidden,
  dropped,
  memory,
}: {
  email: string;
  role: AccountRole;
  displayName: string;
  focus: Focus;
  sources: SettingsSource[];
  users: ManagedUser[];
  actors: ActorRecord[];
  hidden: HiddenPost[];
  dropped: DroppedItem[];
  memory: AgentMemoryNote[];
}) {
  const [tab, setTab] = useState<Tab>("account");
  const tabs =
    role === "administrator"
      ? TABS
      : TABS.filter((item) =>
          !["users", "sources", "dropped", "memory"].includes(item.id),
        );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
      <nav className="rounded-[10px] border border-[#e5e7eb] bg-white p-2">
        <ul className="space-y-1">
          {tabs.map((t) => (
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
            role={role}
            displayName={displayName}
            focus={focus}
          />
        ) : tab === "users" && role === "administrator" ? (
          <UsersPanel initialUsers={users} />
        ) : tab === "sources" && role === "administrator" ? (
          <SourcesPanel initialSources={sources} />
        ) : tab === "actors" ? (
          <ActorsPanel initialActors={actors} />
        ) : tab === "hidden" ? (
          <HiddenPanel initialHidden={hidden} />
        ) : tab === "dropped" && role === "administrator" ? (
          <DroppedPanel initial={dropped} />
        ) : tab === "memory" && role === "administrator" ? (
          <AgentMemoryPanel notes={memory} />
        ) : null}
      </div>
    </div>
  );
}
