"use client";

import { useState } from "react";
import { validIndicator } from "@/lib/report-indicators";

const TYPE_LABEL: Record<string, string> = {
  ip: "IP address",
  domain: "domain",
  uri: "URI",
  file_hash: "file hash",
  cve: "CVE",
};

/**
 * A list of IOC values shown as editable labels: each has an edit button (with
 * validated inline editing) and a delete button. When not editable (no report
 * id), values render read-only.
 */
export function EditableIocList({
  items,
  type,
  editable,
  onRemove,
  onEdit,
}: {
  items: string[];
  type: string;
  editable: boolean;
  onRemove: (value: string) => void;
  onEdit: (oldValue: string, newValue: string) => Promise<string | null>;
}) {
  if (!items.length) {
    return <p className="text-[12px] italic text-slate-400">None.</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((v) => (
        <IocLabel
          key={v}
          value={v}
          type={type}
          editable={editable}
          onRemove={onRemove}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}

function IocLabel({
  value,
  type,
  editable,
  onRemove,
  onEdit,
}: {
  value: string;
  type: string;
  editable: boolean;
  onRemove: (value: string) => void;
  onEdit: (oldValue: string, newValue: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const nv = draft.trim();
    if (!nv || nv === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    if (!validIndicator(nv, type)) {
      setError(`Not a valid ${TYPE_LABEL[type] ?? type}.`);
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onEdit(value, nv);
    setBusy(false);
    if (err) setError(err);
    else setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    setError(null);
  }

  if (editing) {
    return (
      <li className="rounded border border-slate-300 bg-white p-1">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                cancel();
              }
            }}
            className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[12px] text-slate-800 outline-none focus:border-slate-400"
          />
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
        {error ? (
          <p className="mt-0.5 text-[10px] text-red-600">{error}</p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">
      <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-slate-700">
        {value}
      </span>
      {editable ? (
        <>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            title="Edit"
            aria-label="Edit"
            className="shrink-0 text-slate-400 hover:text-slate-700"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onRemove(value)}
            title="Remove"
            aria-label="Remove"
            className="shrink-0 text-slate-400 hover:text-red-600"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </>
      ) : null}
    </li>
  );
}
