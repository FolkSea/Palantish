"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setBookmarkAction } from "@/app/bookmark-actions";

type BookmarksApi = {
  has: (intelItemId: string) => boolean;
  toggle: (intelItemId: string) => Promise<{ ok: boolean; error?: string }>;
};

const BookmarksContext = createContext<BookmarksApi | null>(null);

/**
 * The reader's saved reports, shared by every control that shows or changes
 * them. Seeded from the server so a saved report never renders as unsaved for a
 * frame, and held in one place so toggling in a list updates the same report
 * wherever else it appears on the page.
 */
export function BookmarksProvider({
  initialIds,
  children,
}: {
  initialIds: string[];
  children: ReactNode;
}) {
  const [ids, setIds] = useState<Set<string>>(() => new Set(initialIds));

  const has = useCallback((id: string) => ids.has(id), [ids]);

  const toggle = useCallback(
    async (id: string) => {
      const next = !ids.has(id);
      // Optimistic, then rolled back if the write is refused: a save that
      // silently did not happen is worse than one that visibly failed.
      setIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(id);
        else copy.delete(id);
        return copy;
      });
      const res = await setBookmarkAction(id, next);
      if (!res.ok) {
        setIds((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(id);
          else copy.add(id);
          return copy;
        });
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    [ids],
  );

  const value = useMemo(() => ({ has, toggle }), [has, toggle]);
  return (
    <BookmarksContext.Provider value={value}>{children}</BookmarksContext.Provider>
  );
}

/**
 * Read/write the reading list. Returns null outside a provider, so a control can
 * decide to render nothing rather than crash a page that has no provider.
 */
export function useBookmarks(): BookmarksApi | null {
  return useContext(BookmarksContext);
}
