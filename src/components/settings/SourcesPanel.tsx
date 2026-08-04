"use client";

import { useState } from "react";
import type { SettingsSource } from "./SettingsView";
import {
  feedHealth,
  FEED_HEALTH_LABEL,
  type FeedHealth,
} from "@/lib/feed-status";
import { formatDateTime } from "@/lib/format";
import { RowMenu } from "./RowMenu";
import {
  addSource,
  updateSource,
  deleteSource,
  ingestSource,
  ingestAllSources,
  type SourceCategory,
  type FeedType,
  type SourceInput,
} from "@/app/settings/actions";

const CATEGORIES: SourceCategory[] = ["vendor", "research", "news", "government"];
const TYPE_LABEL: Record<FeedType, string> = {
  rss: "RSS",
  manual: "Manual",
  scraper: "Custom Scraper",
};
// Users may only choose RSS or Manual. Custom Scraper works, but only for a URL
// with a reader registered in src/lib/ingest/readers - picking it here for an
// arbitrary site would just fail the run - so it is set in the seed, not the UI.
// It still displays for a source already on it.
const SELECTABLE_TYPES: FeedType[] = ["rss", "manual"];

const inputCls =
  "w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
const filterCls =
  "rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

type ActiveFilter = "all" | "active" | "off";

const HEALTH_STYLE: Record<FeedHealth, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  off: "border-slate-300 bg-slate-100 text-slate-500",
  stale: "border-amber-200 bg-amber-50 text-amber-700",
  never: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

/**
 * A feed's state, not its switch.
 *
 * "Active" used to mean only that the toggle was on, so a feed the dashboard
 * was warning about still read as Active here - which is the confusion this
 * replaces. The health rule is shared with the dashboard warning and the
 * notification, so all three agree.
 */
function FeedStatus({ source }: { source: SettingsSource }) {
  const health = feedHealth({
    active: source.active,
    feedUrl: source.feed_url,
    lastItemAt: source.last_item_at,
    lastFetchedAt: source.last_fetched_at,
    lastError: source.last_error,
  });
  const detail =
    health === "error"
      ? source.last_error
      : health === "stale" && source.last_item_at
        ? `Newest item ${formatDateTime(source.last_item_at)}`
        : health === "never"
          ? "Nothing has been ingested from this feed"
          : null;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={`w-fit rounded border px-1.5 py-0.5 text-[10px] uppercase ${HEALTH_STYLE[health]}`}
        title={detail ?? undefined}
      >
        {FEED_HEALTH_LABEL[health]}
      </span>
      {detail ? (
        <span className="max-w-[190px] truncate text-[10px] text-slate-400" title={detail}>
          {detail}
        </span>
      ) : null}
    </span>
  );
}

function byName(a: SettingsSource, b: SettingsSource) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Cumulative kept vs dropped counts for a feed, with the keep rate. */
function KeepDrop({ kept, dropped }: { kept: number; dropped: number }) {
  const total = kept + dropped;
  if (total === 0) return <span className="text-slate-400">-</span>;
  const pct = Math.round((kept / total) * 100);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium text-emerald-700">{kept}</span>
      <span className="text-slate-300">/</span>
      <span className="text-slate-500">{dropped}</span>
      <span className="text-[10px] text-slate-400">({pct}% kept)</span>
    </span>
  );
}

