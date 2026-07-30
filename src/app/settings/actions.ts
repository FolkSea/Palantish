"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toAscii } from "@/lib/text";
import { runIngest } from "@/lib/ingest/pipeline";
import { generateAndStoreSummary } from "@/lib/summary/generate";

export type SourceCategory = "vendor" | "research" | "news" | "government";
const CATEGORIES: SourceCategory[] = ["vendor", "research", "news", "government"];

export type FeedType = "rss" | "manual" | "scraper";
const FEED_TYPES: FeedType[] = ["rss", "manual", "scraper"];

export type SourceInput = {
  name: string;
  url: string;
  category: SourceCategory;
  feedType: FeedType;
  feedUrl: string;
  active: boolean;
};

export type SourceResult = {
  ok: boolean;
  error?: string;
  source?: {
    id: string;
    name: string;
    url: string | null;
    category: SourceCategory;
    feed_type: FeedType;
    feed_url: string | null;
    active: boolean;
  };
};

/** Only authenticated, allow-listed users may manage sources. */
async function requireAllowed(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not authorized.";
  return null;
}

function clean(input: SourceInput): SourceResult | null {
  const name = toAscii(input.name).trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!CATEGORIES.includes(input.category))
    return { ok: false, error: "Invalid category." };
  if (!FEED_TYPES.includes(input.feedType))
    return { ok: false, error: "Invalid feed type." };
  if (input.feedType === "rss" && !input.feedUrl.trim())
    return { ok: false, error: "An RSS source needs a feed URL." };
  return null;
}

function normalise(input: SourceInput) {
  const isRss = input.feedType === "rss";
  return {
    name: toAscii(input.name).trim(),
    url: input.url.trim() || null,
    category: input.category,
    feed_type: input.feedType,
    // Only RSS sources carry a feed URL; manual/scraper use the blog URL.
    feed_url: isRss ? input.feedUrl.trim() || null : null,
    active: input.active,
  };
}

const SELECT = "id, name, url, category, feed_type, feed_url, active";

export async function addSource(input: SourceInput): Promise<SourceResult> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  const invalid = clean(input);
  if (invalid) return invalid;

  const db = createAdminClient();
  const { data, error } = await db
    .from("sources")
    .insert(normalise(input))
    .select(SELECT)
    .single();
  if (error) {
    return {
      ok: false,
      error: error.message.includes("duplicate")
        ? "A source with that name already exists."
        : error.message,
    };
  }
  revalidatePath("/settings");
  return { ok: true, source: data as SourceResult["source"] };
}

export async function updateSource(
  id: string,
  input: SourceInput,
): Promise<SourceResult> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  const invalid = clean(input);
  if (invalid) return invalid;

  const db = createAdminClient();
  const { data, error } = await db
    .from("sources")
    .update(normalise(input))
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, source: data as SourceResult["source"] };
}

export async function deleteSource(id: string): Promise<SourceResult> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };

  const db = createAdminClient();
  const { error } = await db.from("sources").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export type IngestActionResult = {
  ok: boolean;
  error?: string;
  itemsAdded?: number;
  errors?: string[];
};

async function triggerIngest(
  options?: { sourceIds?: string[] },
): Promise<IngestActionResult> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    const result = await runIngest(options);
    // New items may land anywhere on the dashboard; refresh both views.
    revalidatePath("/");
    revalidatePath("/settings");
    return {
      ok: result.status === "success",
      error:
        result.status === "success"
          ? undefined
          : result.errors[0] ?? "Ingest finished with errors.",
      itemsAdded: result.itemsAdded,
      errors: result.errors,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Force a full ingest of all active feeds. */
export async function ingestAllSources(): Promise<IngestActionResult> {
  return triggerIngest();
}

/** Ingest a single feed on demand (the row "Update" action). */
export async function ingestSource(id: string): Promise<IngestActionResult> {
  return triggerIngest({ sourceIds: [id] });
}

/** Regenerate the executive summary from current data (no ingest). */
export async function refreshSummaryAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    await generateAndStoreSummary(createAdminClient());
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
