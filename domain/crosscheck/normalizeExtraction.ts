import type { DocumentExtraction } from "@/lib/db/types";
import type { NewDerivedFactInput } from "@/lib/db/types";

/**
 * Flattens one stored `DocumentExtraction` row's flat `extractionJson`
 * into individual canonical facts (domain/facts), one per field, keyed
 * `document_extraction.<schemaName>.<field>` — the same convention
 * `domain/facts/fromAnswers.ts` uses for `answer.<QUESTION_ID>`, and the
 * exact convention `RULE_CATALOG` already references (e.g.
 * `document_extraction.privacy_notice.components_incomplete`).
 *
 * Confidence is fixed at 3/4 ("documentary evidence", spec §12's scale)
 * for every field of a completed extraction — the extraction pipeline
 * does not yet produce per-field confidence (`confidenceJson` is
 * currently always `{}`, see syntheticProvider.ts). A failed or pending
 * extraction contributes no facts: uncertainty must never silently
 * become a fact value (OPEN_QUESTIONS.md item 25).
 */
export function flattenExtractionToFacts(
  extraction: DocumentExtraction,
  assessmentId: string,
): NewDerivedFactInput[] {
  if (extraction.status !== "completed") return [];

  return Object.entries(extraction.extractionJson).map(([field, value]) => ({
    assessmentId,
    factKey: `document_extraction.${extraction.schemaName}.${field}`,
    valueJson: value,
    sourceType: "document_extraction",
    sourceId: extraction.id,
    confidence: 3,
  }));
}
