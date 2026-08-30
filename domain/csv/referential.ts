const ID_TOKEN = /\b[A-Za-z]+-\d+\b/g;

/** Extracts every ID-shaped token (e.g. "EMP-01", "R-TIME-002") from free text. */
export function extractIdTokens(text: string): string[] {
  return [...text.matchAll(ID_TOKEN)].map((m) => m[0]);
}

export interface DanglingReference {
  readonly source: string; // e.g. "rule_catalog.csv: R-EMP-002 (קלטים)"
  readonly referencedId: string;
}

/**
 * Checks that every question-ID-shaped token in `text` resolves to a known
 * question ID. Rule catalog "קלטים" columns and the document analysis
 * matrix's "שאלות מקושרות" column both reference questionnaire.csv IDs this
 * way; a dangling reference usually means a question was renamed/removed
 * without updating a dependent row.
 */
export function findDanglingQuestionRefs(
  text: string,
  knownQuestionIds: ReadonlySet<string>,
  sourceLabel: string,
): DanglingReference[] {
  const tokens = extractIdTokens(text).filter((t) => !t.startsWith("R-"));
  return tokens
    .filter((id) => !knownQuestionIds.has(id))
    .map((referencedId) => ({ source: sourceLabel, referencedId }));
}

export function findDuplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}
