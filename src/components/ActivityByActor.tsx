"use client";

import { useState } from "react";
import type { ActorWithItems, ActorItem } from "@/lib/data";
import type { ActorGroupCard, ActorReport } from "@/lib/actor-sections";
import type { Focus } from "@/components/settings/AccountPanel";
import {
  AdversaryBadge,
  ConfidenceBadge,
  SourceBadge,
  StatusPill,
} from "@/components/Badges";
import { ExtLink } from "@/components/ExtLink";
import { ItemActions } from "@/components/ItemActions";
import { NEXUS_ACCENT, type Nexus } from "@/lib/badges";
import { formatDate } from "@/lib/format";

const ECRIME_ACCENT = NEXUS_ACCENT.other; // slate
const HACKTIVISM_ACCENT = "#7e22ce"; // purple

/** Event dates are ISO; breach labels ("27 Jul") pass through unformatted. */
function displayDate(d: string | null): string {
  if (!d) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? formatDate(d) : d;
}

export function ActivityByActor({
  nationStateActors,
  ecrimeCards,
  hacktivismCards,
  focus,
}: {
  nationStateActors: ActorWithItems[];
  ecrimeCards: ActorGroupCard[];
  hacktivismCards: ActorGroupCard[];
  focus: Focus;
}) {
  const nsCount = nationStateActors.reduce((n, a) => n + a.items.length, 0);
  const ecCount = ecrimeCards.reduce((n, c) => n + c.items.length, 0);
  const hkCount = hacktivismCards.reduce((n, c) => n + c.items.length, 0);

  // A section starts expanded when the user's focus is "all" or that section.
  const startsOpen = (which: Focus) => focus === "all" || focus === which;

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold text-slate-900">
        Activity by actor
      </h2>
      <div className="space-y-3">
        <CollapsibleSection
          title="Nation State"
          count={nsCount}
          defaultOpen={startsOpen("nation_state")}
        >
          <CardGrid>
            {nationStateActors.map((a) => (
              <ActorCard key={a.id} actor={a} />
            ))}
          </CardGrid>
        </CollapsibleSection>

        <CollapsibleSection
          title="eCrime"
          count={ecCount}
          defaultOpen={startsOpen("ecrime")}
        >
          {ecrimeCards.length ? (
            <CardGrid>
              {ecrimeCards.map((c) => (
                <GroupCard key={c.name} card={c} accent={ECRIME_ACCENT} />
              ))}
            </CardGrid>
          ) : (
            <Empty>No eCrime activity in the current window.</Empty>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Hacktivism"
          count={hkCount}
          defaultOpen={startsOpen("hacktivism")}
        >
          {hacktivismCards.length ? (
            <CardGrid>
              {hacktivismCards.map((c) => (
                <GroupCard key={c.name} card={c} accent={HACKTIVISM_ACCENT} />
              ))}
            </CardGrid>
          ) : (
            <Empty>No hacktivism activity in the current window.</Empty>
          )}
        </CollapsibleSection>
      </div>
    </section>
  );
}

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-2">
          <svg
            className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-[13px] font-semibold text-slate-900">
            {title}
          </span>
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
          {count} report{count === 1 ? "" : "s"}
        </span>
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-6 text-center text-[12px] text-slate-400">
      {children}
    </div>
  );
}

function ActorCard({ actor }: { actor: ActorWithItems }) {
  const accent = NEXUS_ACCENT[actor.nexus as Nexus] ?? "#475569";
  return (
    <div className="flex flex-col rounded-[10px] border border-[#e5e7eb] bg-white">
      <div
        className="rounded-t-[10px] border-b border-[#e5e7eb] px-4 py-2.5"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            {actor.display_name}
          </h3>
          <StatusPill status={actor.status} />
        </div>
        {actor.tracked_groups ? (
          <p className="mt-1 text-[11px] text-slate-500">
            Tracked: {actor.tracked_groups}
          </p>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 px-4 py-3">
        {actor.items.length === 0 ? (
          <p className="text-[12px] text-slate-400">
            {actor.note ?? "No new reporting in the current window."}
          </p>
        ) : (
          actor.items.map((item) => <ActorEntry key={item.id} item={item} />)
        )}
      </div>

      {actor.items.length > 0 && actor.note ? (
        <div className="border-t border-[#e5e7eb] px-4 py-2 text-[11px] italic text-slate-500">
          {actor.note}
        </div>
      ) : null}
    </div>
  );
}

function ActorEntry({ item }: { item: ActorItem }) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-none last:pb-0">
      <ExtLink href={item.url}>{item.title}</ExtLink>
      {item.description ? (
        <p className="mt-1 text-[12px] leading-snug text-slate-600">
          {item.description}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <ConfidenceBadge value={item.confidence} />
        <AdversaryBadge name={item.adversary} />
        <SourceBadge name={item.source_name} />
        {item.published_at ? (
          <span className="text-[10px] text-slate-400">
            {formatDate(item.published_at)}
          </span>
        ) : null}
        <span className="ml-auto">
          <ItemActions rawHash={item.raw_hash} />
        </span>
      </div>
    </div>
  );
}

function GroupCard({ card, accent }: { card: ActorGroupCard; accent: string }) {
  return (
    <div className="flex flex-col rounded-[10px] border border-[#e5e7eb] bg-white">
      <div
        className="rounded-t-[10px] border-b border-[#e5e7eb] px-4 py-2.5"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            {card.name}
          </h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {card.items.length}
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-3 px-4 py-3">
        {card.items.map((r) => (
          <GroupItem key={r.id} report={r} actor={card.name} />
        ))}
      </div>
    </div>
  );
}

function GroupItem({
  report,
  actor,
}: {
  report: ActorReport;
  actor: string;
}) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-none last:pb-0">
      <ExtLink href={report.url}>{report.title}</ExtLink>
      {report.description ? (
        <p className="mt-1 text-[12px] leading-snug text-slate-600">
          {report.description}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {/* Attributed items carry the actor as a red label ("Unattributed" has none). */}
        <AdversaryBadge name={actor === "Unattributed" ? null : actor} />
        <SourceBadge name={report.sourceName} />
        {report.date ? (
          <span className="text-[10px] text-slate-400">
            {displayDate(report.date)}
          </span>
        ) : null}
        <span className="ml-auto">
          <ItemActions rawHash={report.rawHash} />
        </span>
      </div>
    </div>
  );
}
