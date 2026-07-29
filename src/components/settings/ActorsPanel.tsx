"use client";

import { useMemo, useState } from "react";
import {
  addActor,
  updateActor,
  deleteActor,
} from "@/app/settings/catalogue-actions";
import {
  MOTIVATIONS,
  MOTIVATION_LABEL,
  type ActorRecord,
  type ActorInput,
  type Motivation,
} from "@/lib/actor-catalogue";
import { RowMenu } from "./RowMenu";

const inputCls =
  "w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const list = (v: string[] | null) => (v ?? []).join(", ");

/** Human label for the stored motivation value (e.g. "nation_state" -> "Nation State"). */
function motivationLabel(v: string[] | null): string {
  const m = v?.[0];
  return m && m in MOTIVATION_LABEL
    ? MOTIVATION_LABEL[m as Motivation]
    : (m ?? "-");
}

export function ActorsPanel({
  initialActors,
}: {
  initialActors: ActorRecord[];
}) {
  const [actors, setActors] = useState(initialActors);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nameF, setNameF] = useState("");
  const [motivationF, setMotivationF] = useState("");
  const [aliasesF, setAliasesF] = useState("");

  const filtered = useMemo(() => {
    const n = nameF.trim().toLowerCase();
    const al = aliasesF.trim().toLowerCase();
    return actors.filter((a) => {
      if (n && !a.name.toLowerCase().includes(n)) return false;
      if (motivationF && (a.motivation?.[0] ?? "") !== motivationF) return false;
      if (al && !list(a.community_identifiers).toLowerCase().includes(al))
        return false;
      return true;
    });
  }, [actors, nameF, motivationF, aliasesF]);

  function upsertLocal(a: ActorRecord) {
    setActors((prev) => {
      const next = prev.some((x) => x.id === a.id)
        ? prev.map((x) => (x.id === a.id ? a : x))
        : [...prev, a];
      return next.sort((x, y) => x.name.localeCompare(y.name));
    });
  }

  async function onDelete(a: ActorRecord) {
    if (!confirm(`Delete actor "${a.name}"?`)) return;
    setBusy(a.id);
    setError(null);
    const res = await deleteActor(a.id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Delete failed.");
    else setActors((prev) => prev.filter((x) => x.id !== a.id));
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Actors ({filtered.length}
          {filtered.length !== actors.length ? ` of ${actors.length}` : ""})
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
            Add actor
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : null}

      {editing === "new" ? (
        <ActorForm
          onCancel={() => setEditing(null)}
          onSaved={(a) => {
            upsertLocal(a);
            setEditing(null);
          }}
        />
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          className={inputCls}
          value={nameF}
          onChange={(e) => setNameF(e.target.value)}
          placeholder="Filter by name..."
          aria-label="Filter by name"
        />
        <select
          className={inputCls}
          value={motivationF}
          onChange={(e) => setMotivationF(e.target.value)}
          aria-label="Filter by motivation"
        >
          <option value="">All motivations</option>
          {MOTIVATIONS.map((m) => (
            <option key={m} value={m}>
              {MOTIVATION_LABEL[m]}
            </option>
          ))}
        </select>
        <input
          className={inputCls}
          value={aliasesF}
          onChange={(e) => setAliasesF(e.target.value)}
          placeholder="Filter aliases..."
          aria-label="Filter by aliases"
        />
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Family</th>
              <th className="py-1.5 pr-3 font-medium">Motivation</th>
              <th className="py-1.5 pr-3 font-medium">Country</th>
              <th className="py-1.5 pr-3 font-medium">Aliases</th>
              <th className="py-1.5 pr-3 font-medium">Description</th>
              <th className="py-1.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) =>
              editing === a.id ? (
                <tr key={a.id}>
                  <td colSpan={7} className="py-2">
                    <ActorForm
                      actor={a}
                      onCancel={() => setEditing(null)}
                      onSaved={(u) => {
                        upsertLocal(u);
                        setEditing(null);
                      }}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={a.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {a.name}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                    {a.animal_classifier ?? "-"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                    {motivationLabel(a.motivation)}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                    {a.country ?? "-"}
                  </td>
                  <td className="max-w-[200px] truncate py-2 pr-3 text-slate-500">
                    {list(a.community_identifiers) || "-"}
                  </td>
                  <td className="max-w-[280px] truncate py-2 pr-3 text-slate-500">
                    {a.description ?? "-"}
                  </td>
                  <td className="py-2 text-right">
                    <RowMenu
                      busy={busy === a.id}
                      busyLabel="Deleting"
                      items={[
                        {
                          label: "Edit",
                          onClick: () => {
                            setError(null);
                            setEditing(a.id);
                          },
                        },
                        {
                          label: "Delete",
                          danger: true,
                          onClick: () => onDelete(a),
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

function ActorForm({
  actor,
  onSaved,
  onCancel,
}: {
  actor?: ActorRecord;
  onSaved: (a: ActorRecord) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(actor?.name ?? "");
  const [animal, setAnimal] = useState(actor?.animal_classifier ?? "");
  const [motivation, setMotivation] = useState<string>(
    actor?.motivation?.[0] ?? "nation_state",
  );
  const [country, setCountry] = useState(actor?.country ?? "");
  const [aliases, setAliases] = useState(list(actor?.community_identifiers ?? null));
  const [description, setDescription] = useState(actor?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input: ActorInput = {
      name,
      animalClassifier: animal,
      motivation,
      country,
      aliases,
      description,
    };
    const res = actor
      ? await updateActor(actor.id, input)
      : await addActor(input);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Save failed.");
      return;
    }
    onSaved(res.actor);
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
          placeholder="Wicked Panda"
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Family
        </span>
        <input
          className={inputCls}
          value={animal}
          onChange={(e) => setAnimal(e.target.value)}
          placeholder="Panda"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Motivation
        </span>
        <select
          className={inputCls}
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
        >
          {MOTIVATIONS.map((m) => (
            <option key={m} value={m}>
              {MOTIVATION_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      {motivation === "nation_state" ? (
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">
            Country
          </span>
          <input
            className={inputCls}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="China"
          />
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Aliases (comma-separated)
        </span>
        <input
          className={inputCls}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="APT41, Barium"
        />
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          Description
        </span>
        <textarea
          className={`${inputCls} resize-y`}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : actor ? "Save changes" : "Add actor"}
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
