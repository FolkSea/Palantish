"use client";

import { useState } from "react";
import {
  addFamily,
  updateFamily,
  deleteFamily,
} from "@/app/settings/catalogue-actions";
import {
  FAMILY_FOCI,
  FOCUS_LABEL,
  type FamilyRecord,
  type FamilyFocus,
  type FamilyInput,
} from "@/lib/actor-catalogue";

const inputCls =
  "w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

export function ActorFamiliesPanel({
  initialFamilies,
}: {
  initialFamilies: FamilyRecord[];
}) {
  const [families, setFamilies] = useState(initialFamilies);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function upsertLocal(f: FamilyRecord) {
    setFamilies((prev) => {
      const next = prev.some((x) => x.id === f.id)
        ? prev.map((x) => (x.id === f.id ? f : x))
        : [...prev, f];
      return next.sort((a, b) => a.animal.localeCompare(b.animal));
    });
  }

  async function onDelete(f: FamilyRecord) {
    if (!confirm(`Delete family "${f.animal}"?`)) return;
    setBusy(f.id);
    setError(null);
    const res = await deleteFamily(f.id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Delete failed.");
    else setFamilies((prev) => prev.filter((x) => x.id !== f.id));
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Actor families ({families.length})
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
            Add family
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Maps a CrowdStrike animal to a focus and, for nation states, a country.
      </p>

      {error ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : null}

      {editing === "new" ? (
        <FamilyForm
          onCancel={() => setEditing(null)}
          onSaved={(f) => {
            upsertLocal(f);
            setEditing(null);
          }}
        />
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Animal</th>
              <th className="py-1.5 pr-3 font-medium">Focus</th>
              <th className="py-1.5 pr-3 font-medium">Country</th>
              <th className="py-1.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {families.map((f) =>
              editing === f.id ? (
                <tr key={f.id}>
                  <td colSpan={4} className="py-2">
                    <FamilyForm
                      family={f}
                      onCancel={() => setEditing(null)}
                      onSaved={(u) => {
                        upsertLocal(u);
                        setEditing(null);
                      }}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={f.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {f.animal}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {FOCUS_LABEL[f.focus]}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{f.country ?? "-"}</td>
                  <td className="py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEditing(f.id);
                      }}
                      className="mr-1 rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy === f.id}
                      onClick={() => onDelete(f)}
                      className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === f.id ? "..." : "Delete"}
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

function FamilyForm({
  family,
  onSaved,
  onCancel,
}: {
  family?: FamilyRecord;
  onSaved: (f: FamilyRecord) => void;
  onCancel: () => void;
}) {
  const [animal, setAnimal] = useState(family?.animal ?? "");
  const [focus, setFocus] = useState<FamilyFocus>(family?.focus ?? "nation_state");
  const [country, setCountry] = useState(family?.country ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input: FamilyInput = { animal, focus, country };
    const res = family
      ? await updateFamily(family.id, input)
      : await addFamily(input);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Save failed.");
      return;
    }
    onSaved(res.family);
  }

  return (
    <form
      onSubmit={save}
      className="my-2 grid grid-cols-1 gap-2 rounded-md border border-[#e5e7eb] bg-slate-50 p-3 sm:grid-cols-3"
    >
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Animal
        </span>
        <input
          className={inputCls}
          value={animal}
          onChange={(e) => setAnimal(e.target.value)}
          placeholder="Panda"
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Focus
        </span>
        <select
          className={inputCls}
          value={focus}
          onChange={(e) => setFocus(e.target.value as FamilyFocus)}
        >
          {FAMILY_FOCI.map((f) => (
            <option key={f} value={f}>
              {FOCUS_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Country (optional)
        </span>
        <input
          className={inputCls}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="China"
        />
      </label>
      <div className="flex items-center gap-2 sm:col-span-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : family ? "Save changes" : "Add family"}
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
