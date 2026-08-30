import "server-only";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { Repositories } from "@/lib/db/repositories";
import type { DocumentRecord } from "@/lib/db/types";
import type { DocumentStore } from "@/lib/storage/types";
import { validateDocumentUpload } from "@/lib/storage/validation";
import { resolveAssessmentByToken, type AssessmentAccessError } from "@/domain/assessment/service";

/**
 * Document upload, scoped by verified assessment token — mirrors the
 * isolation pattern in domain/assessment/service.ts (token in, never a
 * caller-supplied assessmentId).
 *
 * This module stores files and structured metadata only. It does not call
 * any AI provider and does not read file content beyond hashing it — see
 * lib/storage/types.ts and MASTER_BUILD_SPEC.md §9 for why that wiring is
 * deliberately absent in Phase 1.
 */

export type UploadDocumentResult =
  | { ok: true; document: DocumentRecord }
  | { ok: false; error: AssessmentAccessError | "validation"; message?: string };

export interface UploadDocumentForTokenInput {
  rawToken: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  data: Buffer;
}

export async function uploadDocumentForToken(
  repos: Repositories,
  store: DocumentStore,
  input: UploadDocumentForTokenInput,
): Promise<UploadDocumentResult> {
  const resolved = await resolveAssessmentByToken(repos, input.rawToken);
  if (!resolved.ok) return resolved;

  const validationError = validateDocumentUpload({
    mimeType: input.mimeType,
    sizeBytes: input.data.byteLength,
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
