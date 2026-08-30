import "server-only";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { Repositories } from "@/lib/db/repositories";
import type { DocumentRecord } from "@/lib/db/types";
import type { DocumentStore } from "@/lib/storage/types";
import { validateDocumentUpload } from "@/lib/storage/validation";
import {
  resolveAssessmentBySessionToken,
  type AssessmentAccessError,
} from "@/domain/assessment/session";

/**
 * Document upload, scoped by a verified assessment session (Phase 1.1
 * hardening — mirrors the isolation pattern in
 * domain/assessment/session.ts: session token in, never a caller-supplied
 * assessmentId).
 *
 * This module stores files and structured metadata only. It does not call
 * any AI provider and does not read file content beyond hashing it and
 * sniffing its type signature (lib/security/fileSignature.ts) — see
 * lib/storage/types.ts and MASTER_BUILD_SPEC.md §9 for why AI wiring is
 * deliberately absent in Phase 1.
 */

export type UploadDocumentResult =
  | { ok: true; document: DocumentRecord }
  | { ok: false; error: AssessmentAccessError | "validation"; message?: string };

export interface UploadDocumentForSessionInput {
  rawSessionToken: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  data: Buffer;
}

export async function uploadDocumentForSession(
  repos: Repositories,
  store: DocumentStore,
  input: UploadDocumentForSessionInput,
): Promise<UploadDocumentResult> {
  const resolved = await resolveAssessmentBySessionToken(repos, input.rawSessionToken);
  if (!resolved.ok) return resolved;

  const validationError = validateDocumentUpload({
    mimeType: input.mimeType,
    sizeBytes: input.data.byteLength,
    data: input.data,
  });
  if (validationError) {
    return { ok: false, error: "validation", message: validationError.message };
  }

  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const documentId = randomUUID();
  const sanitizedFilename = sanitizeFilename(input.originalFilename);
  const storagePath = `${resolved.assessment.id}/${documentId}-${sanitizedFilename}`;

  await store.upload({ storagePath, data: input.data, mimeType: input.mimeType });

  const document = await repos.documents.create({
    assessmentId: resolved.assessment.id,
    documentType: input.documentType,
    storagePath,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.data.byteLength,
    sha256,
    uploadStatus: "uploaded",
  });

  // Only structured, non-content metadata is audited (spec §5, §17) — never
  // the filename-derived personal data or file bytes themselves beyond the
  // hash, which is not reversible to content.
  await repos.audit.record({
    actorType: "client",
    assessmentId: resolved.assessment.id,
    eventType: "document_uploaded",
    metadata: { documentId: document.id, documentType: document.documentType, sha256 },
  });

  return { ok: true, document };
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}