export function SourcesPanel({
  initialSources,
}: {
  initialSources: SettingsSource[];
}) {
  const [sources, setSources] = useState(initialSources);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState<string | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [nameFilter, setNameFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SourceCategory>(
    "all",
  );
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const filtered = sources.filter((s) => {
    if (
      nameFilter &&
      !s.name.toLowerCase().includes(nameFilter.trim().toLowerCase())
    )
      return false;
    if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
    if (activeFilter === "active" && !s.active) return false;
    if (activeFilter === "off" && s.active) return false;
    return true;
  });

  function upsertLocal(s: SettingsSource) {
    setSources((prev) => {
      const next = prev.some((x) => x.id === s.id)
        ? prev.map((x) => (x.id === s.id ? s : x))
        : [...prev, s];
      return next.sort(byName);
    });
  }

  async function onDelete(s: SettingsSource) {
    if (!confirm(`Delete source "${s.name}"? This cannot be undone.`)) return;
    setBusy(s.id);
    setError(null);
    setStatus(null);
    const res = await deleteSource(s.id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Delete failed.");
    else setSources((prev) => prev.filter((x) => x.id !== s.id));
  }

  async function onUpdateOne(s: SettingsSource) {
    setIngesting(s.id);
    setError(null);
    setStatus(null);
    const res = await ingestSource(s.id);
    setIngesting(null);
    if (!res.ok) setError(res.error ?? "Update failed.");
    else
      setStatus(
        `Updated "${s.name}": ${res.itemsAdded ?? 0} new item(s) ingested.`,
      );
  }

  async function onUpdateAll() {
    setIngesting("all");
    setError(null);
    setStatus(null);
    const res = await ingestAllSources();
    setIngesting(null);
    if (!res.ok) setError(res.error ?? "Ingest failed.");
    else
      setStatus(
        `Ingest complete: ${res.itemsAdded ?? 0} new item(s) across all feeds.`,
      );
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Sources ({filtered.length}
          {filtered.length !== sources.length ? ` of ${sources.length}` : ""})
        </h2>
        {editing === null ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={ingesting !== null}
              onClick={onUpdateAll}
              className="rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {ingesting === "all" ? "Ingesting..." : "Update all feeds"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStatus(null);
                setEditing("new");
              }}
              className="rounded-md bg-slate-900 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-slate-700"
            >
              Add source
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          {status}
        </p>
      ) : null}

      {editing === "new" ? (
        <SourceForm
          onCancel={() => setEditing(null)}
          onSaved={(s) => {
            upsertLocal(s);
            setEditing(null);
          }}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className={`${filterCls} w-44`}
          placeholder="Filter by name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
        <select
          className={filterCls}
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as "all" | SourceCategory)
          }
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className={filterCls}
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="off">Off</option>
        </select>
        {nameFilter || categoryFilter !== "all" || activeFilter !== "all" ? (
          <button
            type="button"
            onClick={() => {
              setNameFilter("");
              setCategoryFilter("all");
              setActiveFilter("all");
            }}
            className="text-[11px] text-slate-500 underline hover:text-slate-700"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Category</th>
              <th className="py-1.5 pr-3 font-medium">Type</th>
              <th className="py-1.5 pr-3 font-medium">URL</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium">Kept / Dropped</th>
              <th className="py-1.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr className="border-t border-slate-100">
                <td colSpan={7} className="py-4 text-center text-slate-400">
                  No sources match the filters.
                </td>
              </tr>
            ) : null}
            {filtered.map((s) =>
              editing === s.id ? (
                <tr key={s.id}>
                  <td colSpan={7} className="py-2">
                    <SourceForm
                      source={s}
                      onCancel={() => setEditing(null)}
                      onSaved={(u) => {
                        upsertLocal(u);
                        setEditing(null);
                      }}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={s.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {s.name}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{s.category}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                    {TYPE_LABEL[s.feed_type]}
                  </td>
                  <td className="max-w-[260px] truncate py-2 pr-3 text-slate-500">
                    {(s.feed_type === "rss" ? s.feed_url : s.url) ?? "-"}
                  </td>
                  <td className="py-2 pr-3">
                    <FeedStatus source={s} />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <KeepDrop kept={s.posts_kept} dropped={s.posts_dropped} />
                  </td>
                  <td className="py-2 text-right">
                    <RowMenu
                      busy={busy === s.id || ingesting === s.id}
                      busyLabel={ingesting === s.id ? "Updating" : "Deleting"}
                      items={[
                        {
                          label: "Edit",
                          onClick: () => {
                            setError(null);
                            setStatus(null);
                            setEditing(s.id);
                          },
                        },
                        { label: "Update", onClick: () => onUpdateOne(s) },
                        {
                          label: "Delete",
                          danger: true,
                          onClick: () => onDelete(s),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}


function SourceForm({
  source,
  onSaved,
  onCancel,
}: {
  source?: SettingsSource;
  onSaved: (s: SettingsSource) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(source?.name ?? "");
  const [category, setCategory] = useState<SourceCategory>(
    source?.category ?? "vendor",
  );
  const [feedType, setFeedType] = useState<FeedType>(source?.feed_type ?? "rss");
  const [feedUrl, setFeedUrl] = useState(source?.feed_url ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [active, setActive] = useState(source?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input: SourceInput = { name, url, category, feedType, feedUrl, active };
    const res = source
      ? await updateSource(source.id, input)
      : await addSource(input);
    setSaving(false);
    if (!res.ok || !res.source) {
      setError(res.error ?? "Save failed.");
      return;
    }
    onSaved(res.source);
  }

  return (
    <form
      onSubmit={save}
      className="my-2 grid grid-cols-1 gap-2 rounded-md border border-[#e5e7eb] bg-slate-50 p-3 sm:grid-cols-2"
    >
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Name
        </span>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Category
        </span>
        <select
          className={inputCls}
          value={category}
          onChange={(e) => setCategory(e.target.value as SourceCategory)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Type
        </span>
        <select
          className={inputCls}
          value={feedType}
          onChange={(e) => setFeedType(e.target.value as FeedType)}
        >
          {(source?.feed_type === "scraper"
            ? [...SELECTABLE_TYPES, "scraper" as FeedType]
            : SELECTABLE_TYPES
          ).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {feedType === "rss" ? (
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">
            Feed URL (RSS/Atom)
          </span>
          <input
            className={inputCls}
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://example.com/feed/"
          />
        </label>
      ) : null}
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          {feedType === "manual" ? "Blog URL" : "Blog / homepage URL"}
          {feedType === "scraper" ? " (scraper target)" : ""}
        </span>
        <input
          className={inputCls}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/"
        />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-slate-700">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Active (pulled by the ingest pipeline)
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : source ? "Save changes" : "Add source"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        {error ? <span className="text-[12px] text-red-600">{error}</span> : null}
      </div>
    </form>
  );
}
