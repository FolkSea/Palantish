// Reading past a server's per-response row cap.
//
// PostgREST caps every response (`max_rows`, 1000 by default) and truncates
// silently rather than erroring, so a request that asks for more just gets less
// - indistinguishable from a complete answer. Anything that can exceed the cap
// has to page until a short page ends it.
//
// Pure - it takes the request as a callback - so the "did we get everything"
// rule is testable without a database. It is worth testing: an off-by-one here
// loses rows quietly, which is the failure this whole module exists to prevent.

export const PAGE_SIZE = 1000;

// Many UUIDs in one `.in()` filter would overflow the request URI, so ids are
// chunked as well. Paging bounds the response; chunking bounds the URI.
export const ID_BATCH_SIZE = 200;

// How many pages to ask for at once. One at a time meant a table of twenty
// thousand rows cost twenty round trips end to end, each waiting on the last -
// and the report network reads exactly such a table before it can draw
// anything. Asking for a window of pages together turns that wait into a
// handful. Kept modest: past this the requests queue on the connection rather
// than overlapping, and a short page means most of the window was wasted work.
export const PAGE_WINDOW = 6;

export type PageFetch<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null }>;

/**
 * Page one request to exhaustion, past the server's per-response row cap.
 *
 * Pages come back in request order and a short page ends the read: the sort is
 * a total order, so nothing follows it. Anything fetched past that point is
 * discarded rather than appended, which keeps the result identical to reading
 * the pages one at a time.
 */
export async function fetchAllPages<T>(page: PageFetch<T>): Promise<T[]> {
  const rows: T[] = [];

  // The first page alone, because most reads are one page and speculating on a
  // second would multiply the requests for every small one - the id-chunked
  // reads below are all this shape.
  const first = (await page(0, PAGE_SIZE - 1)).data ?? [];
  rows.push(...first);
  if (first.length < PAGE_SIZE) return rows;

  // A full first page means there is more, and now it is worth asking for
  // several at once rather than discovering the end one round trip at a time.
  for (let start = 1; ; start += PAGE_WINDOW) {
    const window = await Promise.all(
      Array.from({ length: PAGE_WINDOW }, (_, i) => {
        const from = (start + i) * PAGE_SIZE;
        return page(from, from + PAGE_SIZE - 1);
      }),
    );
    for (const { data } of window) {
      const got = data ?? [];
      rows.push(...got);
      if (got.length < PAGE_SIZE) return rows;
    }
  }
}

/**
 * Chunk ids to keep the URI short, then page each chunk to exhaustion. Chunks
 * run concurrently: a corpus-sized read is many of them, and in sequence that is
 * as many round-trips the caller waits through.
 */
export async function fetchAllByIds<T>(
  ids: string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
    chunks.push(ids.slice(i, i + ID_BATCH_SIZE));
  }
  const perChunk = await Promise.all(
    chunks.map((chunk) => fetchAllPages<T>((from, to) => page(chunk, from, to))),
  );
  return perChunk.flat();
}
