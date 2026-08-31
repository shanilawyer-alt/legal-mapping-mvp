/**
 * The AI-provider abstraction (MASTER_BUILD_SPEC.md §9): calls are
 * server-side only, structured outputs are validated with Zod
 * (schemas.ts), provider/model/schema version is always stored. No
 * implementation here ever calls a real AI provider — see
 * syntheticProvider.ts and OPEN_QUESTIONS.md item 25 for why, and what
 * that does and doesn't verify.
 */

export interface ExtractedField<T = unknown> {
  value: T | null;
  evidence: { page?: number; section?: string } | null;
}

export interface DocumentExtractionRequest {
  documentId: string;
  /** matches document_analysis_matrix.csv "ID", e.g. "DOC-01" */
  documentType: string;
  storagePath: string;
  sha256: string;
  /**
   * Pilot/test-only: explicitly selects a canned synthetic fixture
   * (OPEN_QUESTIONS.md item 25). Never derived from the document's
   * actual bytes — this implementation does not parse file content at
   * all. Omitted (the real-world default) always yields `status:
   * "failed"` with reason "no_provider_available" rather than a guess.
   */
  fixtureTag?: string;
}

export type DocumentExtractionStatus = "completed" | "failed";

export interface DocumentExtractionOutcome {
  status: DocumentExtractionStatus;
  schemaName: string;
  schemaVersion: string;
  provider: string;
  model: string;
  extractionJson: Record<string, unknown>;
  /** Per-field confidence notes, if any — kept separate from spec §12's assessment-level 1-4 confidence scale. */
  confidenceJson: Record<string, unknown>;
  evidenceJson: Record<string, unknown>;
  /** Only set when status is "failed" — never guessed at, always explicit. */
  failureReason?: string;
}

export interface DocumentExtractor {
  extract(request: DocumentExtractionRequest): Promise<DocumentExtractionOutcome>;
}
