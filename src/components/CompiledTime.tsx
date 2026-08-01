"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function formatTimestamp(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function CompiledTime({
  iso,
  label = "Compiled",
}: {
  iso: string | null;
  label?: string;
}) {
  // Render the locale-specific value only after hydration, avoiding a second
  // state-setting render and avoiding server/client timezone mismatches.
  const text = useSyncExternalStore(
    subscribe,
    () => formatTimestamp(iso),
    () => "",
  );

  return (
    <span suppressHydrationWarning>
      {label} {text || "..."}
      {iso ? "" : " (no refresh recorded yet)"}
    </span>
  );
}
