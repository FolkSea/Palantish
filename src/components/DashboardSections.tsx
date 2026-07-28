import { Card, EmptyState } from "@/components/Card";
import {
  ConfidenceBadge,
  CrowdStrikeBadge,
  SourceBadge,
  StatusPill,
} from "@/components/Badges";
import { ExtLink } from "@/components/ExtLink";
import { ItemActions } from "@/components/ItemActions";
import { NEXUS_ACCENT, type Nexus } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import type { ActorWithItems, BreachRow, IntelItemRow } from "@/lib/data";

/* --- Breaking news ticker -------------------------------------------------- */
export function Ticker({ items }: { items: IntelItemRow[] }) {
  // Only rendered when there are last-24h items; the caller passes an already
  // filtered list, and an empty list hides the whole section.
  if (!items.length) return null;

  const row = items.map((i) => (
    <span key={i.id} className="mx-5 inline-flex items-center gap-1.5">
      <span className="text-slate-400">{formatDate(i.published_at)}</span>
      <ExtLink href={i.url}>{i.title}</ExtLink>
    </span>
  ));

  return (
    <div className="ticker-pause flex items-center gap-3 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2 text-[12px]">
      <span className="z-10 shrink-0 rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        Breaking
      </span>
      <div className="relative flex-1 overflow-hidden">
        <div className="animate-ticker flex w-max items-center whitespace-nowrap">
          {/* Row is duplicated so the -50% marquee loops seamlessly. The copy
              is aria-hidden to avoid announcing every item twice. */}
          <div className="flex items-center">{row}</div>
          <div className="flex items-center" aria-hidden="true">
            {row}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- Activity by actor ---------------------------------------------------- */
export function ActorGrid({
  actors,
  ecrime,
}: {
  actors: ActorWithItems[];
  ecrime: BreachRow[];
}) {
  // Nation-state cards come from the four state actors; the "other" nexus is
  // rendered as a dedicated eCrime card fed from significant breach activity.
  const nationStates = actors.filter((a) => a.nexus !== "other");
  const ecrimeActor = actors.find((a) => a.nexus === "other");

  if (!nationStates.length && !ecrime.length)
    return (
      <Card title="Activity by actor">
        <EmptyState>No actor reporting loaded yet.</EmptyState>
      </Card>
    );

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold text-slate-900">
        Activity by actor
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {nationStates.map((a) => (
          <ActorCard key={a.id} actor={a} />
        ))}
        <EcrimeCard items={ecrime} trackedGroups={ecrimeActor?.tracked_groups} />
      </div>
    </section>
  );
}

/* Most significant eCrime activity - built from recent large-scale breach and
   ransomware/extortion reporting, shown alongside the nation-state actors. */
function EcrimeCard({
  items,
  trackedGroups,
}: {
  items: BreachRow[];
  trackedGroups?: string | null;
}) {
  const accent = NEXUS_ACCENT.other;
  return (
    <div className="flex flex-col rounded-[10px] border border-[#e5e7eb] bg-white">
      <div
        className="rounded-t-[10px] border-b border-[#e5e7eb] px-4 py-2.5"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            eCrime (most significant)
          </h3>
          <StatusPill status={items.length > 0 ? "active" : "quiet"} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Tracked: {trackedGroups ?? "Large-scale ransomware, extortion, and eCrime clusters"}
        </p>
      </div>

      <div className="flex-1 space-y-3 px-4 py-3">
        {items.length === 0 ? (
          <p className="text-[12px] text-slate-400">
            No new reporting in the current window.
          </p>
        ) : (
          items.map((b) => (
            <div
              key={b.id}
              className="border-b border-slate-100 pb-3 last:border-none last:pb-0"
            >
              <ExtLink href={b.url}>{b.org_name}</ExtLink>
              {b.summary ? (
                <p className="mt-1 text-[12px] leading-snug text-slate-600">
                  {b.summary}
                </p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <SourceBadge name={b.source_name} />
                <span className="text-[10px] text-slate-400">
                  {b.event_date_label ?? formatDate(b.event_date)}
                </span>
                <span className="ml-auto">
                  <ItemActions rawHash={b.raw_hash} />
                </span>
              </div>
            </div>
          ))
        )}
      </div>
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

function ActorEntry({ item }: { item: IntelItemRow }) {
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
        <CrowdStrikeBadge name={item.crowdstrike_adversary} />
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

/* --- Footnote / methodology legend ---------------------------------------- */
export function Footnote() {
  return (
    <footer className="rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-[11px] leading-relaxed text-slate-500">
      <p className="font-semibold text-slate-700">Methodology and legend</p>
      <ul className="mt-2 space-y-1">
        <li>
          <b>Confidence.</b> CONFIRMED: corroborated by a named vendor/government
          report. SUSPECTED: single-source or provisional attribution. POC:
          proof-of-concept or not yet observed exploited in the wild.
        </li>
        <li>
          <b>CS badge.</b> CrowdStrike adversary cryptonym where a public mapping
          exists. Nation-state suffixes: Panda (China), Bear (Russia), Chollima
          (North Korea), Kitten (Iran), Spider (eCrime).
        </li>
        <li>
          <b>Source badge.</b> Originating vendor, research, news, or government
          publication for the item.
        </li>
        <li>
          Timeline dates reflect the report/advisory publication date, not the
          start of the underlying campaign.
        </li>
      </ul>
    </footer>
  );
}
