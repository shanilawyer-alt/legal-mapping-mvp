import type { DocumentAnalysisRow } from "@/domain/csv/schemas";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";

/**
 * Pre-pilot defect found and fixed during pilot validation (documented
 * in `PILOT_VALIDATION_PLAN.md` §2): `assessment-shell.tsx` used to pass
 * a question's own `documentRequest` (a free-Hebrew-text label, e.g.
 * "הסכם עבודה מייצג") as the uploaded document's `documentType` — but
 * every downstream consumer (`EXTRACTION_SCHEMAS_BY_DOCUMENT_TYPE`,
 * `SYNTHETIC_FIXTURES`, the whole Phase 3 extraction pipeline) is keyed
 * on the canonical `"DOC-01"`.."DOC-08"` IDs from
 * `document_analysis_matrix.csv`. Since `questionnaire.csv`'s own
 * `מסמך להעלאה` column text only happens to exactly equal
 * `document_analysis_matrix.csv`'s `"מה מבקשים מהלקוח"` column for one
 * of the eight document-upload questions (`EMP-01`), every other real
 * client document upload silently stored a `documentType` that could
 * never match any extraction schema — extraction would always fail
 * with `unsupported_document_type`, for every document type except
 * DOC-01, regardless of any fixture tag. This was never caught by this
 * project's own Phase 3 test suite because every test calls
 * `uploadDocumentForSession()` directly with a literal `"DOC-01"`
 * string, bypassing the real client UI component entirely.
 *
 * This table resolves each of the eight document-upload questions to
 * its real canonical DOC ID, verified against both
 * `document_analysis_matrix.csv`'s own `"סוג מסמך"` (document type
 * name) and `"שאלות מקושרות"` (linked questions) columns — never
 * guessed. `LIT-02` (an optional court filing) is deliberately absent:
 * `document_analysis_matrix.csv` has no DOC-01..DOC-08 category for a
 * litigation document at all, so its upload correctly has no extraction
 * schema and is left unmapped (identical, unchanged behavior to today).
 */
export const DOCUMENT_TYPE_BY_QUESTION_ID: Readonly<Record<string, string>> = {
  // documentRequest "הסכם עבודה מייצג" == DOC-01's own "מה מבקשים מהלקוח" exactly.
  "EMP-01": "DOC-01",
  // documentRequest "הודעה לעובד" == DOC-02's own "סוג מסמך" ("הודעה לעובד") exactly; DOC-02's sole linked question is EMP-02.
  "EMP-02": "DOC-02",
  // documentRequest "הסכם/נספח עמלות/תכנית בונוסים" names the same document as DOC-05's "סוג מסמך" ("תכנית בונוסים/עמלות"); DOC-05's sole linked question is PAY-04.
  "PAY-04": "DOC-05",
  // documentRequest "דו״ח נוכחות" == DOC-04's own "סוג מסמך" ("דו״ח נוכחות") exactly; DOC-04's sole linked question is TIME-05.
  "TIME-05": "DOC-04",
  // documentRequest "תקנון למניעת הטרדה מינית" == DOC-08's own "סוג מסמך" exactly; DOC-08's sole linked question is HR-04.
  "HR-04": "DOC-08",
  // documentRequest "הסכם פרילנסר/נותן שירות" names the same document as DOC-06's "סוג מסמך" ("הסכם פרילנסר"); DOC-06's sole linked question is FR-01.
  "FR-01": "DOC-06",
  // documentRequest "הודעת/מדיניות פרטיות לעובדים" == DOC-07's own "סוג מסמך" exactly; DOC-07's sole linked question is PRIV-03.
  "PRIV-03": "DOC-07",
};

/** Pure — returns a new array; only the 7 items above are re-spread. */
export function applyDocumentTypeMapping(items: readonly QuestionnaireItem[]): QuestionnaireItem[] {
  return items.map((item) => {
    const documentTypeId = DOCUMENT_TYPE_BY_QUESTION_ID[item.id];
    if (!documentTypeId) return item;
    return { ...item, documentTypeId };
  });
}

export interface DocumentTypeMappingIssue {
  questionId: string;
  documentTypeId: string;
  problem: string;
}

/**
 * Cross-checks `DOCUMENT_TYPE_BY_QUESTION_ID` against the real
 * `document_analysis_matrix.csv` rows: every mapped DOC ID must exist,
 * and every question with a non-empty `documentRequest` must have a
 * mapping (an unmapped one — beyond the known `LIT-02` exception — is
 * reported so a future new document-upload question is never silently
 * left unrouted).
 */
export function validateDocumentTypeMapping(
  items: readonly QuestionnaireItem[],
  docMatrixRows: readonly DocumentAnalysisRow[],
): DocumentTypeMappingIssue[] {
  const knownDocIds = new Set(docMatrixRows.map((r) => r.ID));
  const issues: DocumentTypeMappingIssue[] = [];

  for (const [questionId, documentTypeId] of Object.entries(DOCUMENT_TYPE_BY_QUESTION_ID)) {
    if (!knownDocIds.has(documentTypeId)) {
      issues.push({ questionId, documentTypeId, problem: `"${documentTypeId}" is not a real document_analysis_matrix.csv ID` });
    }
  }

  const KNOWN_UNMAPPED = new Set(["LIT-02"]);
  for (const item of items) {
    if (!item.documentRequest) continue;
    if (DOCUMENT_TYPE_BY_QUESTION_ID[item.id]) continue;
    if (KNOWN_UNMAPPED.has(item.id)) continue;
    issues.push({
      questionId: item.id,
      documentTypeId: "",
      problem: `has documentRequest "${item.documentRequest}" but no DOCUMENT_TYPE_BY_QUESTION_ID entry`,
    });
  }

  return issues;
}
