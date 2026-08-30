import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentStore, UploadDocumentInput } from "@/lib/storage/types";

export const DOCUMENTS_BUCKET = "assessment-documents";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

export function createSupabaseDocumentStore(client: SupabaseClient): DocumentStore {
  return {
    async upload(input: UploadDocumentInput): Promise<void> {
      const { error } = await client.storage
        .from(DOCUMENTS_BUCKET)
        .upload(input.storagePath, input.data, {
          contentType: input.mimeType,
          upsert: false,
        });
      if (error) throw error;
    },

    async getSignedDownloadUrl(
      storagePath: string,
      ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
    ): Promise<string> {
      const { data, error } = await client.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(storagePath, ttlSeconds);
      if (error) throw error;
      return data.signedUrl;
    },

    async delete(storagePath: string): Promise<void> {
      const { error } = await client.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      if (error) throw error;
    },
  };
}
