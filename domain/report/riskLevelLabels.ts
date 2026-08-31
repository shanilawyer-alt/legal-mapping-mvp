import type { ReportStructureRow } from "@/domain/csv/schemas";
import type { RiskLevel } from "@/lib/db/types";

/**
 * Hebrew, client-facing risk-level labels — not hand-translated. Parsed
 * verbatim from `report_structure.csv`'s own Finding/"רמת סיכון" row,
 * "פלט ללקוח" cell ("נמוך/בינוני/משמעותי/גבוה/קריטי"), in the same
 * LOW→CRITICAL order spec §12 already defines for `RiskLevel`. Kept as a
 * hardcoded constant for runtime use (no CSV parsing on the request
 * path); cross-checked against a live re-parse of the real CSV at test
 * time via `deriveRiskLevelLabelsFromCsv` — same "zero drift" discipline
 * as every other hand-encoded table in this codebase.
 */
export const RISK_LEVEL_LABEL_HE: Record<RiskLevel, string> = {
  LOW: "נמוך",
  MEDIUM: "בינוני",
  SIGNIFICANT: "משמעותי",
  HIGH: "גבוה",
  CRITICAL: "קריטי",
};

/** LOW, MEDIUM, SIGNIFICANT, HIGH, CRITICAL — spec §12's own band order. */
export const RISK_LEVEL_ORDER: readonly RiskLevel[] = [
  "LOW",
  "MEDIUM",
  "SIGNIFICANT",
  "HIGH",
  "CRITICAL",
];

/** Returns `report_structure.csv`'s own "פלט ללקוח" cell for the Finding/"רמת סיכון" row, split on "/" — or null if the row/cell isn't found. */
export function deriveRiskLevelLabelsFromCsv(rows: readonly ReportStructureRow[]): string[] | null {
  const row = rows.find((r) => r["שכבה"] === "Finding" && r["שדה"] === "רמת סיכון");
  const cell = row?.["פלט ללקוח"];
  if (!cell) return null;
  return cell.split("/").map((s) => s.trim());
}
