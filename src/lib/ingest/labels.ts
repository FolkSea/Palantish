import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/**
 * Find-or-create each label (deduped case-insensitively by the labels table's
 * unique lower(name) index) and link it to an intel item. Additive - existing
 * links are kept; duplicate links are ignored. Returns the number of labels
 * linked. Shared by ingest; the modal's editor has its own replace-semantics.
 */
export async function linkLabelsToItem(
  db: Db,
  intelItemId: string,
  names: string[],
): Promise<number> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return 0;

  const labelIds: string[] = [];
  for (const name of unique) {
    const existing = await db
      .from("labels")
      .select("id")
      .ilike("name", name)
      .maybeSingle();
    if (existing.data) {
      labelIds.push(existing.data.id);
      continue;
    }
    const inserted = await db
      .from("labels")
      .insert({ name })
      .select("id")
      .single();
    if (inserted.error) {
      // Lost the unique(lower(name)) race to a concurrent insert - re-read.
      const again = await db
        .from("labels")
        .select("id")
        .ilike("name", name)
        .maybeSingle();
      if (again.data) labelIds.push(again.data.id);
    } else {
      labelIds.push(inserted.data.id);
    }
  }
  if (labelIds.length === 0) return 0;

  const { error } = await db.from("intel_item_labels").upsert(
    labelIds.map((label_id) => ({ intel_item_id: intelItemId, label_id })),
    { onConflict: "intel_item_id,label_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return labelIds.length;
}
