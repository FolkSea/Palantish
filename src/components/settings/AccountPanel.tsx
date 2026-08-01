"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AccountRole } from "@/lib/account-role";

type Note = { kind: "ok" | "error"; text: string } | null;

function Notice({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p
      className={`mt-2 rounded-md border px-3 py-2 text-[12px] ${
        note.kind === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {note.text}
    </p>
  );
}

const inputCls =
  "w-full rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-[13px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
const btnCls =
  "rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-slate-700 disabled:opacity-60";

export type Focus = "nation_state" | "ecrime" | "hacktivism" | "all";
export const FOCUS_OPTIONS: { value: Focus; label: string }[] = [
  { value: "nation_state", label: "Nation State" },
  { value: "ecrime", label: "eCrime" },
  { value: "hacktivism", label: "Hacktivism" },
  { value: "all", label: "All" },
];

export function AccountPanel({
  email,
  role,
  displayName,
  focus,
}: {
  email: string;
  role: AccountRole;
  displayName: string;
  focus: Focus;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [name, setName] = useState(displayName);
  const [nameNote, setNameNote] = useState<Note>(null);
  const [nameSaving, setNameSaving] = useState(false);

  const [focusValue, setFocusValue] = useState<Focus>(focus);
  const [focusNote, setFocusNote] = useState<Note>(null);
  const [focusSaving, setFocusSaving] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwNote, setPwNote] = useState<Note>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const [resetNote, setResetNote] = useState<Note>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameSaving(true);
    setNameNote(null);
    const { error } = await supabase.auth.updateUser({
      data: { display_name: name.trim() },
    });
    setNameSaving(false);
    if (error) setNameNote({ kind: "error", text: error.message });
    else {
      setNameNote({ kind: "ok", text: "Display name saved." });
      router.refresh();
    }
  }

  async function saveFocus(value: Focus) {
    setFocusValue(value);
    setFocusSaving(true);
    setFocusNote(null);
    const { error } = await supabase.auth.updateUser({ data: { focus: value } });
    setFocusSaving(false);
    if (error) setFocusNote({ kind: "error", text: error.message });
    else {
      setFocusNote({ kind: "ok", text: "Focus saved." });
      router.refresh();
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwNote(null);
    if (pw.length < 8) {
      setPwNote({ kind: "error", text: "Use at least 8 characters." });
      return;
    }
    if (pw !== pw2) {
      setPwNote({ kind: "error", text: "Passwords do not match." });
      return;
    }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwSaving(false);
    if (error) setPwNote({ kind: "error", text: error.message });
    else {
      setPw("");
      setPw2("");
      setPwNote({ kind: "ok", text: "Password updated." });
    }
  }

  async function sendResetEmail() {
    setResetNote(null);
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=/settings`,
    });
    if (error) setResetNote({ kind: "error", text: error.message });
    else
      setResetNote({
        kind: "ok",
        text: `Password reset link sent to ${email}.`,
      });
  }

  return (
    <div className="space-y-4">
      {/* Account details */}
      <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Account details
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Signed in as {email}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Security level: {role === "administrator" ? "Administrator" : "User"}
        </p>
        <form onSubmit={saveName} className="mt-3 max-w-sm space-y-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">
              Display name
            </span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>
          <button type="submit" className={btnCls} disabled={nameSaving}>
            {nameSaving ? "Saving..." : "Save display name"}
          </button>
          <Notice note={nameNote} />
        </form>

        <div className="mt-4 max-w-sm">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">
              Focus
            </span>
            <select
              className={inputCls}
              value={focusValue}
              disabled={focusSaving}
              onChange={(e) => saveFocus(e.target.value as Focus)}
            >
              {FOCUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-[11px] text-slate-500">
            Which threat area to focus the dashboard on.
          </p>
          <Notice note={focusNote} />
        </div>
      </section>

      {/* Password reset */}
      <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Reset password
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Set a new password now, or email yourself a reset link.
        </p>
        <form onSubmit={changePassword} className="mt-3 max-w-sm space-y-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">
              New password
            </span>
            <input
              type="password"
              className={inputCls}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">
              Confirm new password
            </span>
            <input
              type="password"
              className={inputCls}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className={btnCls} disabled={pwSaving}>
              {pwSaving ? "Saving..." : "Update password"}
            </button>
            <button
              type="button"
              onClick={sendResetEmail}
              className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
            >
              Email me a reset link
            </button>
          </div>
          <Notice note={pwNote} />
          <Notice note={resetNote} />
        </form>
      </section>
    </div>
  );
}
