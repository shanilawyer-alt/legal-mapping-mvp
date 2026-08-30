import "server-only";
import { getServiceRoleClient } from "@/lib/db/supabase/client";
import { createSupabaseDocumentStore } from "@/lib/storage/supabaseStorage";
import type { DocumentStore } from "@/lib/storage/types";

let cached: DocumentStore | undefined;

export function getDocumentStore(): DocumentStore {
  if (!cached) cached = createSupabaseDocumentStore(getServiceRoleClient());
  return cached;
}

export type { DocumentStore } from "@/lib/storage/types";
