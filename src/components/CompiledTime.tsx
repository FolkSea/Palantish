"use client";

import { useEffect, useState } from "react";

/** Renders the compile/refresh timestamp client-side in the viewer's locale. */
export default function CompiledTime({ iso }: { iso: string | null }) {
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
      Compiled {text || "..."}
      {iso ? "" : " (no refresh recorded yet)"}
    </span>
  );
}
