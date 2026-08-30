/**
 * Storage abstraction (spec §7). The Supabase Storage adapter is the only
 * implementation in Phase 1, but callers depend on this interface so the
 * backing provider could change without touching upload/download call
 * sites — and so tests can substitute an in-memory store.
 *
 * IMPORTANT (spec §9, FIRST_PROMPT constraint): nothing in this module or
 * its callers sends document bytes or extracted text to an AI provider.
 * That wiring is explicitly deferred to a later phase.
 */

export interface UploadDocumentInput {
  storagePath: string;
  data: Buffer;
  mimeType: string;
}

export interface DocumentStore {
  upload(input: UploadDocumentInput): Promise<void>;
  /** Short-lived signed URL. Never returns a public/object URL (spec §7). */
  getSignedDownloadUrl(storagePath: string, ttlSeconds?: number): Promise<string>;
  delete(storagePath: string): Promise<void>;
}
