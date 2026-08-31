import type { FreelancerScreeningRow } from "@/domain/csv/schemas";
import { computeFreelancerScreening } from "@/domain/rules/freelancerScreening";

export interface ScreeningValidationIssue {
  index: number;
  problem: string;
}

/**
 * Cross-checks the hand-encoded `SCREENING_MODEL` (via a probe call to
 * `computeFreelancerScreening`) against the real
 * `freelancer_screening_model.csv`, row by row in file order — same
 * discipline as validateCatalog.ts/validateScoringTables.ts.
 */
export function validateFreelancerScreening(
  rows: readonly FreelancerScreeningRow[],
): ScreeningValidationIssue[] {
  const issues: ScreeningValidationIssue[] = [];
  const probe = computeFreelancerScreening({});

  if (probe.indicators.length !== rows.length) {
    issues.push({
      index: -1,
      problem: `SCREENING_MODEL has ${probe.indicators.length} indicators but the CSV has ${rows.length} rows`,
    });
  }

  rows.forEach((row, index) => {
    const indicator = probe.indicators[index];
    if (!indicator) {
      issues.push({ index, problem: "no corresponding SCREENING_MODEL entry at this position" });
      return;
    }

    const expectedCondition = row["תנאי"];

    if (indicator.questionId !== row["שאלה"]) {
      issues.push({ index, problem: `questionId "${indicator.questionId}" != CSV "${row["שאלה"]}"` });
    }
    if (indicator.indication !== row["אינדיקציה"]) {
      issues.push({ index, problem: "indication mismatch" });
    }
    if (indicator.condition !== expectedCondition) {
      issues.push({ index, problem: `condition "${indicator.condition}" != CSV "${expectedCondition}"` });
    }
    const csvPoints = Number(row["נקודות Screening"]);
    if (indicator.points !== csvPoints) {
      issues.push({ index, problem: `points ${indicator.points} != CSV ${csvPoints}` });
    }
    if (indicator.direction !== row["כיוון"]) {
      issues.push({ index, problem: `direction "${indicator.direction}" != CSV "${row["כיוון"]}"` });
    }
  });

  return issues;
}
