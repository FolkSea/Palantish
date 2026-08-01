import { ExtLink } from "@/components/ExtLink";
import { formatDate } from "@/lib/format";
import type { TickerItem } from "@/lib/data";

export function Ticker({ items }: { items: TickerItem[] }) {
  if (!items.length) return null;

  const row = items.map((i) => (
    <span key={i.id} className="mx-5 inline-flex items-center gap-1.5">
      <span className="text-slate-400">{formatDate(i.date)}</span>
      <ExtLink
        href={i.url}
        className={i.kind === "exploit" ? "!text-red-600" : undefined}
      >
        {i.title}
      </ExtLink>
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
