"use client";

import { useEffect, useState } from "react";

/** Renders a timestamp client-side in the viewer's locale, prefixed by label. */
export default function CompiledTime({
  iso,
  label = "Compiled",
}: {
  iso: string | null;
  label?: string;
}) {
  const [text, setText] = useState<string>("");

  useEffect(() => {
    const d = iso ? new Date(iso) : new Date();
    setText(
      d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    );
  }, [iso]);

  return (
    <span suppressHydrationWarning>
      {label} {text || "..."}
      {iso ? "" : " (no refresh recorded yet)"}
    </span>
  );
}
