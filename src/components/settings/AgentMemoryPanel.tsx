"use client";

import { formatDate } from "@/lib/format";

export type AgentMemoryNote = {
  kind: "adversary" | "trend";
  subject: string;
  content: string;
  mentions: number;
  lastSeen: string;
};

function NoteList({ notes }: { notes: AgentMemoryNote[] }) {
  if (notes.length === 0)
    return (
      <p className="mt-2 text-[12px] text-slate-400">Nothing recorded yet.</p>
    );
  return (
    <ul className="mt-2 divide-y divide-slate-100">
      {notes.map((n) => (
        <li key={n.subject} className="py-2 text-[12px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold text-slate-800">{n.subject}</span>
            <span className="shrink-0 text-[10px] text-slate-400">
              {n.mentions} mention{n.mentions === 1 ? "" : "s"} -{" "}
              {formatDate(n.lastSeen)}
            </span>
          </div>
          <p className="mt-0.5 leading-snug text-slate-600">{n.content}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Read-only view of the analyst agent's memory: what it knows about adversaries
 * and the cross-report trends it is tracking. Populated by the agent as it
 * reflects on each ingest run.
 */
export function AgentMemoryPanel({ notes }: { notes: AgentMemoryNote[] }) {
  const adversaries = notes.filter((n) => n.kind === "adversary");
  const trends = notes.filter((n) => n.kind === "trend");

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <h2 className="text-[13px] font-semibold text-slate-900">
        Analyst agent memory ({notes.length})
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        The knowledge the triage/summary agent has built up across ingest runs.
        It informs how new reports are attributed and how the executive summary
        reads. Most recently updated first.
      </p>

      <div className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Adversaries ({adversaries.length})
        </h3>
        <NoteList notes={adversaries} />
      </div>

      <div className="mt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Tracked trends ({trends.length})
        </h3>
        <NoteList notes={trends} />
      </div>
    </section>
  );
}
