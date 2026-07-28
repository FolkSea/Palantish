"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/env";
import { toAscii } from "@/lib/text";

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
  if (!user || !isEmailAllowed(user.email)) return "Not authorized.";
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
