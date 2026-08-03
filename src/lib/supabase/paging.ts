import "server-only";

// PostgREST caps every response (`max_rows`, 1000 by default) and truncates
// silently rather than erroring, so a request that asks for more just gets less
// - indistinguishable from a complete answer. Anything that can exceed the cap
// has to page until a short page ends it.
export const PAGE_SIZE = 1000;

// Many UUIDs in one `.in()` filter would overflow the request URI, so ids are
// chunked as well. Paging bounds the response; chunking bounds the URI.
export const ID_BATCH_SIZE = 200;

/** Page one request to exhaustion, past the server's per-response row cap. */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await page(from, from + PAGE_SIZE - 1);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return rows;
  }
}

/** Chunk ids to keep the URI short, then page each chunk to exhaustion. Chunks
 * run concurrently: a corpus-sized read is many of them, and in sequence that is
 * as many round-trips the caller waits through. */
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
