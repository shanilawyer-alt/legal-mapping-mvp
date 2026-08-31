import type { ExposureFactorRow } from "@/domain/csv/schemas";
import {
  baseSeverityPoints,
  disputePoints,
  durationPoints,
  scopePoints,
  systemicPoints,
} from "@/domain/rules/scoring";

/**
 * Cross-checks every point value hardcoded in scoring.ts against the
 * real `exposure_factors.csv` — same discipline as
 * domain/rules/validateCatalog.ts. Each CSV row's "שימוש" (usage) column
 * names which point table it belongs to; "נקודות" is the expected value.
 */
export interface ScoringValidationIssue {
  row: string;
  problem: string;
}

export function validateScoringTables(rows: readonly ExposureFactorRow[]): ScoringValidationIssue[] {
  const issues: ScoringValidationIssue[] = [];

  for (const row of rows) {
    const usage = row["שימוש"].trim();
    const category = row["ערך/קטגוריה"].trim();
    const expectedPoints = Number(row["נקודות"]);
    const label = `${usage} / ${category}`;

    let actual: number | null = null;

    if (usage === "Base Severity") {
      const severity = Number(category.match(/^(\d)/)?.[1]);
      if (!Number.isNaN(severity)) actual = baseSeverityPoints(severity);
    } else if (usage === "Scope") {
      actual = scopeCategoryPoints(category);
    } else if (usage === "Duration") {
      actual = durationCategoryPoints(category);
    } else if (usage === "Systemic") {
      actual = systemicCategoryPoints(category);
    } else if (usage === "Active dispute") {
      actual = disputeCategoryPoints(category);
    } else if (usage === "Confidence") {
      continue; // scoring.ts's computeConfidence() is checked separately, not via a numeric-bucket function.
    }

    if (actual === null) {
      issues.push({ row: label, problem: `no scoring.ts mapping found for this category` });
      continue;
    }
    if (actual !== expectedPoints) {
      issues.push({ row: label, problem: `scoring.ts computes ${actual}, CSV says ${expectedPoints}` });
    }
  }

  return issues;
}

function scopeCategoryPoints(category: string): number | null {
  if (category.includes("עובד יחיד") || category.includes("עד 10%")) return scopePoints({ affectedCount: 1, totalEmployeeCount: 10 });
  if (category.includes("11%") || category.includes("2–5")) return scopePoints({ affectedCount: 3, totalEmployeeCount: null });
  if (category.includes("26%") || category.includes("6–20")) return scopePoints({ affectedCount: 10, totalEmployeeCount: null });
  if (category.includes(">50%") || category.includes("מעל 20")) return scopePoints({ affectedCount: 25, totalEmployeeCount: null });
  return null;
}

function durationCategoryPoints(category: string): number | null {
  if (category.includes("נקודתי") || category.includes("פחות מ-3")) return durationPoints(1);
  if (category.includes("3–11")) return durationPoints(6);
  if (category.includes("12–35")) return durationPoints(18);
  if (category.includes("36")) return durationPoints(36);
  return null;
}

function systemicCategoryPoints(category: string): number | null {
  if (category === "בודד") return systemicPoints("isolated");
  if (category === "חוזר") return systemicPoints("repeated");
  if (category.includes("מדיניות")) return systemicPoints("policy");
  return null;
}

function disputeCategoryPoints(category: string): number | null {
  if (category === "אין") return disputePoints("none");
  if (category.includes("תלונה")) return disputePoints("complaint");
  if (category.includes("הליך משפטי")) return disputePoints("legal_process");
  return null;
}
