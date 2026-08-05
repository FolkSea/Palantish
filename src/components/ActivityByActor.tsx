"use client";

import { useState } from "react";
import { CARD_PAGE_SIZE } from "@/lib/page";
import type { ActorCard, ActorItem, ActorSection } from "@/lib/data";
import { actorCardPageAction } from "@/app/dashboard-actions";
import type { Focus } from "@/components/settings/AccountPanel";
import {
  AdversaryBadge,
  ConfidenceBadge,
  SourceBadge,
} from "@/components/Badges";
import { ItemActions } from "@/components/ItemActions";
import { LabelChips } from "@/components/LabelChips";
import { adversaryHref, sourceHref } from "@/lib/browse-links";
import { ReportTitle } from "@/components/ReportDetail";
import { useServerPaginated, type Paged } from "@/components/Pagination";
import { formatDate } from "@/lib/format";

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
  nationStateCards: ActorCard[];
  ecrimeCards: ActorCard[];
  hacktivismCards: ActorCard[];
  focus: Focus;
}) {
  // Totals, not what is on show: each card ships one page of its reports.
  const nsCount = nationStateCards.reduce((n, c) => n + c.total, 0);
  const ecCount = ecrimeCards.reduce((n, c) => n + c.total, 0);
  const hkCount = hacktivismCards.reduce((n, c) => n + c.total, 0);

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
                <ActorCardView key={c.key} card={c} section="nation_state" />
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
                <ActorCardView key={c.key} card={c} section="ecrime" />
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
                <ActorCardView key={c.key} card={c} section="hacktivism" />
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

function ActorCardView({
  card,
  section,
}: {
  card: ActorCard;
  section: ActorSection;
}) {
  const p = useServerPaginated(
    { rows: card.items, total: card.total },
    (page, size) => actorCardPageAction(section, card.key, page, size),
    CARD_PAGE_SIZE,
  );
  return (
    <div className="flex flex-col rounded-[10px] border border-[#e5e7eb] bg-white">
      <div
        className="rounded-t-[10px] border-b border-[#e5e7eb] px-4 py-2.5"
        style={{ borderTop: `3px solid ${card.accent}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            {card.label}
          </h3>
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              {card.total}
            </span>
            {card.flag ? (
              <span className="text-[18px] leading-none">{card.flag}</span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-3 px-4 py-3">
        {p.pageItems.map((item) => (
          <ActorEntry key={item.id} item={item} />
        ))}
      </div>

      {card.total > CARD_PAGE_SIZE ? <CardPager p={p} /> : null}
    </div>
  );
}

function CardPager({ p }: { p: Paged<ActorItem> }) {
  const btn =
    "rounded border border-[#e5e7eb] bg-white px-1.5 py-0.5 font-medium text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40";
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
      <span>
        {p.start + 1}-{p.end} of {p.total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={btn}
          disabled={p.page <= 0}
          onClick={() => p.setPage(p.page - 1)}
        >
          Prev
        </button>
        <span>
          {p.page + 1}/{p.pageCount}
        </span>
        <button
          type="button"
          className={btn}
          disabled={p.page >= p.pageCount - 1}
          onClick={() => p.setPage(p.page + 1)}
        >
          Next
        </button>
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
          country: item.country,
          confidence: item.confidence,
          rawHash: item.raw_hash,
        }}
      />
      <LabelChips labels={item.labels} className="mt-1" />
      {item.description ? (
        <p className="mt-1 text-[12px] leading-snug text-slate-600">
          {item.description}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <ConfidenceBadge value={item.confidence} />
        <AdversaryBadge
          name={item.adversary}
          href={adversaryHref(item.adversary ?? "")}
        />
        <SourceBadge
          name={item.source_name}
          href={sourceHref(item.source_name ?? "")}
        />
        {item.published_at ? (
          <span className="text-[10px] text-slate-400">
            {displayDate(item.published_at)}
          </span>
        ) : null}
        <span className="ml-auto">
          <ItemActions rawHash={item.raw_hash} intelItemId={item.id} />
        </span>
      </div>
    </div>
  );
}
