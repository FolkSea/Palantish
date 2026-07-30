"use client";

import { useState } from "react";
import type { NationStateCard, ActorItem } from "@/lib/data";
import type { ActorGroupCard, ActorReport } from "@/lib/actor-sections";
import type { Focus } from "@/components/settings/AccountPanel";
import {
  AdversaryBadge,
  ConfidenceBadge,
  SourceBadge,
} from "@/components/Badges";
import { ItemActions } from "@/components/ItemActions";
import { ReportTitle } from "@/components/ReportModal";
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
  nationStateCards,
  ecrimeCards,
  hacktivismCards,
  focus,
}: {
  nationStateCards: NationStateCard[];
  ecrimeCards: ActorGroupCard[];
  hacktivismCards: ActorGroupCard[];
  focus: Focus;
}) {
  const nsCount = nationStateCards.reduce((n, c) => n + c.items.length, 0);
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
          {nationStateCards.length ? (
            <CardGrid>
              {nationStateCards.map((c) => (
                <CountryCard key={c.key} card={c} />
              ))}
            </CardGrid>
          ) : (
            <Empty>No nation-state activity in the current window.</Empty>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="eCrime"
          count={ecCount}
          defaultOpen={startsOpen("ecrime")}
        >
          {ecrimeCards.length ? (
            <CardGrid>
              {ecrimeCards.map((c) => (
                <GroupCard
                  key={c.name}
                  card={c}
                  accent={ECRIME_ACCENT}
                  unattributedLabel="UNID SPIDER"
                />
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

function CountryCard({ card }: { card: NationStateCard }) {
  const accent = NEXUS_ACCENT[card.nexus as Nexus] ?? "#475569";
  return (
    <div className="flex flex-col rounded-[10px] border border-[#e5e7eb] bg-white">
      <div
        className="rounded-t-[10px] border-b border-[#e5e7eb] px-4 py-2.5"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            {card.label}
          </h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {card.items.length}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-3 px-4 py-3">
        {card.items.map((item) => (
          <ActorEntry key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function ActorEntry({ item }: { item: ActorItem }) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-none last:pb-0">
      <ReportTitle
        report={{
          title: item.title,
          url: item.url,
          description: item.description,
          sourceName: item.source_name,
          date: item.published_at,
          adversary: item.adversary,
          confidence: item.confidence,
          rawHash: item.raw_hash,
        }}
      />
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

function GroupCard({
  card,
  accent,
  unattributedLabel = null,
}: {
  card: ActorGroupCard;
  accent: string;
  unattributedLabel?: string | null;
}) {
  // Named cards label items with the crew/collective; the Unattributed card
  // uses the section fallback (e.g. UNID SPIDER for eCrime) when provided.
  const actorLabel = card.name === "Unattributed" ? unattributedLabel : card.name;
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
          <GroupItem key={r.id} report={r} actor={actorLabel} />
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
  actor: string | null;
}) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-none last:pb-0">
      <ReportTitle
        report={{
          title: report.title,
          url: report.url,
          description: report.description,
          sourceName: report.sourceName,
          date: report.date,
          adversary: actor,
          rawHash: report.rawHash,
        }}
      />
      {report.description ? (
        <p className="mt-1 text-[12px] leading-snug text-slate-600">
          {report.description}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {/* Attributed items carry the actor as a red label. */}
        <AdversaryBadge name={actor} />
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
