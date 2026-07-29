"use client";

import { useState } from "react";

export type RowMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
};

/**
 * Per-row actions rendered as a hamburger menu. The dropdown is
 * fixed-positioned so it is never clipped by a table's horizontal-scroll
 * container. While `busy` is set the trigger is replaced by a status label.
 */
export function RowMenu({
  items,
  busy = false,
  busyLabel = "Working",
}: {
  items: RowMenuItem[];
  busy?: boolean;
  busyLabel?: string;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const open = pos !== null;

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    if (open) {
      setPos(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }

  if (busy) {
    return <span className="text-[11px] text-slate-400">{busyLabel}...</span>;
  }

  return (
    <>
      <button
        type="button"
        aria-label="Actions"
        title="Actions"
        onClick={toggle}
        className="rounded border border-[#e5e7eb] bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-50"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div
            className="fixed z-50 w-32 overflow-hidden rounded-md border border-[#e5e7eb] bg-white py-1 shadow-lg"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setPos(null);
                  item.onClick();
                }}
                className={`block w-full px-3 py-1.5 text-left text-[12px] hover:bg-slate-50 ${
                  item.danger ? "text-red-600" : "text-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
