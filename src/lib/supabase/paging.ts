import "server-only";

// The paging rules are pure and live in @/lib/paging so they can be tested
// without a database; this is the server-side door onto them, which is what
// every caller already imports.
export {
  PAGE_SIZE,
  ID_BATCH_SIZE,
  PAGE_WINDOW,
  fetchAllPages,
  fetchAllByIds,
  type PageFetch,
} from "@/lib/paging";
