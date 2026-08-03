"use client";

import { useState, useTransition } from "react";
import {
  addSubscription,
  removeSubscription,
  type SubscriptionRow,
} from "@/app/settings/subscription-actions";
import type { SubscriptionKind } from "@/lib/notify/match";

export type SubscriptionOptions = {
  label: string[];
  adversary: string[];
  country: string[];
};

const KINDS: { id: SubscriptionKind; label: string; hint: string }[] = [
  {
    id: "label",
    label: "Label",
    hint: "Subscribing to a branch covers everything under it: Malware also matches Malware/BRICKSTORM.",
  },
  { id: "adversary", label: "Adversary", hint: "Matched exactly, on either spelling of the actor." },
  { id: "country", label: "Country", hint: "Matched exactly against the report's attributed country." },
];

const KIND_CHIP: Record<SubscriptionKind, string> = {
  label: "bg-violet-100 text-violet-700",
  adversary: "bg-red-100 text-red-700",
  country: "bg-emerald-100 text-emerald-700",
};

/**
 * Manage what this user is emailed about. Subscriptions are per-account and
 * private: the RLS policies only ever expose a user their own rows.
 */
export function SubscriptionsPanel({
  initial,
  options,
}: {
  initial: SubscriptionRow[];
  options: SubscriptionOptions;
}) {
  const [rows, setRows] = useState(initial);
  const [kind, setKind] = useState<SubscriptionKind>("label");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const v = value.trim();
    if (!v) return;
    setError(null);
    startTransition(async () => {
      const res = await addSubscription(kind, v);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Optimistic until the page revalidates; keyed on the value so a repeat
      // add cannot duplicate a row locally.
      setRows((cur) =>
        cur.some((r) => r.kind === kind && r.value.toLowerCase() === v.toLowerCase())
          ? cur
          : [
              { id: `new-${kind}-${v}`, kind, value: v, created_at: new Date().toISOString() },
              ...cur,
            ],
      );
      setValue("");
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeSubscription(id);
      if (res.ok) setRows((cur) => cur.filter((r) => r.id !== id));
      else setError(res.error);
    });
  }

  const active = KINDS.find((k) => k.id === kind)!;
  const suggestions = options[kind];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#e5e7eb] bg-white p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">
          Email me about new reports
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">
          One digest per ingest run, covering every report that matches. Reports
          already in the dashboard are included when they are relabelled or
          re-attributed onto something you watch.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-medium text-slate-600">
            Type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as SubscriptionKind);
                setValue("");
                setError(null);
              }}
              className="mt-0.5 block rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] text-slate-900 outline-none focus:border-slate-400"
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-[11px] font-medium text-slate-600">
            Value
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              list={`subscription-options-${kind}`}
              placeholder={
                kind === "label"
                  ? "e.g. Malware, or Target/Zimbra"
                  : kind === "adversary"
                    ? "e.g. FANCY BEAR"
                    : "e.g. Russia"
              }
              className="mt-0.5 block w-full rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] text-slate-900 outline-none focus:border-slate-400"
            />
            <datalist id={`subscription-options-${kind}`}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <button
            type="button"
            onClick={add}
            disabled={pending || !value.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            Subscribe
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">{active.hint}</p>
        {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
      </div>

      <div className="rounded-md border border-[#e5e7eb] bg-white p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">
          Your subscriptions{" "}
          <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">
            {rows.length}
          </span>
        </h3>
        {rows.length === 0 ? (
          <p className="mt-2 text-[12px] italic text-slate-400">
            Not subscribed to anything yet, so no email will be sent.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${KIND_CHIP[r.kind]}`}
                >
                  {r.kind}
                </span>
                <span className="flex-1 font-medium text-slate-700">{r.value}</span>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  disabled={pending}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
