"use client";

import { useState, useTransition } from "react";
import {
  inviteUserAction,
  sendPasswordResetAction,
  updateUserRoleAction,
} from "@/app/settings/user-actions";
import type { AccountRole } from "@/lib/account-role";
import type { ManagedUser } from "@/lib/user-management-types";

type Notice = { kind: "ok" | "error"; text: string } | null;

const ROLE_LABEL: Record<AccountRole, string> = {
  administrator: "Administrator",
  user: "User",
};

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function UsersPanel({ initialUsers }: { initialUsers: ManagedUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AccountRole>("user");
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await inviteUserAction({ email, displayName, role });
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      const invited = result.user;
      if (invited)
        setUsers((current) =>
          [...current, invited].sort((a, b) => a.email.localeCompare(b.email)),
        );
      setEmail("");
      setDisplayName("");
      setRole("user");
      setNotice({ kind: "ok", text: result.message ?? "User invited." });
    });
  }

  function changeRole(user: ManagedUser, nextRole: AccountRole) {
    setNotice(null);
    startTransition(async () => {
      const result = await updateUserRoleAction(user.id, nextRole);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, role: nextRole } : item,
        ),
      );
      setNotice({ kind: "ok", text: result.message ?? "Access level updated." });
    });
  }

  function resetPassword(user: ManagedUser) {
    setNotice(null);
    startTransition(async () => {
      const result = await sendPasswordResetAction(user.email);
      setNotice(
        result.ok
          ? { kind: "ok", text: result.message ?? "Password reset sent." }
          : { kind: "error", text: result.error },
      );
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
        <h2 className="text-[13px] font-semibold text-slate-900">Invite user</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Creates an account and emails a secure invitation to set its password.
        </p>
        <form
          onSubmit={invite}
          className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_180px_auto]"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="rounded-md border border-[#e5e7eb] px-3 py-2 text-[12px] outline-none focus:border-slate-400"
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            className="rounded-md border border-[#e5e7eb] px-3 py-2 text-[12px] outline-none focus:border-slate-400"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AccountRole)}
            className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] outline-none focus:border-slate-400"
          >
            <option value="user">User</option>
            <option value="administrator">Administrator</option>
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            Send invitation
          </button>
        </form>
      </section>

      {notice ? (
        <p
          className={`rounded-md border px-3 py-2 text-[12px] ${
            notice.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white">
        <div className="border-b border-[#e5e7eb] px-4 py-3">
          <h2 className="text-[13px] font-semibold text-slate-900">
            Users ({users.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Access level</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Last sign-in</th>
                <th className="px-4 py-2 text-right font-medium">Password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e7eb]">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <span className="block font-medium text-slate-800">
                      {user.displayName || user.email}
                    </span>
                    {user.displayName ? (
                      <span className="block text-[11px] text-slate-400">
                        {user.email}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`Access level for ${user.email}`}
                      value={user.role}
                      disabled={pending}
                      onChange={(e) =>
                        changeRole(user, e.target.value as AccountRole)
                      }
                      className="rounded-md border border-[#e5e7eb] bg-white px-2 py-1.5 text-[12px]"
                    >
                      {(Object.keys(ROLE_LABEL) as AccountRole[]).map((value) => (
                        <option key={value} value={value}>
                          {ROLE_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-slate-500">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-3 py-3 text-slate-500">
                    {formatDate(user.lastSignInAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => resetPassword(user)}
                      className="rounded-md border border-[#e5e7eb] px-2.5 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Send reset
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
