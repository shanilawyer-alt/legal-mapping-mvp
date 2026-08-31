import "server-only";
import {
  EXTRACTION_SCHEMA_NAMES_BY_DOCUMENT_TYPE,
  EXTRACTION_SCHEMA_VERSION,
  EXTRACTION_SCHEMAS_BY_DOCUMENT_TYPE,
} from "@/domain/extraction/schemas";
import { SYNTHETIC_FIXTURES } from "@/domain/extraction/fixtures";
import type {
  DocumentExtractionOutcome,
  DocumentExtractionRequest,
  DocumentExtractor,
} from "@/domain/extraction/types";

const PROVIDER_NAME = "synthetic";
const MODEL_NAME = "fixture-v1";

/**
 * The only `DocumentExtractor` implementation in this codebase — no real
 * AI provider is wired (no credentials exist in this environment, spec
 * §9's provider abstraction exists precisely so a real one can be added
 * later without touching callers). See OPEN_QUESTIONS.md item 25: a
 * request without a `fixtureTag` (the only path a real, non-test upload
 * takes) always returns `status: "failed"` — never a guessed extraction.
 */
export function createSyntheticExtractor(): DocumentExtractor {
  return {
    async extract(request: DocumentExtractionRequest): Promise<DocumentExtractionOutcome> {
      const schemaName = EXTRACTION_SCHEMA_NAMES_BY_DOCUMENT_TYPE[request.documentType];
      const zodSchema = EXTRACTION_SCHEMAS_BY_DOCUMENT_TYPE[request.documentType];

      if (!schemaName || !zodSchema) {
        return failure(request, "unsupported_document_type", schemaName ?? "unknown");
      }

      if (!request.fixtureTag) {
        return failure(request, "no_provider_available", schemaName);
      }

      const fixtureSet = SYNTHETIC_FIXTURES[request.fixtureTag];
      const fixtureData = fixtureSet?.[request.documentType];
      if (!fixtureData) {
        return failure(request, "no_matching_fixture", schemaName);
      }

      const parsed = zodSchema.safeParse(fixtureData);
      if (!parsed.success) {
        // A fixture failing its own schema is a bug in this codebase, not
        // an uncertain real-world extraction — fail loudly rather than
        // silently returning malformed data.
        throw new Error(
          `Synthetic fixture ${request.fixtureTag}/${request.documentType} does not match its own schema: ${parsed.error.message}`,
        );
      }

      const { extractionJson, evidenceJson } = splitFieldsAndEvidence(
        parsed.data as Record<string, unknown>,
      );

      return {
        status: "completed",
        schemaName,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        provider: PROVIDER_NAME,
        model: MODEL_NAME,
        extractionJson,
        confidenceJson: {},
        evidenceJson,
      };
    },
  };
}

function failure(
  request: DocumentExtractionRequest,
  reason: string,
  schemaName: string,
): DocumentExtractionOutcome {
  return {
    status: "failed",
    schemaName,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    provider: PROVIDER_NAME,
    model: MODEL_NAME,
    extractionJson: {},
    confidenceJson: {},
    evidenceJson: {},
    failureReason: reason,
  };
}

/** Splits the uniform `{ value, evidence }` field shape into two flat JSON objects for storage. */
function splitFieldsAndEvidence(fields: Record<string, unknown>): {
  extractionJson: Record<string, unknown>;
  evidenceJson: Record<string, unknown>;
} {
  const extractionJson: Record<string, unknown> = {};
  const evidenceJson: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const entry = raw as { value: unknown; evidence: unknown } | null;
    extractionJson[key] = entry?.value ?? null;
    if (entry?.evidence) evidenceJson[key] = entry.evidence;
  }
  return { extractionJson, evidenceJson };
}
