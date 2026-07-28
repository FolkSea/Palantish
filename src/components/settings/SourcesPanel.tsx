"use client";

import { useState } from "react";
import type { SettingsSource } from "./SettingsView";
import {
  addSource,
  updateSource,
  deleteSource,
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
// Users may only choose RSS or Manual. Custom Scraper is reserved for the dev
// team to enable later; it still displays if a source is already set to it.
const SELECTABLE_TYPES: FeedType[] = ["rss", "manual"];

const inputCls =
  "w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

function byCategoryThenName(a: SettingsSource, b: SettingsSource) {
  return (
    a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
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
  const [error, setError] = useState<string | null>(null);

  function upsertLocal(s: SettingsSource) {
    setSources((prev) => {
      const next = prev.some((x) => x.id === s.id)
        ? prev.map((x) => (x.id === s.id ? s : x))
        : [...prev, s];
      return next.sort(byCategoryThenName);
    });
  }

  async function onDelete(s: SettingsSource) {
    if (!confirm(`Delete source "${s.name}"? This cannot be undone.`)) return;
    setBusy(s.id);
    setError(null);
    const res = await deleteSource(s.id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Delete failed.");
    else setSources((prev) => prev.filter((x) => x.id !== s.id));
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Sources ({sources.length})
        </h2>
        {editing === null ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing("new");
            }}
            className="rounded-md bg-slate-900 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-slate-700"
          >
            Add source
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
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

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Category</th>
              <th className="py-1.5 pr-3 font-medium">Type</th>
              <th className="py-1.5 pr-3 font-medium">URL</th>
              <th className="py-1.5 pr-3 font-medium">Active</th>
              <th className="py-1.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) =>
              editing === s.id ? (
                <tr key={s.id}>
                  <td colSpan={6} className="py-2">
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
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                        s.active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-300 bg-slate-100 text-slate-500"
                      }`}
                    >
                      {s.active ? "Active" : "Off"}
                    </span>
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEditing(s.id);
                      }}
                      className="mr-1 rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy === s.id}
                      onClick={() => onDelete(s)}
                      className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === s.id ? "..." : "Delete"}
                    </button>
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
